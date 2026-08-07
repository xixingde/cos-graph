"""Tests for graphify save-result file inputs."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

import graphify.__main__ as mainmod


def _run(monkeypatch: pytest.MonkeyPatch, args: list[str]) -> None:
    monkeypatch.setattr(mainmod, "_check_skill_version", lambda _: None)
    monkeypatch.setattr(sys, "argv", ["graphify", "save-result", *args])
    mainmod.main()


def test_save_result_reads_utf8_bom_answer_file(monkeypatch, tmp_path, capsys):
    answer_file = tmp_path / "answer.txt"
    answer_file.write_text("多行答案\nSecond line.", encoding="utf-8-sig")
    memory_dir = tmp_path / "memory"

    _run(
        monkeypatch,
        [
            "--question",
            "What is the answer?",
            "--answer-file",
            str(answer_file),
            "--outcome",
            "useful",
            "--memory-dir",
            str(memory_dir),
        ],
    )

    assert "Saved to" in capsys.readouterr().out
    saved = next(memory_dir.glob("query_*.md")).read_text(encoding="utf-8")
    assert "多行答案\nSecond line." in saved
    assert 'outcome: "useful"' in saved


def test_save_result_reads_correction_file(monkeypatch, tmp_path):
    answer_file = tmp_path / "answer.txt"
    correction_file = tmp_path / "correction.txt"
    answer_file.write_text("Original answer", encoding="utf-8")
    correction_file.write_text("正确答案", encoding="utf-8-sig")
    memory_dir = tmp_path / "memory"

    _run(
        monkeypatch,
        [
            "--question",
            "Correct this",
            "--answer-file",
            str(answer_file),
            "--outcome",
            "corrected",
            "--correction-file",
            str(correction_file),
            "--memory-dir",
            str(memory_dir),
        ],
    )

    saved = next(memory_dir.glob("query_*.md")).read_text(encoding="utf-8")
    assert "## Correction" in saved
    assert "正确答案" in saved


def test_save_result_rejects_answer_and_answer_file(monkeypatch, tmp_path):
    answer_file = tmp_path / "answer.txt"
    answer_file.write_text("file answer", encoding="utf-8")

    with pytest.raises(SystemExit):
        _run(
            monkeypatch,
            [
                "--question",
                "q",
                "--answer",
                "inline answer",
                "--answer-file",
                str(answer_file),
            ],
        )
