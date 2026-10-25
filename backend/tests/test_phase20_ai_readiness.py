"""Phase 20 — final AI integration readiness (no real models)."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.imaging.series_selection import select_series_for_modality
from app.main import create_app
from app.models.dicom_study_merge import merge_study_into
from app.models.model_input_builder import build_imaging_model_input
from app.models.schema_validation import validate_bridge_model_config, validate_model_task_outputs
from app.models.synthetic_bridge import run_synthetic_integration_walkthrough
from app.schemas.case import CaseRecord
from app.schemas.dicom import DicomInstanceMeta, DicomSeriesMeta, DicomStudyMeta
from app.schemas.enums import AnatomicalRegion, Modality, ModelExecutionStatus, SourceKind, Species
from app.schemas.findings import StudyInfo
from app.schemas.model_outputs import ModelTaskOutputs
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


def _client(tmp_path: Path) -> TestClient:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=tmp_path / "unused.sqlite3",
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-phase20",
        tenant_isolation=True,
        async_analyze_delay_ms=0,
    )
    return TestClient(create_app(AppContainer(repo=InMemoryCaseRepository(), settings=settings)))


def test_series_selection_mri_prefers_spatial_stack() -> None:
    case = CaseRecord(
        case_id="case-sel",
        patient_name="P",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        study=StudyInfo(dicom_available=True),
        dicom_study=DicomStudyMeta(
            study_instance_uid="1.2.3",
            series=[
                DicomSeriesMeta(
                    series_instance_uid="ser-thin",
                    modality=Modality.MR,
                    instances=[
                        DicomInstanceMeta(
                            sop_instance_uid="s1",
                            instance_number=1,
                            has_pixel_data=True,
                            image_position_patient="0\\0\\0",
                        )
                    ],
                ),
                DicomSeriesMeta(
                    series_instance_uid="ser-vol",
                    modality=Modality.MR,
                    instances=[
                        DicomInstanceMeta(
                            sop_instance_uid=f"v{i}",
                            instance_number=i,
                            has_pixel_data=True,
                            image_position_patient=f"0\\0\\{i}",
                            ingest_id="ing-b",
                        )
                        for i in range(4)
                    ],
                ),
            ],
        ),
    )
    mi = build_imaging_model_input(case)
    assert mi.selection.profile_hint == "mri_volume"
    assert mi.selection.series_instance_uids == ["ser-vol"]
    assert mi.selection.selected_instance_count == 4
    assert mi.selection.spatial_instance_count == 4
    assert any(s.selected_for_model for s in mi.series if s.series_instance_uid == "ser-vol")


def test_merge_multi_ingest_studies() -> None:
    a = DicomStudyMeta(
        study_instance_uid="1.2.3",
        series=[
            DicomSeriesMeta(
                series_instance_uid="ser-a",
                instances=[
                    DicomInstanceMeta(sop_instance_uid="a1", has_pixel_data=True, instance_number=1)
                ],
            )
        ],
    )
    b = DicomStudyMeta(
        study_instance_uid="1.2.3",
        series=[
            DicomSeriesMeta(
                series_instance_uid="ser-b",
                instances=[
                    DicomInstanceMeta(sop_instance_uid="b1", has_pixel_data=True, instance_number=1)
                ],
            )
        ],
    )
    merged = merge_study_into(a, b, ingest_id="ing-2")
    assert len(merged.series) == 2
    ser_b = next(s for s in merged.series if s.series_instance_uid == "ser-b")
    assert ser_b.instances[0].ingest_id == "ing-2"


def test_schema_validation_and_config_blockers() -> None:
    blockers = validate_bridge_model_config(
        {
            "model_id": "real-mri",
            "version": "1.0.0",
            "adapter_kind": "local_torch",
            "requires_pixels": True,
            "allows_pixel_analysis": True,
            "input_contract_id": "imaging-model-input/1.1.0",
        }
    )
    assert "weights_path_missing" in blockers

    outs = validate_model_task_outputs(
        {
            "model_id": "x",
            "model_version": "1",
            "case_id": "c",
            "execution_status": ModelExecutionStatus.SUCCESS.value,
            "source_kind": SourceKind.MOCK.value,
        }
    )
    assert outs.model_id == "x"


def test_readiness_exposes_blockers_and_remaining_steps(tmp_path: Path) -> None:
    client = _client(tmp_path)
    res = client.get(
        "/api/v1/models/readiness",
        headers={"X-API-Key": "test-api-key"},
    )
    assert res.status_code == 200
    body = res.json()
    assert "blockers" in body["models"][0]
    assert "remaining_steps_to_first_real_model" in body
    assert body["models_with_blockers"] >= 1
    assert len(body["remaining_steps_to_first_real_model"]) >= 3


def test_readiness_requires_auth_when_enabled(tmp_path: Path) -> None:
    client = _client(tmp_path)
    denied = client.get("/api/v1/models/readiness")
    assert denied.status_code == 401


def test_synthetic_integration_walkthrough_dicom_to_draft(tmp_path: Path) -> None:
    result = run_synthetic_integration_walkthrough(
        modality=Modality.MR, quarantine_root=tmp_path / "q"
    )
    assert result["modality"] == "MR"
    assert result["profile_hint"] == "mri_volume"
    assert result["selected_frames"] >= 2
    assert result["prep_contract"]
    assert result["bridge"]
    assert result["draft_report_id"]
    assert result["no_fake_clinical_scores"] is True
    assert result["findings_model_id"]


def test_xr_selection_single_frame() -> None:
    from app.schemas.model_input import ModelInputFrameRef, ModelInputSeriesRef

    series = [
        ModelInputSeriesRef(
            series_instance_uid="xr1",
            modality=Modality.XR,
            frame_count=1,
            frames=[
                ModelInputFrameRef(
                    sop_instance_uid="x1",
                    series_instance_uid="xr1",
                    has_pixel_data=True,
                    instance_number=1,
                )
            ],
        )
    ]
    sel = select_series_for_modality(series, Modality.XR)
    assert sel.profile_hint == "xray_2d"
    assert len(sel.frames) == 1
