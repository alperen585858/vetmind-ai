"""Phase 10/11 — radiologist workspace + clinic foundation persistence."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.schemas.enums import ReportStatus
from tests.conftest import make_payload


def _analyze_to_review(client: TestClient) -> str:
    created = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json"))
    assert created.status_code == 201
    case_id = created.json()["case_id"]
    analyzed = client.post(f"/api/v1/cases/{case_id}/analyze")
    assert analyzed.status_code == 200
    return case_id


def test_case_create_persists_priority_age_structured_history(client: TestClient) -> None:
    payload = make_payload(
        patient_age_years=7.5,
        priority="urgent",
        clinical_history_structured={
            "complaint": "Ataksi",
            "onset": "Akut",
            "course": "Progresif",
            "medications": "Yok",
            "relevant_history": "Önceki disk şüphesi",
            "handoff_notes": "Klinik→radyolog",
        },
    )
    res = client.post("/api/v1/cases", json=payload.model_dump(mode="json"))
    assert res.status_code == 201
    body = res.json()
    assert body["priority"] == "urgent"
    assert body["patient_age_years"] == 7.5
    assert body["clinical_history_structured"]["handoff_notes"] == "Klinik→radyolog"
    assert body["clinical_history_structured"]["complaint"] == "Ataksi"
    # Free-text history is preserved when already provided on create.
    assert body["clinical_history"]


def test_worklist_filters_and_assignment(client: TestClient) -> None:
    case_id = _analyze_to_review(client)
    wl = client.get("/api/v1/cases/worklist", params={"status": "awaiting_review", "priority": "normal"})
    assert wl.status_code == 200
    ids = {r["case_id"] for r in wl.json()}
    assert case_id in ids

    assigned = client.patch(
        f"/api/v1/cases/{case_id}/assignment",
        json={"assigned_reviewer_id": "expert-demo", "priority": "high"},
    )
    assert assigned.status_code == 200
    assert assigned.json()["assigned_reviewer_id"] == "expert-demo"
    assert assigned.json()["priority"] == "high"

    filtered = client.get("/api/v1/cases/worklist", params={"assigned_to": "expert-demo", "priority": "high"})
    assert case_id in {r["case_id"] for r in filtered.json()}


def test_draft_save_and_immutable_approve(client: TestClient) -> None:
    case_id = _analyze_to_review(client)
    saved = client.put(
        f"/api/v1/cases/{case_id}/report/draft",
        json={
            "editor_id": "expert-demo",
            "technique": "Edited technique",
            "findings": "Edited findings",
            "impression": "Edited impression",
            "recommendations": "Edited recs",
            "note": "autosave",
        },
    )
    assert saved.status_code == 200
    assert saved.json()["technique"]["text"] == "Edited technique"
    assert saved.json()["status"] != ReportStatus.APPROVED.value

    approved = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={
            "reviewer_id": "expert-demo",
            "action": "approve",
            "comment": "ok",
            "edited_impression": "Final impression",
        },
    )
    assert approved.status_code == 200
    assert approved.json()["draft_report"]["immutable"] is True

    blocked = client.put(
        f"/api/v1/cases/{case_id}/report/draft",
        json={"editor_id": "expert-demo", "impression": "tamper"},
    )
    assert blocked.status_code == 409
