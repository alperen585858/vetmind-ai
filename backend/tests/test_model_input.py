"""ImagingModelInput contract — AI-facing study package."""

from fastapi.testclient import TestClient

from app.dicom.fixtures import brain_mri_study_files
from app.models.model_input_builder import build_imaging_model_input
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, Modality, Species
from tests.conftest import make_payload


def test_build_model_input_from_synthetic_case() -> None:
    case = CaseRecord(
        case_id="case-test",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
    )
    pkg = build_imaging_model_input(case)
    assert pkg.schema_version == "1.0.0"
    assert pkg.metadata_only is True
    assert pkg.pixel_analysis_authorized is False
    assert "mock-brain-mri-v1" in pkg.prepared_for_models


def test_api_prepare_model_input_after_dicom(client: TestClient) -> None:
    files = brain_mri_study_files(2)
    upload = client.post(
        "/api/v1/dicom/upload",
        data={"patient_name": "AI Pack", "species": "canine"},
        files=[("files", (n, d, "application/dicom")) for n, d in files],
    )
    assert upload.status_code == 201
    confirmed = client.post(
        f"/api/v1/dicom/ingestions/{upload.json()['ingest_id']}/confirm",
        json={"accept_suggestion": True},
    )
    assert confirmed.status_code == 200
    case_id = confirmed.json()["case_id"]
    assert confirmed.json()["model_input"]["total_instances"] == 2

    packed = client.post(f"/api/v1/cases/{case_id}/model-input")
    assert packed.status_code == 200
    body = packed.json()
    assert body["schema_version"] == "1.0.0"
    assert body["total_instances"] == 2
    assert len(body["series"]) >= 1
    assert body["pixel_analysis_authorized"] is False

    analyzed = client.post(f"/api/v1/cases/{case_id}/analyze")
    assert analyzed.status_code == 200
    findings = client.get(f"/api/v1/cases/{case_id}/findings").json()
    assert any("ImagingModelInput" in w for w in findings["warnings"])


def test_create_case_has_model_input(client: TestClient) -> None:
    created = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json"))
    assert created.status_code == 201
    assert created.json()["model_input"]["modality"] == "MR"
