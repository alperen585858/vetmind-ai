"""XR view / species gate: human-PA-trained chest models are only "uncertain" on vet films.

Pure-function tests run without torch; the entrypoint test needs torch and skips otherwise.
"""

from __future__ import annotations

from io import BytesIO

import numpy as np
import pytest
from pydicom import dcmread

from app.dicom.fixtures import build_synthetic_instance
from app.imaging.analysis_limitations import LIMITATION_PREFIX
from app.imaging.contracts import pixel_2d_contract
from app.imaging.decoder import AuthorizedDicomDecoder
from app.models.entrypoints.xray_monai import (
    VIEW_FRONTAL,
    VIEW_LATERAL,
    VIEW_OTHER,
    VIEW_UNTAGGED,
    VIEW_VENTRODORSAL,
    apply_view_gate,
    classify_view,
    view_gate_limitations,
)
from app.schemas.enums import FindingStatus
from app.schemas.model_outputs import ClassificationLabel, ClassificationOutput


def _suspected() -> ClassificationOutput:
    return ClassificationOutput(
        labels=[
            ClassificationLabel(label="CARDIOMEGALY_SUSPECTED", score=0.81,
                                finding_status=FindingStatus.SUSPECTED),
            ClassificationLabel(label="PLEURAL_EFFUSION_SUSPECTED", score=0.66,
                                finding_status=FindingStatus.SUSPECTED),
        ],
        top_label="CARDIOMEGALY_SUSPECTED",
    )


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("PA", VIEW_FRONTAL),
        ("ap", VIEW_FRONTAL),
        ("LL", VIEW_LATERAL),
        ("RL", VIEW_LATERAL),
        (" lateral ", VIEW_LATERAL),
        ("VD", VIEW_VENTRODORSAL),
        ("DV", VIEW_VENTRODORSAL),
        ("", VIEW_UNTAGGED),
        (None, VIEW_UNTAGGED),
        ("OBLIQUE", VIEW_OTHER),
    ],
)
def test_classify_view(raw: str | None, expected: str) -> None:
    assert classify_view(raw) == expected


def _assert_downgraded(limits: list[str]) -> None:
    assert limits
    assert all(line.startswith(LIMITATION_PREFIX) for line in limits)
    gated = apply_view_gate(_suspected(), limits)
    assert [lab.finding_status for lab in gated.labels] == [FindingStatus.UNCERTAIN] * 2
    # Scores and labels are kept: only certainty changes, nothing is invented or dropped.
    assert [lab.score for lab in gated.labels] == [0.81, 0.66]
    assert gated.top_label == "CARDIOMEGALY_SUSPECTED"


def test_lateral_view_downgrades_findings() -> None:
    limits = view_gate_limitations(view_position="LL", species="other")
    _assert_downgraded(limits)
    assert len(limits) == 1
    assert "lateral" in limits[0]
    assert "ViewPosition=LL" in limits[0]


def test_vd_view_downgrades_findings() -> None:
    limits = view_gate_limitations(view_position="VD", species="other")
    _assert_downgraded(limits)
    assert len(limits) == 1
    assert "VD" in limits[0]


def test_untagged_view_downgrades_findings() -> None:
    limits = view_gate_limitations(view_position=None, species="other")
    _assert_downgraded(limits)
    assert "ViewPosition" in limits[0]
    assert "yok" in limits[0]


@pytest.mark.parametrize("species", ["canine", "feline", "CANINE"])
def test_canine_feline_downgrades_even_on_frontal_view(species: str) -> None:
    limits = view_gate_limitations(view_position="PA", species=species)
    _assert_downgraded(limits)
    assert len(limits) == 1
    assert "köpek/kedi" in limits[0]


def test_lateral_canine_reports_both_reasons() -> None:
    limits = view_gate_limitations(view_position="RL", species="canine")
    assert len(limits) == 2
    _assert_downgraded(limits)


def test_frontal_non_vet_species_is_not_gated() -> None:
    limits = view_gate_limitations(view_position="PA", species="other")
    assert limits == []
    original = _suspected()
    assert apply_view_gate(original, limits) is original


def test_gate_on_empty_classification_is_noop() -> None:
    empty = ClassificationOutput(labels=[], top_label=None)
    assert apply_view_gate(empty, ["Sınırlama: x"]) is empty


def _xr_bytes(view_position: str | None) -> bytes:
    raw = build_synthetic_instance(
        study_uid="1.2.3", series_uid="1.2.3.4", instance_number=1,
        modality="DX", body_part="THORAX", include_pixels=True,
    )
    ds = dcmread(BytesIO(raw), force=True)
    if view_position is not None:
        ds.ViewPosition = view_position
    elif "ViewPosition" in ds:
        del ds.ViewPosition
    out = BytesIO()
    ds.save_as(out)
    return out.getvalue()


@pytest.mark.parametrize("view", ["LL", "VD", None])
def test_decoder_reports_view_position(view: str | None) -> None:
    decoded = AuthorizedDicomDecoder().decode_bytes(_xr_bytes(view), contract=pixel_2d_contract("xr"))
    assert decoded["view_position"] == view


@pytest.mark.skipif(
    __import__("importlib").util.find_spec("torch") is None,
    reason="torch not installed (requirements-vision optional)",
)
@pytest.mark.parametrize("view", ["LL", "VD", None])
def test_xray_entrypoint_applies_gate(tmp_path, view: str | None) -> None:  # noqa: ANN001
    from app.imaging.contracts import TransformProvenance
    from app.models.entrypoint import InferenceRequest, PreparedTensorBundle
    from app.models.entrypoints.xray_monai import build_entrypoint, save_tiny_checkpoint
    from app.schemas.enums import AnatomicalRegion, Modality, Species
    from app.schemas.model_input import ImagingModelInput

    ckpt = tmp_path / "xr.pt"
    save_tiny_checkpoint(str(ckpt), seed=1)
    entry = build_entrypoint(model_id="vet-xr", version="0.0.1", weights_path=str(ckpt),
                             score_threshold=0.0)  # keep every label so the gate is visible
    entry.load()
    tensor = np.random.rand(1, 64, 64).astype(np.float32)
    req = InferenceRequest(
        case_id="c1",
        model_id="vet-xr",
        model_version="0.0.1",
        model_input=ImagingModelInput(
            case_id="c1", species=Species.OTHER, modality=Modality.XR,
            anatomical_region=AnatomicalRegion.THORAX,
        ),
        prepared=PreparedTensorBundle(
            layout="chw", tensor_shape=tuple(tensor.shape),
            provenance=TransformProvenance(contract_id="profile.xray_2d:x", steps=("prepare_2d",)),
            tensor=tensor, view_position=view,
        ),
        species="other",
        modality="XR",
        anatomical_region="THORAX",
    )
    out = entry.infer(req)
    assert out.classification is not None and out.classification.labels
    assert {lab.finding_status for lab in out.classification.labels} == {FindingStatus.UNCERTAIN}
    assert any(w.startswith(LIMITATION_PREFIX) for w in out.warnings)
    assert out.processing_metadata["view_gate_applied"] == "true"
    assert out.processing_metadata["model_kind"] == "tiny_contract"
