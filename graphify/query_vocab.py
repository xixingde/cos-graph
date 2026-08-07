"""Vocabulary extraction for agent-assisted graph queries."""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any


_WORD_RE = re.compile(r"[^\W\d_]+", re.UNICODE)
_CAMEL_RE = re.compile(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+")


def extract_query_vocabulary(nodes: Iterable[dict[str, Any]]) -> list[str]:
    """Return normalized label tokens for constrained query expansion.

    This mirrors the inline-Python vocabulary extraction shipped in graphify's
    query skill so standalone binaries produce the same tokens.
    """
    vocabulary: set[str] = set()
    for node in nodes:
        label = str(node.get("label", "") or "")
        for word in _WORD_RE.findall(label):
            parts = _CAMEL_RE.findall(word) or [word]
            for part in parts:
                token = part.lower()
                if 3 <= len(token) <= 30:
                    vocabulary.add(token)
    return sorted(vocabulary)
