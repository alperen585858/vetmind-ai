"""DICOM classification override → FeedbackStore ClassificationCorrectionEvent."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_override_emits_classification_correction(client: TestClient) -> None:
    upload = client.post(
        "/api/v1/dicom/demo/brain_mri",
        data={"patient_name": "Override Pax", "species": "canine"},
    )
    assert upload.status_code == 201, upload.text
    ingest_id = upload.json()["ingest_id"]
    confirmed = client.post(
        f"/api/v1/dicom/ingestions/{ingest_id}/confirm",
        json={
            "accept_suggestion": False,
            "modality": "MR",
            "anatomical_region": "CERVICAL",
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    case_id = confirmed.json()["case_id"]

    container = client.app.state.container
    events = container.feedback.list_events(limit=50)
    corr = [
        e
        for e in events
        if getattr(e, "event_kind", "") == "classification_correction"
        and e.case_id == case_id
    ]
    assert len(corr) == 1
    ev = corr[0]
    assert ev.suggested_anatomical_region == "BRAIN"
    assert ev.confirmed_anatomical_region == "CERVICAL"
    assert ev.ingest_id == ingest_id
