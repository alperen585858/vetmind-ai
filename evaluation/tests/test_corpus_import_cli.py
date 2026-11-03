"""Corpus Intake offline CLI and file safety checks: parser fixtures, not clinical cases."""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys

from benchmarks.import_corpus_terminology import import_corpus, main
from evaluation.clinical_terminology.catalog import TermCatalog
from evaluation.clinical_terminology.corpus_candidates import CorpusReviewQueue


def make_source(tmp_path: Path) -> Path:
    payload = {
        "suture_closure_rules_months": {"structures": {
            "Alpha structure": {"dogs": [1, 2], "cats": None},
            "Gamma structure (do not auto-promote)": {"dogs": [1], "cats": [2]},
        }},
        "anatomical_pitfalls": [{"structure": "Unverified composite & context", "description": "Patient Secret"}],
    }
    path = tmp_path / "source.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_dry_run_creates_no_outputs(tmp_path):
    source = make_source(tmp_path)
    result = import_corpus(source, tmp_path / "queue.json", tmp_path / "draft.json", dry_run=True)
    assert result["status"] == "dry_run"
    assert result["clinical_metrics"] is None
    assert not (tmp_path / "queue.json").exists()


def test_saved_queue_and_draft_roundtrip(tmp_path):
    source = make_source(tmp_path)
    a, b = tmp_path / "queue.json", tmp_path / "draft.json"
    result = import_corpus(source, a, b, dry_run=False)
    assert result["status"] == "pending_review_exported"
    queue = CorpusReviewQueue.model_validate_json(a.read_bytes())
    draft = TermCatalog.model_validate_json(b.read_bytes())
    assert len(queue.candidates) == 3
    assert draft.reviewed_count == 0
    assert len(draft.terms) == 1
    assert "Patient Secret" not in a.read_text()


def test_existing_output_never_overwritten(tmp_path):
    source = make_source(tmp_path)
    a, b = tmp_path / "queue.json", tmp_path / "draft.json"
    a.write_text("DO-NOT-REPLACE")
    assert main(["--source", str(source), "--review-output", str(a), "--draft-output", str(b)]) == 2
    assert a.read_text() == "DO-NOT-REPLACE"
    assert not b.exists()


def test_existing_draft_never_overwritten(tmp_path):
    source = make_source(tmp_path)
    a, b = tmp_path / "queue.json", tmp_path / "draft.json"
    b.write_text("DO-NOT-REPLACE")
    assert main(["--source", str(source), "--review-output", str(a), "--draft-output", str(b)]) == 2
    assert b.read_text() == "DO-NOT-REPLACE"
    assert not a.exists()


def test_same_path_rejected(tmp_path):
    source = make_source(tmp_path)
    dest = tmp_path / "out.json"
    assert main(["--source", str(source), "--review-output", str(dest), "--draft-output", str(dest)]) == 2


def test_source_output_collision_rejected(tmp_path):
    source = make_source(tmp_path)
    assert main(["--source", str(source), "--review-output", str(source), "--draft-output", str(tmp_path / "draft.json")]) == 2


def test_missing_parent_rejected(tmp_path):
    source = make_source(tmp_path)
    assert main(["--source", str(source), "--review-output", str(tmp_path / "missing/queue.json"), "--draft-output", str(tmp_path / "draft.json")]) == 2


def test_invalid_source_does_not_echo_sensitive_data(tmp_path, capsys):
    src = tmp_path / "source.json"
    src.write_text('{"patient_name":"Sensitive Patient"}', encoding="utf-8")
    assert main(["--source", str(src), "--dry-run"]) == 2
    captured = capsys.readouterr()
    assert "Sensitive Patient" not in captured.out + captured.err
    assert "invalid_source_or_destination" in captured.err


def test_dry_run_prints_counts_and_not_raw_labels(tmp_path, capsys):
    src = make_source(tmp_path)
    assert main(["--source", str(src), "--dry-run"]) == 0
    output = capsys.readouterr().out
    obj = json.loads(output)
    assert obj["candidate_counts"]["candidates"] == 3
    assert obj["expert_reviewed_entries"] == 0
    assert "Alpha structure" not in output


def test_cli_standalone_repo_corpus_dry_run():
    root = Path(__file__).resolve().parents[2]
    script = root / "benchmarks/import_corpus_terminology.py"
    run = subprocess.run([sys.executable, str(script), "--dry-run"], cwd=str(root), capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    report = json.loads(run.stdout)
    assert report["candidate_counts"]["candidates"] == 19
    assert report["clinical_validation"] == "not_evaluated"


def test_cli_without_source(tmp_path, capsys):
    assert main(["--source", str(tmp_path / "absent.json"), "--dry-run"]) == 2
    assert "invalid_source_or_destination" in capsys.readouterr().err
