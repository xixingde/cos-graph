"""Deterministic stages used by agent-orchestrated, no-Python graph builds.

The semantic extraction and community naming steps intentionally remain outside
this module: the host coding agent performs those judgements.  Everything else
is kept here so standalone Graphify binaries provide the complete deterministic
build and export behaviour without a Python interpreter on the user's machine.
"""

from __future__ import annotations

import json
import re
import subprocess
import uuid
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any


_PLAN_NAME = ".graphify_agent_plan.json"
_RUN_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class AgentPipelineError(RuntimeError):
    """A user-correctable staged-pipeline failure."""


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def _read_json(path: Path, *, label: str) -> dict[str, Any]:
    try:
        # utf-8-sig accepts both normal UTF-8 and files written with a BOM by
        # Windows PowerShell, which is a common way agents create label JSON.
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError as exc:
        raise AgentPipelineError(f"missing {label}: {path}") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise AgentPipelineError(f"invalid {label}: {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise AgentPipelineError(f"invalid {label}: expected a JSON object: {path}")
    return data


def _paths(input_path: str | Path, out_root: str | Path | None) -> tuple[Path, Path, Path]:
    scan_root = Path(input_path).expanduser().resolve()
    if not scan_root.is_dir():
        raise AgentPipelineError(f"input path is not a directory: {scan_root}")
    output_root = Path(out_root).expanduser().resolve() if out_root else scan_root
    graph_dir = output_root / "graphify-out"
    graph_dir.mkdir(parents=True, exist_ok=True)
    return scan_root, output_root, graph_dir


def _normalise_run_id(run_id: str | None) -> str:
    value = run_id or uuid.uuid4().hex[:12]
    if not _RUN_ID_RE.fullmatch(value):
        raise AgentPipelineError("run ID must contain only letters, digits, '_' or '-' (max 64 characters)")
    return value


def _empty_extraction() -> dict[str, Any]:
    return {
        "nodes": [],
        "edges": [],
        "hyperedges": [],
        "input_tokens": 0,
        "output_tokens": 0,
    }


def _make_chunks(files: list[str], graph_dir: Path, run_id: str, chunk_size: int) -> list[dict[str, Any]]:
    """Match the skill's grouping rules: images alone, related files together."""
    if chunk_size < 1:
        raise AgentPipelineError("chunk size must be at least 1")

    image_suffixes = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".svg"}
    images = sorted((f for f in files if Path(f).suffix.lower() in image_suffixes), key=str.casefold)
    regular = sorted((f for f in files if Path(f).suffix.lower() not in image_suffixes),
                     key=lambda f: (str(Path(f).parent).casefold(), str(f).casefold()))

    batches: list[list[str]] = []
    for start in range(0, len(regular), chunk_size):
        batches.append(regular[start:start + chunk_size])
    batches.extend([[image] for image in images])

    chunks = []
    for index, batch in enumerate(batches, start=1):
        chunk_id = f"{index:02d}"
        output_path = (graph_dir / f".graphify_chunk_{run_id}_{chunk_id}.json").resolve()
        chunks.append({
            "chunk_id": chunk_id,
            "files": [str(Path(f).resolve()) for f in batch],
            "output_path": str(output_path),
        })
    return chunks


