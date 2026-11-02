"""PyTorch/MONAI integration foundations — torch optional for most tests."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from app.imaging.pixel_ops import apply_rescale_to_hu, normalize_01, resize_2d
from app.imaging.preprocessor import ContractImagePreprocessor
from app.imaging.profiles import ct_volume_profile, mri_volume_profile, xray_2d_profile
from app.imaging.quality import check_array_quality
from app.models.calibration import load_calibration_artifact
from app.models.errors import InferenceFailedError, ModelUnavailableError
from app.models.weight_cache import WeightCache, WeightCacheKey, require_weights_file
from app.security.retention import cleanup_vision_artifacts


def test_require_weights_fail_closed(tmp_path: Path) -> None:
    with pytest.raises(ModelUnavailableError):
        require_weights_file(None, model_id="x")
    with pytest.raises(ModelUnavailableError):
        require_weights_file(str(tmp_path / "missing.pt"), model_id="x")


def test_weight_cache_put_get() -> None:
    cache = WeightCache()
    key = WeightCacheKey("m", "1", "cpu")
    from app.models.weight_cache import CachedWeights

    entry = CachedWeights(
        key=key,
        weights_path="/tmp/x.pt",
        digest_sha256="abc",
        payload={"ok": True},
        meta={},
    )
    cache.put(entry)
    assert cache.get(key) is entry
    assert cache.describe()[0]["model_id"] == "m"


def test_hu_rescale_slope_intercept() -> None:
    raw = np.array([[0.0, 1.0], [2.0, 3.0]], dtype=np.float32)
    hu = apply_rescale_to_hu(raw, rescale_slope=2.0, rescale_intercept=-1000.0)
    assert float(hu[0, 0]) == -1000.0
    assert float(hu[1, 1]) == -994.0


def test_ct_profile_includes_hu_rescale() -> None:
    contract = ct_volume_profile("vet-ct")
    assert "hu_rescale" in contract.allowed_transforms
    assert "hu_window" in contract.allowed_transforms


def test_mri_profile_skips_hu() -> None:
    contract = mri_volume_profile("vet-mri")
    assert "hu_window" not in contract.allowed_transforms
    assert "hu_rescale" not in contract.allowed_transforms


def test_preprocessor_ct_requires_ww_wc() -> None:
    contract = ct_volume_profile("vet-ct")
    prep = ContractImagePreprocessor()
    vol = {
        "volume": np.zeros((4, 8, 8), dtype=np.float32),
        "rescale_slope": 1.0,
        "rescale_intercept": -1024.0,
        "pixel_spacing": "1\\1",
    }
    with pytest.raises(Exception) as exc:
        prep.preprocess(volume=vol, contract=contract, modality_hint="CT")
    assert "window_center" in str(exc.value).lower() or "hu_window" in str(exc.value).lower()


def test_preprocessor_ct_with_window() -> None:
    contract = ct_volume_profile("vet-ct")
    prep = ContractImagePreprocessor()
    vol = {
        "volume": np.linspace(0, 100, 4 * 8 * 8, dtype=np.float32).reshape(4, 8, 8),
        "rescale_slope": 1.0,
        "rescale_intercept": 0.0,
        "pixel_spacing": "1\\1",
        "sop_instance_uids": ["a", "b", "c", "d"],
    }
    out, prov = prep.preprocess(
        volume=vol,
        contract=contract,
        window_center=40.0,
        window_width=80.0,
        modality_hint="CT",
    )
    assert "hu_rescale" in prov.steps
    assert "hu_window" in prov.steps
    assert out["tensor"].shape[0] == 4


def test_xray_resize_numpy_fallback() -> None:
    arr = np.random.rand(32, 32).astype(np.float32)
    out = resize_2d(arr, height=16, width=16)
    assert out.shape == (16, 16)


def test_quality_check_rejects_empty() -> None:
    with pytest.raises(Exception):
        check_array_quality(np.array([]))


def test_cleanup_vision_artifacts(tmp_path: Path) -> None:
    old = tmp_path / "bridge-case-aaaaaaaaaa"
    old.mkdir()
    (old / "tensor_f16.npy").write_bytes(b"x")
    # Force old mtime
    import os
    import time

    past = time.time() - 10 * 86400
    os.utime(old, (past, past))
    removed = cleanup_vision_artifacts(tmp_path, older_than_days=1, dry_run=False)
    assert "bridge-case-aaaaaaaaaa" in removed
    assert not old.exists()


def test_calibration_missing_path() -> None:
    assert load_calibration_artifact(None) is None


def test_xray_entrypoint_import_without_torch() -> None:
    # Importing the module must not require torch at import time.
    from app.models.entrypoints import xray_monai

    assert callable(xray_monai.build_entrypoint)


@pytest.mark.skipif(
    __import__("importlib").util.find_spec("torch") is None,
    reason="torch not installed (requirements-vision optional)",
)
def test_xray_entrypoint_forward_tiny_checkpoint(tmp_path: Path) -> None:
    from app.imaging.contracts import TransformProvenance
    from app.models.entrypoint import InferenceRequest, PreparedTensorBundle
    from app.models.entrypoints.xray_monai import build_entrypoint, save_tiny_checkpoint
    from app.schemas.model_input import ImagingModelInput
    from app.schemas.enums import AnatomicalRegion, Modality, Species

    ckpt = tmp_path / "xr.pt"
    save_tiny_checkpoint(str(ckpt), seed=1)
    entry = build_entrypoint(
        model_id="vet-xr-thorax-v1",
        version="0.0.1-test",
        weights_path=str(ckpt),
        device="cpu",
    )
    entry.load()
    assert entry.is_ready()

    tensor = normalize_01(np.random.rand(1, 64, 64).astype(np.float32))
    mi = ImagingModelInput(
        case_id="c1",
        species=Species.CANINE,
        modality=Modality.XR,
        anatomical_region=AnatomicalRegion.THORAX,
    )
    req = InferenceRequest(
        case_id="c1",
        model_id="vet-xr-thorax-v1",
        model_version="0.0.1-test",
        model_input=mi,
        prepared=PreparedTensorBundle(
            layout="chw",
            tensor_shape=tuple(tensor.shape),
            provenance=TransformProvenance(contract_id="profile.xray_2d:x", steps=("prepare_2d",)),
            tensor=tensor,
        ),
        species="canine",
        modality="XR",
        anatomical_region="THORAX",
    )
    out = entry.infer(req)
    assert out.model_id == "vet-xr-thorax-v1"
    assert out.processing_metadata.get("clinically_validated") == "false"
    assert out.classification is not None


@pytest.mark.skipif(
    __import__("importlib").util.find_spec("torch") is None,
    reason="torch not installed",
)
def test_mri_rejects_xr_modality(tmp_path: Path) -> None:
    from app.imaging.contracts import TransformProvenance
    from app.models.entrypoint import InferenceRequest, PreparedTensorBundle
    from app.models.entrypoints.mri_monai import build_entrypoint, save_tiny_checkpoint
    from app.schemas.model_input import ImagingModelInput
    from app.schemas.enums import AnatomicalRegion, Modality, Species

    ckpt = tmp_path / "mri.pt"
    save_tiny_checkpoint(str(ckpt))
    entry = build_entrypoint(
        model_id="vet-mri",
        version="0.0.1",
        weights_path=str(ckpt),
        device="cpu",
    )
    entry.load()
    vol = np.random.rand(4, 16, 16).astype(np.float32)
    mi = ImagingModelInput(
        case_id="c1",
        species=Species.CANINE,
        modality=Modality.XR,
        anatomical_region=AnatomicalRegion.THORAX,
    )
    req = InferenceRequest(
        case_id="c1",
        model_id="vet-mri",
        model_version="0.0.1",
        model_input=mi,
        prepared=PreparedTensorBundle(
            layout="dhw",
            tensor_shape=tuple(vol.shape),
            provenance=TransformProvenance(contract_id="x", steps=()),
            tensor=vol,
        ),
        species="canine",
        modality="XR",
        anatomical_region="THORAX",
    )
    with pytest.raises(InferenceFailedError):
        entry.infer(req)


def test_patient_split_no_leakage() -> None:
    import sys

    repo = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(repo / "ml" / "evaluation"))
    # Import via path file load
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "patient_split",
        repo / "ml" / "evaluation" / "patient_split.py",
    )
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    splits = mod.split_patients([f"p{i}" for i in range(100)])
    mod.assert_no_patient_leakage(splits)
    assert set(splits["train"]) | set(splits["val"]) | set(splits["test"]) == {
        f"p{i}" for i in range(100)
    }


def test_evidence_bbox_on_mapper() -> None:
    from app.models.task_output_mapper import map_task_outputs_to_findings
    from app.schemas.case import CaseRecord
    from app.schemas.enums import AnatomicalRegion, Modality, ModelExecutionStatus, SourceKind, Species
    from app.schemas.model_outputs import (
        BoundingBox2D,
        DetectionOutput,
        ModelTaskOutputs,
    )

    case = CaseRecord(
        case_id="c-map",
        patient_name="x",
        species=Species.CANINE,
        modality=Modality.XR,
        anatomical_region=AnatomicalRegion.THORAX,
    )
    outs = ModelTaskOutputs(
        model_id="m",
        model_version="1",
        case_id="c-map",
        execution_status=ModelExecutionStatus.SUCCESS,
        source_kind=SourceKind.REAL,
        detection=DetectionOutput(
            boxes=[
                BoundingBox2D(
                    x_min=1,
                    y_min=2,
                    x_max=10,
                    y_max=20,
                    label="opacity",
                    score=0.8,
                )
            ]
        ),
    )
    findings = map_task_outputs_to_findings(case, outs)
    assert findings.findings[0].evidence_references[0].bbox is not None
    assert findings.findings[0].model_confidence == 0.8
