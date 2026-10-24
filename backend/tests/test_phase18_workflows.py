"""Phase 18 — info requests, multi-attach, clinical notes, case documents."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings
from helpers_payment import approve_demo_payment


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


def test_submission_info_request_lifecycle_and_extra_attach(tmp_path: Path) -> None:
    client = _client(tmp_path)
    owner = _token(client, "owner@demo.local")
    vet = _token(client, "vet@demo.local")

    pet = client.post(
        "/api/v1/pets",
        json={"name": "Luna", "species": "canine"},
        headers=_hdr(owner),
    ).json()
    sub = client.post(
        "/api/v1/submissions",
        json={"pet_id": pet["pet_id"], "chief_complaint": "Topallık"},
        headers=_hdr(owner),
    ).json()
    sid = sub["submission_id"]

    # First DICOM via attach
    demo = client.post(
        "/api/v1/dicom/demo/brain_mri",
        data={
            "patient_name": "Luna",
            "species": "canine",
            "clinical_history": "Topallık",
        },
        headers=_hdr(owner),
    )
    assert demo.status_code in (200, 201), demo.text
    ingest1 = demo.json()["ingest_id"]
    att1 = client.post(
        f"/api/v1/submissions/{sid}/attachments",
        json={"kind": "dicom", "ingest_id": ingest1},
        headers=_hdr(owner),
    )
    assert att1.status_code == 200
    assert att1.json()["dicom_ingest_id"] == ingest1

    # Additional DICOM does not overwrite primary
    demo2 = client.post(
        "/api/v1/dicom/demo/brain_mri",
        data={
            "patient_name": "Luna",
            "species": "canine",
            "clinical_history": "Ek",
        },
        headers=_hdr(owner),
    ).json()
    att2 = client.post(
        f"/api/v1/submissions/{sid}/attachments",
        json={"kind": "dicom", "ingest_id": demo2["ingest_id"]},
        headers=_hdr(owner),
    )
    assert att2.status_code == 200
    body = att2.json()
    assert body["dicom_ingest_id"] == ingest1
    assert any(a["ingest_id"] == demo2["ingest_id"] for a in body["attachments"])

    # Dedup: same ingest again is no-op
    again = client.post(
        f"/api/v1/submissions/{sid}/attachments",
        json={"kind": "dicom", "ingest_id": ingest1},
        headers=_hdr(owner),
    )
    assert again.status_code == 200
    assert len(again.json()["attachments"]) == len(body["attachments"])

    approve_demo_payment(client, sid, _hdr(owner))

    req = client.post(
        f"/api/v1/submissions/{sid}/vet-action",
        json={"action": "request_info", "missing_info_request": "Nöro notu eksik"},
        headers=_hdr(vet),
    )
    assert req.status_code == 200
    irq = req.json()["info_requests"][-1]
    assert irq["status"] == "OPEN"
    assert req.json()["status"] == "needs_info"

    owner_ntf = client.get("/api/v1/notifications", headers=_hdr(owner))
    assert any(i["kind"] in {"submission_needs_info", "info_request_opened"} for i in owner_ntf.json()["items"])

    replied = client.post(
        f"/api/v1/submissions/{sid}/info-requests/{irq['request_id']}/reply",
        json={"reply": "Nöro muayene: normal"},
        headers=_hdr(owner),
    )
    assert replied.status_code == 200
    assert replied.json()["status"] == "pending_verification"
    assert replied.json()["info_requests"][-1]["status"] == "ANSWERED"

    closed = client.post(
        f"/api/v1/submissions/{sid}/info-requests/{irq['request_id']}/close",
        headers=_hdr(vet),
    )
    assert closed.status_code == 200
    assert closed.json()["info_requests"][-1]["status"] == "CLOSED"


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