def prepare_agent_pipeline(
    input_path: str | Path,
    *,
    out_root: str | Path | None = None,
    max_workers: int = 1,
    directed: bool = False,
    deep: bool = False,
    chunk_size: int = 22,
    run_id: str | None = None,
) -> dict[str, Any]:
    """Detect files, extract code AST, check semantic cache, and write a run plan."""
    from graphify.agent_schema import normalise_agent_extraction, validate_agent_extraction
    from graphify.cache import check_semantic_cache
    from graphify.detect import detect
    from graphify.extract import collect_files, extract

    scan_root, output_root, graph_dir = _paths(input_path, out_root)
    actual_run_id = _normalise_run_id(run_id)
    detection = detect(scan_root)
    _write_json(graph_dir / ".graphify_detect.json", detection)

    if not detection.get("total_files", 0):
        raise AgentPipelineError(f"no supported files found in {scan_root}")
    videos = detection.get("files", {}).get("video", [])
    if videos:
        raise AgentPipelineError(
            "agent pipeline does not support video/audio yet; transcribe those files before running it"
        )

    code_files: list[Path] = []
    for raw_path in detection.get("files", {}).get("code", []):
        path = Path(raw_path)
        code_files.extend(collect_files(path) if path.is_dir() else [path])
    # A single worker must run in-process. Besides avoiding needless process
    # startup, this is required by Windows onefile binaries: multiprocessing's
    # spawn bootstrap cannot use the extracted Nuitka payload as a Python
    # child-process executable (CreateProcess fails with WinError 193).
    if code_files:
        ast = extract(
            code_files,
            cache_root=scan_root,
            cache_storage_root=output_root,
            max_workers=max_workers,
            parallel=max_workers > 1,
        )
    else:
        ast = _empty_extraction()
    ast.setdefault("hyperedges", [])
    ast.setdefault("input_tokens", 0)
    ast.setdefault("output_tokens", 0)
    _write_json(graph_dir / ".graphify_ast.json", ast)

    semantic_files = [
        path
        for category in ("document", "paper", "image")
        for path in detection.get("files", {}).get(category, [])
    ]
    cached_nodes, cached_edges, cached_hyperedges, uncached = check_semantic_cache(
        semantic_files,
        root=scan_root,
        storage_root=output_root,
    )
    cached = normalise_agent_extraction({
        "nodes": cached_nodes,
        "edges": cached_edges,
        "hyperedges": cached_hyperedges,
    }, root=scan_root)
    # Semantic cache entries predate the strict CosKnow output contract.  A
    # legacy entry may therefore contain free-form relations or malformed
    # hyperedges.  Re-extract all semantic files instead of silently mixing an
    # incompatible cache with newly validated chunks.
    cached_ast_node_ids = {
        str(node.get("id")) for node in ast.get("nodes", [])
        if isinstance(node, dict) and node.get("id") is not None
    }
    if validate_agent_extraction(
        cached,
        external_node_ids=cached_ast_node_ids,
        require_resolved_endpoints=True,
    ):
        cached = _empty_extraction()
        uncached = list(semantic_files)
    cached_path = graph_dir / ".graphify_cached.json"
    if cached["nodes"] or cached["edges"] or cached["hyperedges"]:
        _write_json(cached_path, cached)
    else:
        cached_path.unlink(missing_ok=True)
    (graph_dir / ".graphify_uncached.txt").write_text("\n".join(uncached), encoding="utf-8")

    chunks = _make_chunks(uncached, graph_dir, actual_run_id, chunk_size)
    try:
        graphify_version = version("graphifyy")
    except PackageNotFoundError:
        graphify_version = "unknown"
    plan = {
        "schema_version": 1,
        "graphify_version": graphify_version,
        "run_id": actual_run_id,
        "phase": "prepared",
        "scan_root": str(scan_root),
        "output_root": str(output_root),
        "graph_dir": str(graph_dir),
        "directed": bool(directed),
        "deep": bool(deep),
        "chunk_size": chunk_size,
        "chunks": chunks,
        "counts": {
            "total_files": detection.get("total_files", 0),
            "code_files": len(code_files),
            "semantic_files": len(semantic_files),
            "cached_semantic_files": len(semantic_files) - len(uncached),
            "uncached_semantic_files": len(uncached),
            "chunks": len(chunks),
            "ast_nodes": len(ast.get("nodes", [])),
            "ast_edges": len(ast.get("edges", [])),
        },
    }
    _write_json(graph_dir / _PLAN_NAME, plan)
    return plan


def _load_plan(scan_root: Path, output_root: Path, graph_dir: Path, run_id: str) -> dict[str, Any]:
    plan = _read_json(graph_dir / _PLAN_NAME, label="agent plan")
    if plan.get("schema_version") != 1:
        raise AgentPipelineError(f"unsupported agent plan schema: {plan.get('schema_version')!r}")
    if plan.get("run_id") != run_id:
        raise AgentPipelineError(
            f"run ID mismatch: plan has {plan.get('run_id')!r}, command received {run_id!r}"
        )
    if Path(str(plan.get("scan_root", ""))).resolve() != scan_root:
        raise AgentPipelineError("input path does not match the prepared agent plan")
    if Path(str(plan.get("output_root", ""))).resolve() != output_root:
        raise AgentPipelineError("output path does not match the prepared agent plan")
    return plan


