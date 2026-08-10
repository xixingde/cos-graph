"""Strict compatibility contract for agent-authored semantic extractions.

Graphify's general extraction schema intentionally accepts extensible NetworkX
attributes.  The staged ``agent-*`` pipeline has a narrower requirement: its
LLM-authored JSON must remain compatible with the historical ``/kb-graph``
output consumed by CosKnow.  This module keeps those rules out of the generic
AST/SCIP/database ingestion paths.
"""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path, PurePosixPath
import re
from typing import Any, Iterable


AGENT_SEMANTIC_RELATIONS = frozenset({
    "calls",
    "implements",
    "references",
    "cites",
    "conceptually_related_to",
    "shares_data_with",
    "semantically_similar_to",
    "rationale_for",
})
AGENT_FILE_TYPES = frozenset({"code", "document", "paper", "image", "rationale", "concept"})
AGENT_CONFIDENCES = frozenset({"EXTRACTED", "INFERRED", "AMBIGUOUS"})

_WINDOWS_ABSOLUTE_RE = re.compile(r"^[A-Za-z]:/")


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _is_absolute_source_file(value: str) -> bool:
    normalized = value.replace("\\", "/")
    return normalized.startswith("/") or bool(_WINDOWS_ABSOLUTE_RE.match(normalized))


def _normalise_source_file(value: Any, root: str | Path) -> Any:
    """Return a slash-normalized path relative to *root* when possible.

    ``Path.is_absolute`` cannot recognise a Windows drive path on POSIX CI, so
    the prefix comparison deliberately operates on normalized strings.
    Paths outside the scan root remain absolute and are rejected by validation.
    """
    if not isinstance(value, str) or not value:
        return value

    normalized = value.replace("\\", "/")
    root_normalized = str(Path(root).expanduser().resolve()).replace("\\", "/").rstrip("/")
    case_insensitive = bool(_WINDOWS_ABSOLUTE_RE.match(normalized)) or bool(
        _WINDOWS_ABSOLUTE_RE.match(root_normalized)
    )
    candidate_cmp = normalized.casefold() if case_insensitive else normalized
    root_cmp = root_normalized.casefold() if case_insensitive else root_normalized
    if candidate_cmp == root_cmp:
        return "."
    prefix = root_cmp + "/"
    if candidate_cmp.startswith(prefix):
        return normalized[len(root_normalized) + 1:]
    while normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized


def normalise_agent_extraction(data: dict[str, Any], *, root: str | Path) -> dict[str, Any]:
    """Copy and canonicalize safe aliases in one agent-authored extraction.

    Only lossless transformations happen here.  In particular, a hyperedge
    ``type`` is descriptive metadata and is never guessed to be ``relation``.
    Missing semantic information is left for strict validation to report.
    """
    normalized = deepcopy(data)

    for node in normalized.get("nodes", []):
        if isinstance(node, dict) and "source_file" in node:
            node["source_file"] = _normalise_source_file(node["source_file"], root)

    edge_key = "edges" if "edges" in normalized else "links"
    for edge in normalized.get(edge_key, []):
        if isinstance(edge, dict) and "source_file" in edge:
            edge["source_file"] = _normalise_source_file(edge["source_file"], root)

    for hyperedge in normalized.get("hyperedges", []):
        if not isinstance(hyperedge, dict):
            continue
        if "nodes" not in hyperedge and "node_ids" in hyperedge:
            hyperedge["nodes"] = hyperedge.pop("node_ids")
        if "type" in hyperedge:
            metadata = hyperedge.get("metadata")
            if metadata is None:
                metadata = {}
                hyperedge["metadata"] = metadata
            if isinstance(metadata, dict):
                metadata.setdefault("type", hyperedge.pop("type"))
        if "source_file" in hyperedge:
            hyperedge["source_file"] = _normalise_source_file(hyperedge["source_file"], root)

    return normalized


def _validate_source_file(value: Any, *, owner: str) -> list[str]:
    if not isinstance(value, str) or not value:
        return [f"{owner} source_file must be a non-empty string"]
    normalized = value.replace("\\", "/")
    if _is_absolute_source_file(normalized):
        return [f"{owner} source_file must be relative to the scan root: {value!r}"]
    if ".." in PurePosixPath(normalized).parts:
        return [f"{owner} source_file must not escape the scan root: {value!r}"]
    return []


