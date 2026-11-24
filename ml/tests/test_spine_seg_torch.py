"""Torch / MONAI / SimpleITK parts of the spine pipeline (skipped if not installed)."""

from __future__ import annotations

import json

import numpy as np
import pytest

torch = pytest.importorskip("torch")


def test_model_space_roundtrip_keeps_geometry():
    from ml.training.spine_seg.data import from_model_space, to_model_space

    lbl = torch.zeros(1, 40, 24)
    lbl[0, 10:20, 5:15] = 2
    small = to_model_space(lbl, 64, "nearest")
    assert small.shape == (1, 64, 64)
    onehot = torch.nn.functional.one_hot(small[0].long(), 4).permute(2, 0, 1).float()
    back = from_model_space(onehot, 40, 24).argmax(0)
    assert back.shape == (40, 24)
    assert (back == lbl[0].long()).float().mean() > 0.97


def test_end_to_end_on_synthetic_data(tmp_path):
    pytest.importorskip("monai")
    pytest.importorskip("SimpleITK")
    from ml.training.spine_seg import evaluate, prepare_spider, synthetic_spider, train

    raw, prepared, run = tmp_path / "raw", tmp_path / "prepared", tmp_path / "run"
    synthetic_spider.make_dataset(raw, n_patients=8, n_test=2)
    assert prepare_spider.main(["--spider-dir", str(raw), "--out", str(prepared), "--val-frac", "0.3"]) == 0
    splits = json.loads((prepared / "splits.json").read_text())
    assert len(splits["test"]) == 4
    image = np.load(prepared / "series" / f"{splits['test'][0]}_image.npy")
    assert image.shape[0] == 10 and 0.0 <= float(image.min()) and float(image.max()) <= 1.0

    common = ["--data", str(prepared), "--run-dir", str(run), "--size", "32", "--base-channels", "4",
              "--depth", "3", "--batch-size", "4", "--workers", "0", "--max-steps", "2", "--device", "cpu"]
    assert train.main([*common, "--epochs", "1"]) == 0
    assert train.main([*common, "--epochs", "2", "--resume"]) == 0
    log = (run / "log.csv").read_text().strip().splitlines()
    assert len(log) == 3  # header + 2 epochs, the second one resumed
    manifest = json.loads((run / "manifest.json").read_text())
    assert manifest["clinically_approved"] is False

    out = run / "test_results.json"
    assert evaluate.main(["--checkpoint", str(run / "last.pt"), "--data", str(prepared),
                          "--split", "test", "--out", str(out), "--device", "cpu"]) == 0
    result = json.loads(out.read_text())
    assert result["n_series"] == 4 and result["clinically_approved"] is False
    assert set(result["per_class"]) == {"vertebra", "spinal_canal", "disc"}
    assert out.with_suffix(".csv").exists()
