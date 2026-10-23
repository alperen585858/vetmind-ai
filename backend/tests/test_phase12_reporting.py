"""Phase 12 — professional reporting workflow: messaging, STAT, delivery, dashboard."""

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


def test_stat_priority_sorts_above_urgent(client: TestClient) -> None:
    a = client.post(
        "/api/v1/cases",
        json=make_payload(priority="urgent", patient_name="UrgentDog").model_dump(mode="json"),
    )
    b = client.post(
        "/api/v1/cases",
        json=make_payload(priority="stat", patient_name="StatDog").model_dump(mode="json"),
    )
    assert a.status_code == 201 and b.status_code == 201
    wl = client.get("/api/v1/cases/worklist")
    assert wl.status_code == 200
    ids = [r["case_id"] for r in wl.json()]
    assert b.json()["case_id"] in ids
    assert ids.index(b.json()["case_id"]) < ids.index(a.json()["case_id"])


def test_case_messaging_and_unread(client: TestClient) -> None:
    case_id = _analyze_to_review(client)
    posted = client.post(
        f"/api/v1/cases/{case_id}/messages",
        json={"body": "Klinik soru: kontrast protokolü?"},
    )
    assert posted.status_code == 201
    assert posted.json()["body"].startswith("Klinik")
    assert posted.json()["author_role"]

    listed = client.get(f"/api/v1/cases/{case_id}/messages")
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    # Same demo principal authored → unread false for self
    assert listed.json()[0]["unread"] is False

    read = client.post(f"/api/v1/cases/{case_id}/messages/read")
    assert read.status_code == 200


def test_report_delivery_and_immutable(client: TestClient) -> None:
    case_id = _analyze_to_review(client)
    approved = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "expert-demo", "action": "approve", "comment": "ok"},
    )
    assert approved.status_code == 200
    body = approved.json()
    assert body["draft_report"]["immutable"] is True
    assert body["report_available_at"] is not None

    viewed = client.post(f"/api/v1/cases/{case_id}/report/viewed")
    assert viewed.status_code == 200
    assert viewed.json()["report_viewed_at"] is not None
    assert viewed.json()["report_delivered_at"] is not None
    # Content unchanged
    assert viewed.json()["draft_report"]["impression"]["text"] == body["draft_report"]["impression"]["text"]
    assert viewed.json()["draft_report"]["status"] == ReportStatus.APPROVED.value

    blocked = client.put(
        f"/api/v1/cases/{case_id}/report/draft",
        json={"editor_id": "expert-demo", "impression": "tamper after view"},
    )
    assert blocked.status_code == 409


def test_clinic_dashboard_counters(client: TestClient) -> None:
    case_id = _analyze_to_review(client)
    client.patch(
        f"/api/v1/cases/{case_id}/assignment",
        json={"priority": "stat"},
    )
    dash = client.get("/api/v1/cases/dashboard")
    assert dash.status_code == 200
    data = dash.json()
    assert data["active_cases"] >= 1
    assert data["awaiting_review"] >= 1
    assert data["urgent_cases"] >= 1
