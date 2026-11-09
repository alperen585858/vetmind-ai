"""CPU-safe train contract: export JSONL → tiny loop → checkpoint metadata."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
TRAIN_SCRIPT = REPO / "ml" / "training" / "train_xray_classifier.py"
FIXTURE = REPO / "ml" / "datasets" / "fixtures" / "tiny_export.jsonl"


def _torch_available() -> bool:
    try:
        import torch  # noqa: F401

        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _torch_available(), reason="torch not installed (vision extras optional)")


def test_train_script_writes_nonclinical_checkpoint_and_manifest(tmp_path: Path) -> None:
    out = tmp_path / "model.pt"
    run_dir = tmp_path / "run"
    proc = subprocess.run(
        [
            sys.executable,
            str(TRAIN_SCRIPT),
            "--jsonl",
            str(FIXTURE),
            "--out",
            str(out),
            "--epochs",
            "2",
            "--seed",
            "1",
            "--run-dir",
            str(run_dir),
        ],
        cwd=str(REPO),
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert out.is_file()

    import torch

    payload = torch.load(out, map_location="cpu", weights_only=False)
    assert payload.get("clinically_approved") is False
    assert payload.get("architecture") == "tiny_xr_classifier"
    assert len(payload.get("label_names") or []) >= 2
    assert (run_dir / "manifest.json").is_file()
    manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["schema"] == "vetmind.experiment_manifest.v1"
    assert manifest["promotable_to_production"] is False
    assert manifest["clinically_approved"] is False


def test_train_script_refuses_unlabeled_jsonl_without_fallback(tmp_path: Path) -> None:
    empty = tmp_path / "empty.jsonl"
    empty.write_text(
        json.dumps(
            {
                "case_id": "c1",
                "patient_id": "anon-x",
                "finding_id": "f1",
                "evidence_id": "e1",
                "expert_verification_status": "verified",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    out = tmp_path / "model.pt"
    proc = subprocess.run(
        [sys.executable, str(TRAIN_SCRIPT), "--jsonl", str(empty), "--out", str(out), "--epochs", "1"],
        cwd=str(REPO),
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode != 0
    assert "No labeled rows" in (proc.stderr + proc.stdout)
    assert not out.exists()
