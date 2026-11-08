"""P1.4 — MR/CT/XR pixel-path smoke stays opt-in; default deny unchanged."""

from __future__ import annotations

import numpy as np

from app.imaging.profiles import ct_volume_profile, mri_volume_profile, xray_2d_profile
from app.imaging.preprocessor import ContractImagePreprocessor
from app.models.pixel_authorization import evaluate_pixel_access
from app.routing.capabilities import INPUT_PIXELS_2D, ModelCapability
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, Modality, SourceKind, Species


def test_profiles_exist_for_three_modalities() -> None:
    assert xray_2d_profile("xr-smoke").model_id == "xr-smoke"
    assert mri_volume_profile("mri-smoke").model_id == "mri-smoke"
    assert ct_volume_profile("ct-smoke").model_id == "ct-smoke"


def test_default_pixel_access_denied_without_opt_in() -> None:
    case = CaseRecord(
        case_id="c",
        patient_name="P",
        species=Species.CANINE,
        modality=Modality.XR,
        anatomical_region=AnatomicalRegion.THORAX,
    )
    cap = ModelCapability(
        model_id="future-xr",
        modalities=frozenset({Modality.XR}),
        regions=frozenset({AnatomicalRegion.THORAX}),
        source_kind=SourceKind.REAL,
        allows_pixel_analysis=True,
        input_requirements=frozenset({INPUT_PIXELS_2D}),
    )
    decision = evaluate_pixel_access(
        case, model_id="future-xr", capability=cap, pixel_analysis_opt_in=False
    )
    assert decision.authorized is False


def test_opt_in_prep_smoke_xray() -> None:
    contract = xray_2d_profile("xr-smoke")
    work, provenance = ContractImagePreprocessor().preprocess(
        volume={"pixels": np.random.rand(64, 64).astype("float32"), "sop_instance_uid": "1.2"},
        contract=contract,
        window_center=0.5,
        window_width=1.0,
        resize_hw=(32, 32),
        modality_hint="XR",
    )
    assert work["tensor"].shape[-2:] == (32, 32)
    assert provenance.spatial_chain
