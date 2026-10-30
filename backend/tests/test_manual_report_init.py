"""Manual report bootstrap for failed / unsupported cases (ISS-VAL-02)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import make_payload


def test_unsupported_manual_init_then_approve(client: TestClient) -> None:
    payload = make_payload(scenario="unsupported").model_dump(mode="json")
    case_id = client.post("/api/v1/cases", json=payload).json()["case_id"]
    analyzed = client.post(f"/api/v1/cases/{case_id}/analyze").json()
    assert analyzed["outcome"] == "unsupported"
    assert analyzed["report"] is None

    # Still cannot approve without draft
    assert (
        client.post(
            f"/api/v1/cases/{case_id}/review",
            json={"reviewer_id": "expert-demo", "action": "approve"},
        ).status_code
        == 409
    )

    init = client.post(f"/api/v1/cases/{case_id}/report/manual-init")
    assert init.status_code == 200, init.text
    draft = init.json()
    assert draft["generation"]["source_kind"] == "manual"
    assert draft["generation"]["provider_id"] == "manual-radiologist"
    assert draft["synthetic"] is True

    case = client.get(f"/api/v1/cases/{case_id}").json()
    assert case["status"] == "awaiting_review"
    assert case["draft_report"] is not None

    # Edit real content then approve
    saved = client.put(
        f"/api/v1/cases/{case_id}/report/draft",
        json={
            "editor_id": "expert-demo",
            "technique": "Manuel MR beyin — T2 ağırlıklı kesitler.",
            "findings": "Belirgin kitle lezyonu izlenmedi (manuel).",
            "impression": "Akut enfarktüs lehine bulgu yok; klinik korelasyon.",
            "recommendations": "Klinik takip.",
        },
    )
    assert saved.status_code == 200, saved.text

    approve = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "expert-demo", "action": "approve", "comment": "Manuel onay"},
    )
    assert approve.status_code == 200, approve.text
    assert approve.json()["status"] == "approved"
    assert approve.json()["draft_report"]["generation"]["source_kind"] == "manual"


def test_manual_init_rejects_when_ai_draft_exists(client: TestClient) -> None:
    payload = make_payload().model_dump(mode="json")
    case_id = client.post("/api/v1/cases", json=payload).json()["case_id"]
    client.post(f"/api/v1/cases/{case_id}/analyze")
    res = client.post(f"/api/v1/cases/{case_id}/report/manual-init")
    assert res.status_code == 409


def test_failed_manual_init(client: TestClient) -> None:
    payload = make_payload(scenario="model_failure").model_dump(mode="json")
    case_id = client.post("/api/v1/cases", json=payload).json()["case_id"]
    analyzed = client.post(f"/api/v1/cases/{case_id}/analyze").json()
    assert analyzed["outcome"] == "failed"
    init = client.post(f"/api/v1/cases/{case_id}/report/manual-init")
    assert init.status_code == 200, init.text
    assert client.get(f"/api/v1/cases/{case_id}").json()["status"] == "awaiting_review"
