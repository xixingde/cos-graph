from __future__ import annotations

from pathlib import Path

from graphify.agent_schema import (
    normalise_agent_extraction,
    validate_agent_extraction,
    validate_final_agent_graph,
)


def _valid_extraction(root: Path) -> dict:
    source = str(root / "doc" / "kb.md")
    nodes = [
        {
            "id": f"concept:{index}",
            "label": f"Concept {index}",
            "file_type": "concept",
            "source_file": source,
            "metadata": {"entity_type": "concept"},
        }
        for index in range(3)
    ]
    return {
        "nodes": nodes,
        "edges": [{
            "source": "concept:0",
            "target": "concept:1",
            "relation": "references",
            "confidence": "EXTRACTED",
            "confidence_score": 0.95,
            "source_file": source,
        }],
        "hyperedges": [{
            "id": "hyperedge:concepts",
            "nodes": ["concept:0", "concept:1", "concept:2"],
            "relation": "conceptually_related_to",
            "confidence_score": 0.8,
            "source_file": source,
            "metadata": {"concept": "Concept group"},
        }],
    }


def test_normalise_and_validate_old_compatible_extraction(tmp_path: Path) -> None:
    root = tmp_path / "project"
    root.mkdir()
    data = normalise_agent_extraction(_valid_extraction(root), root=root)

    assert data["nodes"][0]["source_file"] == "doc/kb.md"
    assert data["edges"][0]["source_file"] == "doc/kb.md"
    assert data["hyperedges"][0]["source_file"] == "doc/kb.md"
    assert validate_agent_extraction(data, require_resolved_endpoints=True) == []


def test_current_malformed_hyperedge_aliases_are_not_guessed(tmp_path: Path) -> None:
    root = tmp_path / "project"
    root.mkdir()
    data = _valid_extraction(root)
    data["hyperedges"] = [{
        "id": "hyperedge:concepts",
        "node_ids": ["concept:0", "concept:1", "concept:2"],
        "type": "topic_group",
        "confidence_score": 0.8,
        "source_file": str(root / "doc" / "kb.md"),
    }]

    normalized = normalise_agent_extraction(data, root=root)
    hyperedge = normalized["hyperedges"][0]
    assert hyperedge["nodes"] == ["concept:0", "concept:1", "concept:2"]
    assert hyperedge["metadata"]["type"] == "topic_group"
    assert "relation" not in hyperedge
    errors = validate_agent_extraction(normalized, require_resolved_endpoints=True)
    assert any("relation None" in error for error in errors)
    assert any("metadata.concept" in error for error in errors)


def test_unknown_relation_and_missing_node_metadata_are_rejected(tmp_path: Path) -> None:
    root = tmp_path / "project"
    root.mkdir()
    data = normalise_agent_extraction(_valid_extraction(root), root=root)
    data["nodes"][0].pop("metadata")
    data["edges"][0]["relation"] = "describes"

    errors = validate_agent_extraction(data)
    assert any("metadata must be an object" in error for error in errors)
    assert any("relation 'describes'" in error for error in errors)


def test_final_graph_requires_metadata_only_for_semantic_nodes(tmp_path: Path) -> None:
    root = tmp_path / "project"
    root.mkdir()
    extraction = normalise_agent_extraction(_valid_extraction(root), root=root)
    semantic_nodes = [
        {
            **node,
            "norm_label": node["label"].casefold(),
            "community": 0,
        }
        for node in extraction["nodes"]
    ]
    ast_node = {
        "id": "code:main",
        "label": "main",
        "file_type": "code",
        "source_file": "main.py",
        "norm_label": "main",
        "community": 0,
    }
    links = [{**extraction["edges"][0]}]
    graph = {
        "directed": False,
        "multigraph": False,
        "graph": {"hyperedges": extraction["hyperedges"]},
        "nodes": [ast_node, *semantic_nodes],
        "links": links,
        "hyperedges": extraction["hyperedges"],
    }

    assert validate_final_agent_graph(
        graph,
        semantic_node_ids={node["id"] for node in semantic_nodes},
    ) == []
    semantic_nodes[0].pop("metadata")
    errors = validate_final_agent_graph(
        graph,
        semantic_node_ids={node["id"] for node in semantic_nodes},
    )
    assert any("semantic metadata.entity_type" in error for error in errors)
