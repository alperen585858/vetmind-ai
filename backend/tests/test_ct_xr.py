"""CT / XR fixture ingest + mock adapter routing."""

from fastapi.testclient import TestClient

from app.dicom.fixtures import brain_ct_study_files, thorax_xr_study_files
from app.dicom.ingest import ingest_dicom_files
from app.schemas.enums import AnatomicalRegion, Modality, Species


def test_ingest_brain_ct() -> None:
    result = ingest_dicom_files(brain_ct_study_files(2))
    assert result.blocked is False
    assert result.classification is not None
    assert result.classification.suggested_modality == Modality.CT
    assert result.classification.suggested_anatomical_region == AnatomicalRegion.BRAIN


def test_ingest_thorax_xr() -> None:
    result = ingest_dicom_files(thorax_xr_study_files(1))
    assert result.blocked is False
    assert result.classification is not None
    assert result.classification.suggested_modality == Modality.XR
    assert result.classification.suggested_anatomical_region == AnatomicalRegion.THORAX


def test_api_demo_brain_ct(client: TestClient) -> None:
    upload = client.post(
        "/api/v1/dicom/demo/brain_ct",
        data={"patient_name": "CT Demo", "species": Species.CANINE.value},
    )
    assert upload.status_code == 201, upload.text
    ingest_id = upload.json()["ingest_id"]
    confirmed = client.post(
        f"/api/v1/dicom/ingestions/{ingest_id}/confirm",
        json={"accept_suggestion": True},
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["modality"] == "CT"
    analyzed = client.post(f"/api/v1/cases/{confirmed.json()['case_id']}/analyze")
    assert analyzed.status_code == 200
    assert analyzed.json()["outcome"] == "success"
    findings = client.get(f"/api/v1/cases/{confirmed.json()['case_id']}/findings").json()
    assert findings["source_model_id"] == "mock-ct-3d-v1"


def test_api_demo_thorax_xr(client: TestClient) -> None:
    upload = client.post(
        "/api/v1/dicom/demo/thorax_xr",
        data={"patient_name": "XR Demo", "species": Species.CANINE.value},
    )
    assert upload.status_code == 201, upload.text
    ingest_id = upload.json()["ingest_id"]
    confirmed = client.post(
        f"/api/v1/dicom/ingestions/{ingest_id}/confirm",
        json={"accept_suggestion": True},
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["modality"] == "XR"
    assert confirmed.json()["anatomical_region"] == "THORAX"
    analyzed = client.post(f"/api/v1/cases/{confirmed.json()['case_id']}/analyze")
    assert analyzed.status_code == 200
    findings = client.get(f"/api/v1/cases/{confirmed.json()['case_id']}/findings").json()
    assert findings["source_model_id"] == "mock-xr-vision-v1"
