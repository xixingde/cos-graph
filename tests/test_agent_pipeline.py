from __future__ import annotations

import json
from pathlib import Path

import pytest

from graphify.agent_pipeline import (
    AgentPipelineError,
    build_agent_pipeline,
    finalize_agent_pipeline,
    prepare_agent_pipeline,
)


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_labels(graph_dir: Path) -> Path:
    analysis = _read(graph_dir / ".graphify_analysis.json")
    labels = {community_id: f"测试社区 {community_id}" for community_id in analysis["communities"]}
    path = graph_dir / ".graphify_labels.json"
    # Windows PowerShell commonly emits a UTF-8 BOM; the CLI must accept it.
    path.write_text(json.dumps(labels), encoding="utf-8-sig")
    return path


def test_code_only_pipeline_preserves_public_output_contract(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    project = tmp_path / "project"
    output_root = project / ".csc" / "kb" / "repos"
    project.mkdir()
    (project / "example.py").write_text(
        "def add(a, b):\n    return a + b\n",
        encoding="utf-8",
    )

    plan = prepare_agent_pipeline(project, out_root=output_root, run_id="contract", max_workers=1)
    assert plan["chunks"] == []
    graph_dir = output_root / "graphify-out"
    assert (graph_dir / "cache" / "ast").is_dir()
    assert not (project / "graphify-out").exists()

    built = build_agent_pipeline(project, out_root=output_root, run_id="contract")
    assert built["nodes"] > 0

    # Fixed extraction input must remain byte-structure equivalent to the
    # direct build_from_json -> cluster -> to_json sequence.
    from graphify.build import build_from_json
    from graphify.cluster import cluster
    from graphify.export import to_json

    ast = _read(graph_dir / ".graphify_ast.json")
    expected_extraction = {
        "nodes": ast["nodes"],
        "edges": ast["edges"],
        "hyperedges": [],
        "input_tokens": 0,
        "output_tokens": 0,
    }
    expected_graph = build_from_json(expected_extraction, root=project, directed=False)
    expected_path = tmp_path / "expected.json"
    to_json(expected_graph, cluster(expected_graph), str(expected_path), force=True)
    expected_json = _read(expected_path)
    actual_json = _read(graph_dir / "graph.json")
    expected_json.pop("built_at_commit", None)
    actual_json.pop("built_at_commit", None)
    assert actual_json == expected_json

    labels_path = _write_labels(graph_dir)

    # Finalization must reuse agent-build's communities rather than cluster again.
    monkeypatch.setattr("graphify.cluster.cluster", lambda *_args, **_kwargs: (_ for _ in ()).throw(
        AssertionError("finalize must not re-cluster")
    ))
    finalized = finalize_agent_pipeline(
        project,
        out_root=output_root,
        run_id="contract",
        labels_path=labels_path,
    )

    graph = _read(graph_dir / "graph.json")
    assert "nodes" in graph
    assert "links" in graph
    assert "edges" not in graph
    assert "hyperedges" in graph
    assert finalized["nodes"] == len(graph["nodes"])
    assert (graph_dir / "GRAPH_REPORT.md").is_file()
    saved_labels = _read(graph_dir / ".graphify_labels.json")
    assert all(label.startswith("测试社区") for label in saved_labels.values())
    assert (graph_dir / "graph.html").is_file()
    assert (graph_dir / "manifest.json").is_file()
    assert (graph_dir / "cost.json").is_file()
    assert not (graph_dir / ".graphify_agent_plan.json").exists()
    assert not (graph_dir / ".graphify_analysis.json").exists()


def test_prepare_with_one_worker_skips_process_pool(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The no-Python Windows binary must keep max_workers=1 in-process."""
    project = tmp_path / "project"
    output_root = project / ".csc" / "kb" / "repos"
    project.mkdir()
    for index in range(25):
        (project / f"module_{index}.py").write_text(
            f"def function_{index}():\n    return {index}\n",
            encoding="utf-8",
        )

    monkeypatch.setattr(
        "graphify.extract._extract_parallel",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("max_workers=1 must not start ProcessPoolExecutor")
        ),
    )

    plan = prepare_agent_pipeline(
        project,
        out_root=output_root,
        run_id="sequential",
        max_workers=1,
    )

    assert plan["chunks"] == []
    ast = _read(output_root / "graphify-out" / ".graphify_ast.json")
    assert ast["nodes"]


def test_build_refuses_when_more_than_half_of_chunks_are_missing(tmp_path: Path) -> None:
    project = tmp_path / "project"
    output_root = project / ".csc" / "kb" / "repos"
    project.mkdir()
    (project / "README.md").write_text("# Project\n\nA useful project description.\n", encoding="utf-8")

    plan = prepare_agent_pipeline(project, out_root=output_root, run_id="missing", max_workers=1)
    assert len(plan["chunks"]) == 1

    with pytest.raises(AgentPipelineError, match="refusing to build a partial graph"):
        build_agent_pipeline(project, out_root=output_root, run_id="missing")


def test_ast_nodes_win_over_semantic_duplicates(tmp_path: Path) -> None:
    project = tmp_path / "project"
    output_root = project / ".csc" / "kb" / "repos"
    project.mkdir()
    (project / "example.py").write_text("def add(a, b):\n    return a + b\n", encoding="utf-8")
    (project / "README.md").write_text("# Addition service\n", encoding="utf-8")

    plan = prepare_agent_pipeline(project, out_root=output_root, run_id="merge", max_workers=1)
    graph_dir = output_root / "graphify-out"
    ast = _read(graph_dir / ".graphify_ast.json")
    duplicate = dict(ast["nodes"][0])
    duplicate["label"] = "WRONG SEMANTIC OVERRIDE"
    duplicate["metadata"] = {"entity_type": "code_symbol"}
    semantic_only = {
        "id": "concept:addition",
        "label": "Addition",
        "file_type": "concept",
        "source_file": str(project / "README.md"),
        "metadata": {"entity_type": "concept"},
    }
    chunk_path = Path(plan["chunks"][0]["output_path"])
    chunk_path.write_text(json.dumps({
        "nodes": [duplicate, semantic_only],
        "edges": [],
        "hyperedges": [],
        "input_tokens": 10,
        "output_tokens": 5,
    }), encoding="utf-8-sig")

    build_agent_pipeline(project, out_root=output_root, run_id="merge")
    assert (graph_dir / "cache" / "semantic").is_dir()
    assert not (project / "graphify-out").exists()
    extraction = _read(graph_dir / ".graphify_extract.json")
    by_id = {node["id"]: node for node in extraction["nodes"]}
    assert by_id[duplicate["id"]]["label"] == ast["nodes"][0]["label"]
    assert by_id["concept:addition"]["label"] == "Addition"
    assert extraction["input_tokens"] == 10
    assert extraction["output_tokens"] == 5


def test_build_rejects_incompatible_semantic_relation(tmp_path: Path) -> None:
    project = tmp_path / "project"
    output_root = project / ".csc" / "kb" / "repos"
    project.mkdir()
    readme = project / "README.md"
    readme.write_text("# Addition service\n", encoding="utf-8")

    plan = prepare_agent_pipeline(project, out_root=output_root, run_id="bad-relation", max_workers=1)
    chunk_path = Path(plan["chunks"][0]["output_path"])
    chunk_path.write_text(json.dumps({
        "nodes": [
            {
                "id": "concept:addition",
                "label": "Addition",
                "file_type": "concept",
                "source_file": str(readme),
                "metadata": {"entity_type": "concept"},
            },
            {
                "id": "concept:service",
                "label": "Service",
                "file_type": "concept",
                "source_file": str(readme),
                "metadata": {"entity_type": "concept"},
            },
        ],
        "edges": [{
            "source": "concept:addition",
            "target": "concept:service",
            "relation": "describes",
            "confidence": "EXTRACTED",
            "confidence_score": 0.9,
            "source_file": str(readme),
        }],
        "hyperedges": [],
    }), encoding="utf-8")

    with pytest.raises(AgentPipelineError, match="relation 'describes'"):
        build_agent_pipeline(project, out_root=output_root, run_id="bad-relation")


def test_incremental_pipeline_replaces_changes_prunes_deletions_and_detects_noop(
    tmp_path: Path,
) -> None:
    project = tmp_path / "project"
    output_root = project / ".csc" / "kb" / "repos"
    project.mkdir()
    changed = project / "changed.py"
    deleted = project / "deleted.py"
    changed.write_text("def add(a, b):\n    return a + b\n", encoding="utf-8")
    deleted.write_text("def keep():\n    return True\n", encoding="utf-8")

    prepare_agent_pipeline(project, out_root=output_root, run_id="full", max_workers=1)
    build_agent_pipeline(project, out_root=output_root, run_id="full")
    graph_dir = output_root / "graphify-out"
    finalize_agent_pipeline(
        project,
        out_root=output_root,
        run_id="full",
        labels_path=_write_labels(graph_dir),
    )

    changed.write_text("def subtract(a, b):\n    return a - b\n", encoding="utf-8")
    deleted.unlink()
    plan = prepare_agent_pipeline(
        project,
        out_root=output_root,
        run_id="incremental",
        max_workers=1,
        incremental=True,
    )
    assert plan["phase"] == "prepared"
    assert plan["counts"]["changed_files"] == 1
    assert plan["counts"]["deleted_files"] == 1

    result = build_agent_pipeline(project, out_root=output_root, run_id="incremental")
    assert result["incremental"] is True
    finalize_agent_pipeline(
        project,
        out_root=output_root,
        run_id="incremental",
        labels_path=_write_labels(graph_dir),
    )
    graph = _read(graph_dir / "graph.json")
    labels = {str(node.get("label")) for node in graph["nodes"]}
    assert any("subtract" in label for label in labels)
    assert not any("add" in label for label in labels)
    assert not any("keep" in label for label in labels)

    noop = prepare_agent_pipeline(
        project,
        out_root=output_root,
        run_id="noop",
        max_workers=1,
        incremental=True,
    )
    assert noop["phase"] == "noop"
    assert noop["counts"]["changed_files"] == 0
    assert noop["counts"]["deleted_files"] == 0

    wrong_root = tmp_path / "wrong-project"
    wrong_root.mkdir()
    (wrong_root / "other.py").write_text("def other():\n    pass\n", encoding="utf-8")
    with pytest.raises(AgentPipelineError, match="input root mismatch"):
        prepare_agent_pipeline(
            wrong_root,
            out_root=output_root,
            run_id="wrong-root",
            max_workers=1,
            incremental=True,
        )
