"""Phase 18 — info requests, multi-attach, clinical notes, case documents."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


def _client(tmp_path: Path) -> TestClient:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=tmp_path / "unused.sqlite3",
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-phase18",
        tenant_isolation=True,
        async_analyze_delay_ms=0,
    )
    return TestClient(create_app(AppContainer(repo=InMemoryCaseRepository(), settings=settings)))


def _token(client: TestClient, email: str) -> str:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def _hdr(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_case_clinical_note_info_request_and_document_no_duplicate(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    expert = _token(client, "expert@demo.local")

    case = client.post(
        "/api/v1/cases",
        json={
            "patient_name": "Rex",
            "species": "canine",
            "modality": "MR",
            "anatomical_region": "BRAIN",
            "clinical_history": "Başlangıç öykü",
            "assigned_reviewer_id": "expert@demo.local",
        },
        headers=_hdr(vet),
    )
    assert case.status_code == 201, case.text
    cid = case.json()["case_id"]
    prior_history = case.json()["clinical_history"]

    note = client.post(
        f"/api/v1/cases/{cid}/clinical-notes",
        json={"body": "Ek klinik not"},
        headers=_hdr(vet),
    )
    assert note.status_code == 200
    assert prior_history in note.json()["clinical_history"]
    assert "Ek klinik not" in note.json()["clinical_history"]
    assert len(note.json()["clinical_notes_log"]) == 1

    irq = client.post(
        f"/api/v1/cases/{cid}/info-requests",
        json={"body": "Kontrast dozu?", "to_role": "vet"},
        headers=_hdr(expert),
    )
    assert irq.status_code == 201
    rid = irq.json()["info_requests"][-1]["request_id"]
    assert irq.json()["info_requests"][-1]["status"] == "OPEN"

    ans = client.post(
        f"/api/v1/cases/{cid}/info-requests/{rid}/reply",
        json={"reply": "0.2 ml/kg"},
        headers=_hdr(vet),
    )
    assert ans.status_code == 200
    assert ans.json()["info_requests"][-1]["status"] == "ANSWERED"

    # Vet → expert question (assigned reviewer notified)
    vet_ask = client.post(
        f"/api/v1/cases/{cid}/info-requests",
        json={"body": "Cerrahiye mi yönlendireyim?", "to_role": "expert"},
        headers=_hdr(vet),
    )
    assert vet_ask.status_code == 201, vet_ask.text
    expert_irq = vet_ask.json()["info_requests"][-1]
    assert expert_irq["to_role"] == "expert"
    assert expert_irq["status"] == "OPEN"
    expert_ntf = client.get("/api/v1/notifications", headers=_hdr(expert))
    assert expert_ntf.status_code == 200
    assert any(
        i["kind"] == "info_request_opened" and "Cerrahiye" in (i.get("body") or "")
        for i in expert_ntf.json()["items"]
    )
    expert_reply = client.post(
        f"/api/v1/cases/{cid}/info-requests/{expert_irq['request_id']}/reply",
        json={"reply": "Önce medikal tedavi deneyin."},
        headers=_hdr(expert),
    )
    assert expert_reply.status_code == 200
    assert expert_reply.json()["info_requests"][-1]["status"] == "ANSWERED"
    vet_ntf = client.get("/api/v1/notifications", headers=_hdr(vet))
    assert any(i["kind"] == "info_request_answered" for i in vet_ntf.json()["items"])

    # Document attach must not create a second case
    before = client.get("/api/v1/cases", headers=_hdr(vet))
    n_before = len(before.json())
    doc = client.post(
        "/api/v1/documents/upload",
        data={
            "patient_name": "Rex",
            "species": "canine",
            "clinical_history": "Lab",
        },
        files=[("files", ("note.txt", b"Lab: WBC normal", "text/plain"))],
        headers=_hdr(vet),
    )
    assert doc.status_code in (200, 201), doc.text
    ingest_id = doc.json()["ingest_id"]
    attached = client.post(
        f"/api/v1/cases/{cid}/documents",
        json={"ingest_id": ingest_id},
        headers=_hdr(vet),
    )
    assert attached.status_code == 200
    assert attached.json()["document_context"] is not None
    assert attached.json()["document_context"]["document_ingest_id"] == ingest_id
    after = client.get("/api/v1/cases", headers=_hdr(vet))
    assert len(after.json()) == n_before

    internal = client.post(
        f"/api/v1/cases/{cid}/internal-notes",
        json={"body": "Şüpheli artefakt — iç not"},
        headers=_hdr(expert),
    )
    assert internal.status_code == 200
    assert len(internal.json()["internal_notes"]) == 1

    # Vet must not see internal notes
    as_vet = client.get(f"/api/v1/cases/{cid}", headers=_hdr(vet))
    assert as_vet.status_code == 200
    assert as_vet.json().get("internal_notes") == []