def _validate_chunk(
    chunk: dict[str, Any],
    graph_dir: Path,
    run_id: str,
    scan_root: Path,
) -> tuple[dict[str, Any] | None, str | None]:
    from graphify.agent_schema import (
        format_agent_schema_errors,
        normalise_agent_extraction,
        validate_agent_extraction,
    )

    raw_output = chunk.get("output_path")
    if not isinstance(raw_output, str):
        return None, "plan has no output_path"
    output_path = Path(raw_output).resolve()
    expected_prefix = f".graphify_chunk_{run_id}_"
    if output_path.parent != graph_dir.resolve() or not output_path.name.startswith(expected_prefix):
        return None, f"unsafe chunk output path: {output_path}"
    try:
        data = json.loads(output_path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        return None, str(exc)
    if not isinstance(data, dict):
        return None, "chunk must be a JSON object"
    normalized = normalise_agent_extraction(data, root=scan_root)
    errors = validate_agent_extraction(normalized)
    if errors:
        return None, format_agent_schema_errors(errors)
    return normalized, None


def _write_compatible_graph(
    graph: Any,
    communities: dict[int, Any],
    graph_path: Path,
    *,
    semantic_node_ids: set[str],
    force: bool = False,
) -> None:
    """Validate a candidate export before replacing the public graph.json."""
    from graphify.agent_schema import format_agent_schema_errors, validate_final_agent_graph
    from graphify.export import to_json

    candidate_path = graph_path.with_name(".graphify_graph_candidate.json")
    try:
        if not to_json(graph, communities, str(candidate_path), force=True):
            raise AgentPipelineError("failed to serialize the candidate graph")
        candidate = _read_json(candidate_path, label="candidate graph")
        errors = validate_final_agent_graph(candidate, semantic_node_ids=semantic_node_ids)
        if errors:
            raise AgentPipelineError(
                "final graph is incompatible with the CosKnow contract: "
                + format_agent_schema_errors(errors)
            )
        if not to_json(graph, communities, str(graph_path), force=force):
            raise AgentPipelineError(
                f"refused to shrink {graph_path}; use --force only when the reduction is intentional"
            )
    finally:
        candidate_path.unlink(missing_ok=True)


def build_agent_pipeline(
    input_path: str | Path,
    *,
    out_root: str | Path | None = None,
    run_id: str,
    force: bool = False,
) -> dict[str, Any]:
    """Merge agent chunks with AST/cache data, then build and analyse the graph."""
    from graphify.analyze import god_nodes, suggest_questions, surprising_connections
    from graphify.build import build_from_json
    from graphify.agent_schema import format_agent_schema_errors, validate_agent_extraction
    from graphify.cache import save_semantic_cache
    from graphify.cluster import cluster, score_all
    from graphify.diagnostics import diagnose_extraction
    from graphify.report import generate

    scan_root, output_root, graph_dir = _paths(input_path, out_root)
    actual_run_id = _normalise_run_id(run_id)
    plan = _load_plan(scan_root, output_root, graph_dir, actual_run_id)
    if plan.get("phase") != "prepared":
        raise AgentPipelineError(f"agent plan is in phase {plan.get('phase')!r}, expected 'prepared'")

    chunks = plan.get("chunks", [])
    if not isinstance(chunks, list):
        raise AgentPipelineError("agent plan chunks must be an array")
    valid_chunks: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    for chunk in chunks:
        if not isinstance(chunk, dict):
            failures.append({"chunk_id": "?", "error": "invalid plan entry"})
            continue
        data, error = _validate_chunk(chunk, graph_dir, actual_run_id, scan_root)
        if error:
            failures.append({"chunk_id": str(chunk.get("chunk_id", "?")), "error": error})
        elif data is not None:
            valid_chunks.append(data)
    if chunks and len(failures) / len(chunks) > 0.5:
        detail = failures[0]["error"] if failures else "unknown chunk error"
        raise AgentPipelineError(
            f"{len(failures)} of {len(chunks)} semantic chunks are missing or invalid; "
            f"refusing to build a partial graph: {detail}"
        )

    semantic_new = _empty_extraction()
    for data in valid_chunks:
        semantic_new["nodes"].extend(data.get("nodes", []))
        semantic_new["edges"].extend(data.get("edges", []))
        semantic_new["hyperedges"].extend(data.get("hyperedges", []))
        semantic_new["input_tokens"] += int(data.get("input_tokens", 0) or 0)
        semantic_new["output_tokens"] += int(data.get("output_tokens", 0) or 0)
    _write_json(graph_dir / ".graphify_semantic_new.json", semantic_new)

    cached_path = graph_dir / ".graphify_cached.json"
    cached = _read_json(cached_path, label="semantic cache result") if cached_path.exists() else _empty_extraction()
    all_semantic_nodes = list(cached.get("nodes", [])) + semantic_new["nodes"]
    seen_semantic: set[str] = set()
    semantic_nodes: list[dict[str, Any]] = []
    for node in all_semantic_nodes:
        node_id = node.get("id") if isinstance(node, dict) else None
        if node_id is None:
            continue
        if node_id not in seen_semantic:
            seen_semantic.add(node_id)
            semantic_nodes.append(node)
    semantic = {
        "nodes": semantic_nodes,
        "edges": list(cached.get("edges", [])) + semantic_new["edges"],
        "hyperedges": list(cached.get("hyperedges", [])) + semantic_new["hyperedges"],
        "input_tokens": semantic_new["input_tokens"],
        "output_tokens": semantic_new["output_tokens"],
    }
    ast = _read_json(graph_dir / ".graphify_ast.json", label="AST extraction")
    ast_node_ids = {
        str(node.get("id")) for node in ast.get("nodes", [])
        if isinstance(node, dict) and node.get("id") is not None
    }
    semantic_errors = validate_agent_extraction(
        semantic,
        external_node_ids=ast_node_ids,
        require_resolved_endpoints=True,
    )
    if semantic_errors:
        raise AgentPipelineError(
            "combined semantic extraction is incompatible with the CosKnow contract: "
            + format_agent_schema_errors(semantic_errors)
        )
    _write_json(graph_dir / ".graphify_semantic.json", semantic)
    # Cache only data that passed both the per-chunk schema checks and the
    # combined endpoint-resolution check above.
    save_semantic_cache(
        semantic_new["nodes"],
        semantic_new["edges"],
        semantic_new["hyperedges"],
        root=scan_root,
        storage_root=output_root,
    )

    merged_nodes = list(ast.get("nodes", []))
    seen_nodes = {node.get("id") for node in merged_nodes if isinstance(node, dict)}
    semantic_output_node_ids: set[str] = set()
    for node in semantic["nodes"]:
        if node.get("id") not in seen_nodes:
            merged_nodes.append(node)
            seen_nodes.add(node.get("id"))
            semantic_output_node_ids.add(str(node.get("id")))
    extraction = {
        "nodes": merged_nodes,
        "edges": list(ast.get("edges", [])) + semantic["edges"],
        "hyperedges": semantic["hyperedges"],
        "input_tokens": semantic["input_tokens"],
        "output_tokens": semantic["output_tokens"],
    }
    _write_json(graph_dir / ".graphify_extract.json", extraction)

    directed = bool(plan.get("directed", False))
    graph = build_from_json(extraction, root=scan_root, directed=directed)
    if graph.number_of_nodes() == 0:
        raise AgentPipelineError("graph is empty; refusing to overwrite existing outputs")
    communities = cluster(graph)
    cohesion = score_all(graph, communities)
    gods = god_nodes(graph)
    surprises = surprising_connections(graph, communities)
    placeholder_labels = {cid: f"Community {cid}" for cid in communities}
    questions = suggest_questions(graph, communities, placeholder_labels)
    tokens = {"input": extraction["input_tokens"], "output": extraction["output_tokens"]}

    graph_path = graph_dir / "graph.json"
    _write_compatible_graph(
        graph,
        communities,
        graph_path,
        semantic_node_ids=semantic_output_node_ids,
        force=force,
    )
    detection = _read_json(graph_dir / ".graphify_detect.json", label="detection result")
    report = generate(
        graph, communities, cohesion, placeholder_labels, gods, surprises,
        detection, tokens, str(scan_root), suggested_questions=questions,
    )
    (graph_dir / "GRAPH_REPORT.md").write_text(report, encoding="utf-8")
    diagnosis = diagnose_extraction(extraction, directed=directed, root=scan_root)
    analysis = {
        "communities": {str(key): value for key, value in communities.items()},
        "cohesion": {str(key): value for key, value in cohesion.items()},
        "gods": gods,
        "surprises": surprises,
        "questions": questions,
        "diagnostics": diagnosis,
    }
    _write_json(graph_dir / ".graphify_analysis.json", analysis)

    result = {
        "run_id": actual_run_id,
        "phase": "built",
        "nodes": graph.number_of_nodes(),
        "edges": graph.number_of_edges(),
        "communities": len(communities),
        "valid_chunks": len(valid_chunks),
        "failed_chunks": failures,
        "graph_path": str(graph_path),
        "analysis_path": str(graph_dir / ".graphify_analysis.json"),
    }
    plan["phase"] = "built"
    plan["build_result"] = result
    _write_json(graph_dir / _PLAN_NAME, plan)
    return result


def _update_cost(graph_dir: Path, detection: dict[str, Any], extraction: dict[str, Any]) -> dict[str, Any]:
    cost_path = graph_dir / "cost.json"
    cost = _read_json(cost_path, label="cost tracker") if cost_path.exists() else {
        "runs": [], "total_input_tokens": 0, "total_output_tokens": 0,
    }
    input_tokens = int(extraction.get("input_tokens", 0) or 0)
    output_tokens = int(extraction.get("output_tokens", 0) or 0)
    cost.setdefault("runs", []).append({
        "date": datetime.now(timezone.utc).isoformat(),
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "files": detection.get("total_files", 0),
    })
    cost["total_input_tokens"] = int(cost.get("total_input_tokens", 0)) + input_tokens
    cost["total_output_tokens"] = int(cost.get("total_output_tokens", 0)) + output_tokens
    _write_json(cost_path, cost)
    return cost


def _update_kb_state(scan_root: Path, output_root: Path) -> None:
    if (
        output_root.name == "repos"
        and output_root.parent.name == "kb"
        and output_root.parent.parent.name == ".csc"
    ):
        project_root = output_root.parent.parent.parent
    else:
        project_root = scan_root
    state_path = project_root / ".csc" / "kb" / "state.json"
    state = _read_json(state_path, label="knowledge-base state") if state_path.exists() else {}
    try:
        completed = subprocess.run(
            ["git", "-C", str(output_root), "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=5, check=False,
        )
        kb_head = completed.stdout.strip() if completed.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        kb_head = ""
    state["graph"] = {
        "status": "ready",
        "kb_commit": kb_head,
        "built_at": datetime.now(timezone.utc).isoformat(),
    }
    state.setdefault("version", 1)
    state.setdefault("sync", {})
    _write_json(state_path, state)


def finalize_agent_pipeline(
    input_path: str | Path,
    *,
    out_root: str | Path | None = None,
    run_id: str,
    labels_path: str | Path | None = None,
    no_viz: bool = False,
    keep_intermediates: bool = False,
) -> dict[str, Any]:
    """Apply agent-authored labels without re-clustering, then finalize outputs."""
    from graphify.analyze import suggest_questions
    from graphify.build import build_from_json
    from graphify.detect import save_manifest
    from graphify.export import to_html
    from graphify.report import generate

    scan_root, output_root, graph_dir = _paths(input_path, out_root)
    actual_run_id = _normalise_run_id(run_id)
    plan = _load_plan(scan_root, output_root, graph_dir, actual_run_id)
    if plan.get("phase") != "built":
        raise AgentPipelineError(f"agent plan is in phase {plan.get('phase')!r}, expected 'built'")

    extraction = _read_json(graph_dir / ".graphify_extract.json", label="merged extraction")
    detection = _read_json(graph_dir / ".graphify_detect.json", label="detection result")
    analysis = _read_json(graph_dir / ".graphify_analysis.json", label="graph analysis")
    label_file = Path(labels_path).expanduser().resolve() if labels_path else graph_dir / ".graphify_labels.json"
    raw_labels = _read_json(label_file, label="community labels")
    try:
        labels = {int(key): str(value) for key, value in raw_labels.items()}
        communities = {int(key): value for key, value in analysis["communities"].items()}
        cohesion = {int(key): value for key, value in analysis["cohesion"].items()}
    except (KeyError, TypeError, ValueError) as exc:
        raise AgentPipelineError(f"invalid analysis or labels structure: {exc}") from exc
    missing_labels = sorted(set(communities) - set(labels))
    if missing_labels:
        raise AgentPipelineError(f"community labels are missing IDs: {missing_labels}")

    directed = bool(plan.get("directed", False))
    graph = build_from_json(extraction, root=scan_root, directed=directed)
    questions = suggest_questions(graph, communities, labels)
    tokens = {
        "input": int(extraction.get("input_tokens", 0) or 0),
        "output": int(extraction.get("output_tokens", 0) or 0),
    }
    report = generate(
        graph, communities, cohesion, labels, analysis.get("gods", []),
        analysis.get("surprises", []), detection, tokens, str(scan_root),
        suggested_questions=questions,
    )
    (graph_dir / "GRAPH_REPORT.md").write_text(report, encoding="utf-8")
    _write_json(graph_dir / ".graphify_labels.json", {str(key): value for key, value in labels.items()})
    # Labels affect the report and HTML. graph.json remains the ordinary
    # node-link export produced without community_labels so its graph schema
    # does not vary with the display language chosen for community names.
    semantic = _read_json(graph_dir / ".graphify_semantic.json", label="semantic extraction")
    ast = _read_json(graph_dir / ".graphify_ast.json", label="AST extraction")
    ast_node_ids = {
        str(node.get("id")) for node in ast.get("nodes", [])
        if isinstance(node, dict) and node.get("id") is not None
    }
    semantic_node_ids = {
        str(node.get("id")) for node in semantic.get("nodes", [])
        if isinstance(node, dict) and node.get("id") is not None
    } - ast_node_ids
    _write_compatible_graph(
        graph,
        communities,
        graph_dir / "graph.json",
        semantic_node_ids=semantic_node_ids,
    )

    html_path = graph_dir / "graph.html"
    if no_viz:
        html_path.unlink(missing_ok=True)
    else:
        try:
            to_html(graph, communities, str(html_path), community_labels=labels, node_limit=5000)
        except ValueError:
            html_path.unlink(missing_ok=True)

    save_manifest(
        detection.get("all_files") or detection.get("files", {}),
        manifest_path=str(graph_dir / "manifest.json"),
        kind="both",
        root=scan_root,
    )
    cost = _update_cost(graph_dir, detection, extraction)
    _update_kb_state(scan_root, output_root)

    result = {
        "run_id": actual_run_id,
        "phase": "finalized",
        "nodes": graph.number_of_nodes(),
        "edges": graph.number_of_edges(),
        "communities": len(communities),
        "graph_path": str(graph_dir / "graph.json"),
        "report_path": str(graph_dir / "GRAPH_REPORT.md"),
        "html_path": str(html_path) if html_path.exists() else None,
        "total_input_tokens": cost.get("total_input_tokens", 0),
        "total_output_tokens": cost.get("total_output_tokens", 0),
    }

    if not keep_intermediates:
        for name in (
            ".graphify_detect.json",
            ".graphify_extract.json",
            ".graphify_ast.json",
            ".graphify_semantic.json",
            ".graphify_semantic_new.json",
            ".graphify_cached.json",
            ".graphify_uncached.txt",
            ".graphify_analysis.json",
            _PLAN_NAME,
            ".needs_update",
        ):
            (graph_dir / name).unlink(missing_ok=True)
        for chunk in plan.get("chunks", []):
            if not isinstance(chunk, dict) or not isinstance(chunk.get("output_path"), str):
                continue
            chunk_path = Path(chunk["output_path"]).resolve()
            if chunk_path.parent == graph_dir.resolve() and chunk_path.name.startswith(
                f".graphify_chunk_{actual_run_id}_"
            ):
                chunk_path.unlink(missing_ok=True)
    return result
