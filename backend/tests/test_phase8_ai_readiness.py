"""Phase 8 — AI model integration readiness (no real model load)."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.imaging.contracts import pixel_2d_contract, pixel_3d_contract
from app.imaging.decoder import AuthorizedDicomDecoder
from app.imaging.interfaces import PrepValidationError
from app.imaging.pixel_ops import (
    apply_photometric,
    apply_window,
    normalize_01,
    order_slice_indices,
    parse_pixel_spacing,
    prepare_2d_chw,
    prepare_3d_dhw,
)
from app.imaging.preprocessor import ContractImagePreprocessor
from app.imaging.volume import SliceOrderedVolumeAssembler
from app.models.interfaces import ImagingAdapterError
from app.models.local_torch import LocalTorchConfig, LocalTorchVisionAdapter
from app.models.model_input_builder import build_imaging_model_input
from app.models.synthetic_simulator import SyntheticContractSimulator
from app.models.task_output_mapper import map_task_outputs_to_findings
from app.routing.capabilities import (
    INPUT_PIXELS_2D,
    TASK_CLASSIFICATION,
    ModelCapability,
    default_capabilities,
)
from app.routing.model_router import MANUAL_REVIEW_MODEL, ModelRouter
from app.schemas.case import CaseRecord
from app.schemas.dicom import DicomInstanceMeta, DicomSeriesMeta, DicomStudyMeta
from app.schemas.enums import (
    AnatomicalRegion,
    FindingStatus,
    Modality,
    ModelExecutionStatus,
    SourceKind,
    Species,
)
from app.schemas.findings import StudyInfo
from app.schemas.model_outputs import (
    ClassificationLabel,
    ClassificationOutput,
    ModelTaskOutputs,
)
from app.dicom.fixtures import build_synthetic_instance
from tests.conftest import make_payload


def test_pixel_ops_normalize_window_monochrome() -> None:
    arr = np.array([[0, 100], [50, 200]], dtype=np.float32)
    norm = normalize_01(arr)
    assert float(norm.min()) == 0.0
    assert float(norm.max()) == 1.0
    win = apply_window(arr, window_center=100, window_width=100)
    assert float(win.min()) >= 0.0
    assert float(win.max()) <= 1.0
    mono1 = apply_photometric(arr, "MONOCHROME1")
    assert float(mono1[0, 0]) == 200.0
    mono2 = apply_photometric(arr, "MONOCHROME2")
    assert float(mono2[0, 0]) == 0.0


def test_pixel_spacing_and_slice_order() -> None:
    assert parse_pixel_spacing("0.5\\0.5") == (0.5, 0.5)
    assert parse_pixel_spacing(None) is None
    frames = [
        {"image_position_patient": "0\\0\\2", "instance_number": 2, "sop_instance_uid": "b"},
        {"image_position_patient": "0\\0\\0", "instance_number": 1, "sop_instance_uid": "a"},
        {"image_position_patient": "0\\0\\1", "instance_number": 3, "sop_instance_uid": "c"},
    ]
    assert order_slice_indices(frames) == [1, 2, 0]


def test_prepare_2d_3d_layouts() -> None:
    hw = np.ones((8, 8), dtype=np.float32)
    chw = prepare_2d_chw(hw)
    assert chw.shape == (1, 8, 8)
    vol = np.stack([hw, hw * 2], axis=0)
    dhw = prepare_3d_dhw(vol)
    assert dhw.shape == (2, 8, 8)


def test_decoder_requires_contract_transform() -> None:
    from dataclasses import replace

    data = build_synthetic_instance(include_pixels=True)
    contract = pixel_2d_contract("future-pixel")
    bad = replace(contract, allowed_transforms=("normalize_01",))
    dec = AuthorizedDicomDecoder()
    with pytest.raises(PrepValidationError, match="extract_pixels"):
        dec.decode_bytes(data, contract=bad)


def test_decoder_and_volume_pipeline_on_synthetic() -> None:
    study = "1.2.3"
    series = "1.2.3.4"
    files = [
        build_synthetic_instance(
            study_uid=study,
            series_uid=series,
            instance_number=i,
            include_pixels=True,
        )
        for i in range(1, 4)
    ]
    # Patch IPP into datasets via re-decode after writing positions in raw is hard;
    # assemble using decoder metadata + synthetic IPP override in decoded dicts.
    contract = pixel_3d_contract("future-vol")
    dec = AuthorizedDicomDecoder()
    decoded = []
    for i, raw in enumerate(files):
        d = dec.decode_bytes(raw, contract=contract)
        d["image_position_patient"] = f"0\\0\\{i}"
        decoded.append(d)
    case = CaseRecord(
        case_id="case-vol",
        patient_name="Syn",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        study=StudyInfo(dicom_available=True),
    )
    vol = SliceOrderedVolumeAssembler().assemble(case=case, contract=contract, decoded=decoded)
    assert vol["shape_dhw"][0] == 3
    prep = ContractImagePreprocessor()
    out, prov = prep.preprocess(volume=vol, contract=contract)
    assert out["tensor"].ndim == 3
    assert "order_slices" in prov.steps
    assert prov.pixels_loaded is True


def test_router_unsupported_pixel_requirements_manual_review() -> None:
    caps = [
        ModelCapability(
            model_id="pixel-only-brain",
            modalities=frozenset({Modality.MR}),
            regions=frozenset({AnatomicalRegion.BRAIN}),
            species=frozenset({Species.CANINE}),
            priority=1,
            source_kind=SourceKind.REAL,
            allows_pixel_analysis=True,
            input_requirements=frozenset({INPUT_PIXELS_2D}),
            task_capabilities=frozenset({TASK_CLASSIFICATION}),
            availability="available",
            adapter_kind="local_torch",
        )
    ]
    case = CaseRecord(
        case_id="c1",
        patient_name="P",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        classification_confirmed=True,
        imaging_source_permission_verified=False,
        imaging_analysis_consent_verified=False,
        study=StudyInfo(dicom_available=True),
        dicom_study=DicomStudyMeta(
            study_instance_uid="1.1",
            series=[
                DicomSeriesMeta(
                    series_instance_uid="1.2",
                    modality=Modality.MR,
                    instances=[
                        DicomInstanceMeta(
                            sop_instance_uid="1.3",
                            instance_number=1,
                            filename="a.dcm",
                            has_pixel_data=True,
                        )
                    ],
                )
            ],
        ),
    )
    decision = ModelRouter(capabilities=caps).route(case)
    assert decision.supported is False
    assert decision.model_ids == [MANUAL_REVIEW_MODEL]
    assert decision.rule_id == "fallback.manual_review.unsupported_input"


def test_default_router_still_matches_mocks() -> None:
    case = CaseRecord(
        case_id="c2",
        patient_name="P",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        study=StudyInfo(),
    )
    decision = ModelRouter(capabilities=default_capabilities()).route(case)
    assert decision.supported is True
    assert "mock-brain-mri-v1" in decision.model_ids


def test_local_torch_unconfigured_raises() -> None:
    adapter = LocalTorchVisionAdapter(
        LocalTorchConfig(model_id="local-brain-v1", weights_path=None, entrypoint=None)
    )
    case = CaseRecord(
        case_id="c3",
        patient_name="P",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        study=StudyInfo(),
    )
    case.model_input = build_imaging_model_input(case)
    with pytest.raises(ImagingAdapterError, match="not configured"):
        adapter.analyze(case)
    assert adapter.availability == "not_configured"


def test_synthetic_simulator_task_contracts(client: TestClient) -> None:
    created = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json"))
    case = CaseRecord.model_validate(created.json())
    case.model_input = build_imaging_model_input(case)
    sim = SyntheticContractSimulator()
    outputs = sim.build_task_outputs(case)
    assert outputs.classification is not None
    assert outputs.detection is not None
    assert outputs.segmentation is not None
    assert outputs.measurements is not None
    assert outputs.source_kind == SourceKind.MOCK
    findings = sim.analyze(case)
    assert findings.source_kind == SourceKind.MOCK
    assert findings.execution_status == ModelExecutionStatus.SUCCESS
    assert all(f.synthetic for f in findings.findings)
    # Scores must not be invented
    assert all(f.model_confidence is None for f in findings.findings)


def test_task_output_mapper_failed_clears_findings() -> None:
    case = CaseRecord(
        case_id="c4",
        patient_name="P",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        study=StudyInfo(),
    )
    outputs = ModelTaskOutputs(
        model_id="x",
        model_version="1",
        case_id=case.case_id,
        execution_status=ModelExecutionStatus.FAILED,
        source_kind=SourceKind.REAL,
        classification=ClassificationOutput(
            labels=[ClassificationLabel(label="should_drop", finding_status=FindingStatus.SUSPECTED)]
        ),
    )
    mapped = map_task_outputs_to_findings(case, outputs)
    assert mapped.findings == []
    assert mapped.no_findings_returned is True


def test_models_readiness_endpoint(client: TestClient) -> None:
    res = client.get("/api/v1/models/readiness")
    assert res.status_code == 200
    body = res.json()
    assert body["pixel_analysis_default"] is False
    ids = {m["model_id"] for m in body["models"]}
    assert "mock-brain-mri-v1" in ids
    assert "synthetic-contract-sim-v1" in ids
    syn = next(m for m in body["models"] if m["model_id"] == "synthetic-contract-sim-v1")
    assert syn["availability"] == "synthetic"
    assert syn["enabled"] is False
    assert "classification" in syn["task_capabilities"]