def _validate_score(value: Any, *, owner: str) -> list[str]:
    if not _is_number(value):
        return [f"{owner} confidence_score must be a number"]
    if not 0 <= float(value) <= 1:
        return [f"{owner} confidence_score must be between 0 and 1"]
    return []


def validate_agent_extraction(
    data: dict[str, Any],
    *,
    external_node_ids: Iterable[str] = (),
    require_resolved_endpoints: bool = False,
) -> list[str]:
    """Validate the strict CosKnow-compatible semantic extraction contract."""
    if not isinstance(data, dict):
        return ["agent extraction must be a JSON object"]

    errors: list[str] = []
    nodes = data.get("nodes")
    edges = data.get("edges") if "edges" in data else data.get("links")
    hyperedges = data.get("hyperedges", [])
    if not isinstance(nodes, list):
        errors.append("agent extraction nodes must be an array")
        nodes = []
    if not isinstance(edges, list):
        errors.append("agent extraction edges must be an array")
        edges = []
    if not isinstance(hyperedges, list):
        errors.append("agent extraction hyperedges must be an array")
        hyperedges = []

    node_ids: set[str] = {str(value) for value in external_node_ids}
    for index, node in enumerate(nodes):
        owner = f"node {index}"
        if not isinstance(node, dict):
            errors.append(f"{owner} must be an object")
            continue
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id:
            errors.append(f"{owner} id must be a non-empty string")
        else:
            node_ids.add(node_id)
            owner = f"node {index} ({node_id})"
        if not isinstance(node.get("label"), str) or not node.get("label"):
            errors.append(f"{owner} label must be a non-empty string")
        if node.get("file_type") not in AGENT_FILE_TYPES:
            errors.append(f"{owner} file_type must be one of {sorted(AGENT_FILE_TYPES)}")
        errors.extend(_validate_source_file(node.get("source_file"), owner=owner))
        metadata = node.get("metadata")
        if not isinstance(metadata, dict):
            errors.append(f"{owner} metadata must be an object")
        elif not isinstance(metadata.get("entity_type"), str) or not metadata.get("entity_type", "").strip():
            errors.append(f"{owner} metadata.entity_type must be a non-empty string")
        if "rationale" in node and not isinstance(node.get("rationale"), str):
            errors.append(f"{owner} rationale must be a string when present")

    for index, edge in enumerate(edges):
        owner = f"edge {index}"
        if not isinstance(edge, dict):
            errors.append(f"{owner} must be an object")
            continue
        source = edge.get("source")
        target = edge.get("target")
        if not isinstance(source, str) or not source:
            errors.append(f"{owner} source must be a non-empty string")
        if not isinstance(target, str) or not target:
            errors.append(f"{owner} target must be a non-empty string")
        relation = edge.get("relation")
        if relation not in AGENT_SEMANTIC_RELATIONS:
            errors.append(f"{owner} relation {relation!r} must be one of {sorted(AGENT_SEMANTIC_RELATIONS)}")
        if edge.get("confidence") not in AGENT_CONFIDENCES:
            errors.append(f"{owner} confidence must be one of {sorted(AGENT_CONFIDENCES)}")
        errors.extend(_validate_score(edge.get("confidence_score"), owner=owner))
        errors.extend(_validate_source_file(edge.get("source_file"), owner=owner))
        if "metadata" in edge and not isinstance(edge.get("metadata"), dict):
            errors.append(f"{owner} metadata must be an object when present")
        if require_resolved_endpoints:
            if isinstance(source, str) and source not in node_ids:
                errors.append(f"{owner} source {source!r} does not match any node id")
            if isinstance(target, str) and target not in node_ids:
                errors.append(f"{owner} target {target!r} does not match any node id")

    for index, hyperedge in enumerate(hyperedges):
        owner = f"hyperedge {index}"
        if not isinstance(hyperedge, dict):
            errors.append(f"{owner} must be an object")
            continue
        hyperedge_id = hyperedge.get("id")
        if not isinstance(hyperedge_id, str) or not hyperedge_id:
            errors.append(f"{owner} id must be a non-empty string")
        else:
            owner = f"hyperedge {index} ({hyperedge_id})"
        if "node_ids" in hyperedge:
            errors.append(f"{owner} must use 'nodes', not 'node_ids'")
        members = hyperedge.get("nodes")
        if not isinstance(members, list) or len(members) < 3:
            errors.append(f"{owner} nodes must be an array containing at least 3 node ids")
            members = []
        elif any(not isinstance(member, str) or not member for member in members):
            errors.append(f"{owner} nodes must contain only non-empty strings")
        relation = hyperedge.get("relation")
        if relation not in AGENT_SEMANTIC_RELATIONS:
            errors.append(f"{owner} relation {relation!r} must be one of {sorted(AGENT_SEMANTIC_RELATIONS)}")
        errors.extend(_validate_score(hyperedge.get("confidence_score"), owner=owner))
        errors.extend(_validate_source_file(hyperedge.get("source_file"), owner=owner))
        metadata = hyperedge.get("metadata")
        if not isinstance(metadata, dict):
            errors.append(f"{owner} metadata must be an object")
        elif not isinstance(metadata.get("concept"), str) or not metadata.get("concept", "").strip():
            errors.append(f"{owner} metadata.concept must be a non-empty string")
        if require_resolved_endpoints:
            for member in members:
                if isinstance(member, str) and member not in node_ids:
                    errors.append(f"{owner} node {member!r} does not match any node id")

    return errors


