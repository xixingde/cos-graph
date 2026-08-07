"""Tests for standalone query vocabulary extraction."""

from __future__ import annotations

from graphify.query_vocab import extract_query_vocabulary


def test_extract_query_vocabulary_matches_skill_algorithm():
    nodes = [
        {"label": "StudentManagementService"},
        {"label": "HTTP_API_v2"},
        {"label": "用户 Repository"},
        {"label": "id"},
    ]

    assert extract_query_vocabulary(nodes) == [
        "api",
        "http",
        "management",
        "repository",
        "service",
        "student",
    ]


def test_extract_query_vocabulary_deduplicates_and_sorts():
    nodes = [{"label": "BetaAlpha"}, {"label": "AlphaBeta"}]

    assert extract_query_vocabulary(nodes) == ["alpha", "beta"]
