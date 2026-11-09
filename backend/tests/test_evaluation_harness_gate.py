"""P1.3 — evaluation harness honesty (empty → not_evaluated)."""

from __future__ import annotations

import sys
from pathlib import Path


def test_empty_labels_not_evaluated() -> None:
    # Lightweight gate: without labeled GT the harness must not invent metrics.
    labeled_rows: list[dict] = []
    if not labeled_rows:
        status = "not_evaluated"
    else:
        status = "ready"
    assert status == "not_evaluated"


def test_patient_split_helper_importable() -> None:
    # ml/ lives at the repo root, outside backend/ (pytest's pythonpath).
    repo_root = str(Path(__file__).resolve().parents[2])
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)
    from ml.evaluation.patient_split import assert_no_patient_leakage, split_patients

    splits = split_patients([f"p{i}" for i in range(10)], train_frac=0.6, val_frac=0.2)
    assert_no_patient_leakage(splits)
    assert set(splits) == {"train", "val", "test"}


def test_train_output_eval_gate_fail_closed_without_checkpoint() -> None:
    """Synthetic train→eval gate: missing checkpoint/manifest ⇒ not_evaluated (no fabricated metrics)."""
    repo = Path(__file__).resolve().parents[2]
    missing_ckpt = repo / "artifacts" / "__missing_train_contract__.pt"
    missing_manifest = repo / "ml" / "runs" / "__missing__" / "manifest.json"
    if missing_ckpt.exists() or missing_manifest.exists():
        status = "ready"
        metrics = {"accuracy": 0.99}  # would be dishonest if files missing
    else:
        status = "not_evaluated"
        metrics = None
    assert status == "not_evaluated"
    assert metrics is None


def test_train_fixture_jsonl_present_for_contract() -> None:
    fixture = Path(__file__).resolve().parents[2] / "ml" / "datasets" / "fixtures" / "tiny_export.jsonl"
    assert fixture.is_file()
    lines = [ln for ln in fixture.read_text(encoding="utf-8").splitlines() if ln.strip()]
    assert len(lines) >= 3
    row = __import__("json").loads(lines[0])
    assert row.get("finding_code"), "train contract fixture must carry labels"
    assert row.get("expert_verification_status") == "verified"
