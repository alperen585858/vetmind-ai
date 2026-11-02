"""Pretrained TorchXRayVision chest X-ray path of the XR entrypoint (skips without vision extras)."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

torch = pytest.importorskip("torch")
xrv = pytest.importorskip("torchxrayvision")
pytest.importorskip("monai")

from app.models.entrypoints.xray_monai import (  # noqa: E402
    DEFAULT_TXRV_LABEL_MAP,
    TXRV_ARCHITECTURE,
    build_entrypoint,
)
from app.models.errors import ModelUnavailableError  # noqa: E402


def _checkpoint(path: Path, **overrides) -> str:
    """Random-init DenseNet in the exported layout — no weight download in tests."""
    torch.manual_seed(0)
    module = xrv.models.DenseNet(weights=None, num_classes=18, op_threshs=torch.full((18,), 0.1))
    payload = {
        "architecture": TXRV_ARCHITECTURE,
        "source_labels": list(xrv.datasets.default_pathologies),
        "label_map": dict(DEFAULT_TXRV_LABEL_MAP),
        "clinically_approved": False,
        "state_dict": module.state_dict(),
        **overrides,
    }
    torch.save(payload, path)
    return str(path)


def _request(arr: np.ndarray):
    return SimpleNamespace(
        prepared=SimpleNamespace(tensor=arr, artifact_path=None),
        case_id="c1",
        model_id="vet-xr-thorax-v1",
        model_version="t",
    )


def test_txrv_checkpoint_reports_vet_codes_for_non_square_image(tmp_path: Path) -> None:
    ep = build_entrypoint(model_id="vet-xr-thorax-v1", version="t", weights_path=_checkpoint(tmp_path / "m.pt"))
    ep.load()
    arr = np.random.default_rng(0).random((1, 300, 500), dtype=np.float32)  # landscape, like lateral thorax
    out = ep.infer(_request(arr))
    meta = out.processing_metadata
    assert meta["architecture"] == TXRV_ARCHITECTURE
    reported = [part.split("=")[0] for part in meta["raw_scores"].split(",")]
    assert sorted(reported) == sorted(DEFAULT_TXRV_LABEL_MAP.values())
    assert all(0.0 <= float(part.split("=")[1]) <= 1.0 for part in meta["raw_scores"].split(","))
    assert any("human chest radiographs" in w for w in out.warnings)
    for label in out.classification.labels:
        assert label.label in DEFAULT_TXRV_LABEL_MAP.values()


def test_txrv_checkpoint_without_labels_fails_closed(tmp_path: Path) -> None:
    ep = build_entrypoint(
        model_id="vet-xr-thorax-v1", version="t", weights_path=_checkpoint(tmp_path / "m.pt", source_labels=[])
    )
    with pytest.raises(ModelUnavailableError):
        ep.load()


def test_txrv_label_map_matching_nothing_fails_closed(tmp_path: Path) -> None:
    ep = build_entrypoint(
        model_id="vet-xr-thorax-v1", version="t", weights_path=_checkpoint(tmp_path / "m.pt", label_map={"Nope": "X"})
    )
    with pytest.raises(ModelUnavailableError):
        ep.load()