def validate_final_agent_graph(data: dict[str, Any], *, semantic_node_ids: Iterable[str]) -> list[str]:
    """Validate the public graph.json shape after NetworkX serialization."""
    if not isinstance(data, dict):
        return ["final graph must be a JSON object"]
    errors: list[str] = []
    for field, expected_type in (
        ("directed", bool),
        ("multigraph", bool),
        ("graph", dict),
        ("nodes", list),
        ("links", list),
        ("hyperedges", list),
    ):
        if not isinstance(data.get(field), expected_type):
            errors.append(f"final graph field {field!r} must be {expected_type.__name__}")
    if "edges" in data:
        errors.append("final graph must use 'links', not 'edges'")
    if errors:
        return errors

    semantic_ids = set(semantic_node_ids)
    for index, node in enumerate(data["nodes"]):
        owner = f"final node {index}"
        if not isinstance(node, dict):
            errors.append(f"{owner} must be an object")
            continue
        node_id = node.get("id")
        for field in ("id", "label", "file_type", "source_file", "norm_label", "community"):
            if field not in node:
                errors.append(f"{owner} missing field {field!r}")
        errors.extend(_validate_source_file(node.get("source_file"), owner=owner))
        if node_id in semantic_ids:
            metadata = node.get("metadata")
            if (
                not isinstance(metadata, dict)
                or not isinstance(metadata.get("entity_type"), str)
                or not metadata.get("entity_type", "").strip()
            ):
                errors.append(f"{owner} semantic metadata.entity_type must be a non-empty string")

    for index, link in enumerate(data["links"]):
        owner = f"final link {index}"
        if not isinstance(link, dict):
            errors.append(f"{owner} must be an object")
            continue
        for field in ("source", "target", "relation", "confidence", "confidence_score", "source_file"):
            if field not in link:
                errors.append(f"{owner} missing field {field!r}")
        errors.extend(_validate_source_file(link.get("source_file"), owner=owner))
        if "metadata" in link and not isinstance(link.get("metadata"), dict):
            errors.append(f"{owner} metadata must be an object when present")

    hyperedge_wrapper = {
        "nodes": [],
        "edges": [],
        "hyperedges": data["hyperedges"],
    }
    errors.extend(validate_agent_extraction(
        hyperedge_wrapper,
        external_node_ids=(str(node.get("id")) for node in data["nodes"] if isinstance(node, dict)),
        require_resolved_endpoints=True,
    ))
    # NetworkX omits empty graph attributes, while ``to_json`` always emits
    # the public top-level hyperedges array.  Treat the absent empty attribute
    # as equivalent, but require exact equality whenever hyperedges exist.
    graph_hyperedges = data["graph"].get("hyperedges", [])
    if graph_hyperedges != data["hyperedges"]:
        errors.append("final graph.graph.hyperedges must equal top-level hyperedges")
    return errors


def format_agent_schema_errors(errors: Iterable[str], *, limit: int = 8) -> str:
    values = list(errors)
    shown = values[:limit]
    message = "; ".join(shown)
    if len(values) > limit:
        message += f"; ... and {len(values) - limit} more"
    return message
