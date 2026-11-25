"""#78 — clinics cancel drafts (kept, audited); only admins delete permanently."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.schemas.enums import CaseLifecycleStatus
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


def _client(tmp_path: Path) -> TestClient:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=tmp_path / "unused.sqlite3",
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-case-delete",
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


def _new_case(client: TestClient, token: str, name: str) -> str:
    created = client.post(
        "/api/v1/cases",
        json={"patient_name": name, "species": "canine", "breed": "Mix", "modality": "MR", "anatomical_region": "BRAIN"},
        headers=_hdr(token),
    )
    assert created.status_code == 201, created.text
    return created.json()["case_id"]


def test_vet_cancels_draft_with_reason_and_record_is_kept(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    case_id = _new_case(client, vet, "Yanlis")

    assert client.post(f"/api/v1/cases/{case_id}/cancel", json={"reason": ""}, headers=_hdr(vet)).status_code == 422
    res = client.post(f"/api/v1/cases/{case_id}/cancel", json={"reason": "Çift açılmış vaka"}, headers=_hdr(vet))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "cancelled"
    assert body["cancel_reason"] == "Çift açılmış vaka"
    assert body["cancelled_by"] == "vet@demo.local" and body["cancelled_at"]
    assert any(a["kind"] == "case_cancelled" for a in body["activity"])

    container = client.app.state.container  # type: ignore[attr-defined]
    assert container.repo.get_case(case_id) is not None  # not deleted
    events = [e for e in container.audit.list_events(limit=50) if e["event_type"] == "case.cancel"]
    assert events and events[0]["actor"] == "vet@demo.local"
    # Cancelled drafts cannot be analysed and stay off the worklist by default.
    assert client.post(f"/api/v1/cases/{case_id}/analyze", headers=_hdr(vet)).status_code == 409
    worklist = client.get("/api/v1/cases/worklist", headers=_hdr(vet))
    if worklist.status_code == 200:
        assert case_id not in {r["case_id"] for r in worklist.json()}


def test_case_sent_to_radiologist_cannot_be_cancelled_or_deleted(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    case_id = _new_case(client, vet, "Incelemede")
    assert client.post(f"/api/v1/cases/{case_id}/analyze", headers=_hdr(vet)).status_code == 200
    container = client.app.state.container  # type: ignore[attr-defined]
    assert container.repo.get_case(case_id).status != CaseLifecycleStatus.CREATED

    res = client.post(f"/api/v1/cases/{case_id}/cancel", json={"reason": "Vazgeçtim"}, headers=_hdr(vet))
    assert res.status_code == 409
    assert client.delete(f"/api/v1/cases/{case_id}?reason=deneme", headers=_hdr(vet)).status_code == 403
    assert container.repo.get_case(case_id) is not None


def test_only_admin_deletes_permanently_with_reason(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    expert = _token(client, "expert@demo.local")
    admin = _token(client, "admin@demo.local")
    case_id = _new_case(client, vet, "KVKK")

    assert client.delete(f"/api/v1/cases/{case_id}?reason=KVKK", headers=_hdr(vet)).status_code == 403
    assert client.delete(f"/api/v1/cases/{case_id}?reason=KVKK", headers=_hdr(expert)).status_code == 403
    assert client.delete(f"/api/v1/cases/{case_id}", headers=_hdr(admin)).status_code == 422
    assert client.delete(f"/api/v1/cases/{case_id}?reason=KVKK silme talebi", headers=_hdr(admin)).status_code == 204
    container = client.app.state.container  # type: ignore[attr-defined]
    assert container.repo.get_case(case_id) is None
    events = [e for e in container.audit.list_events(limit=50) if e["event_type"] == "case.delete"]
    assert events and events[0]["detail"] == "KVKK silme talebi"


def test_expert_hides_case_from_own_list_only(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    expert = _token(client, "expert@demo.local")
    case_id = _new_case(client, vet, "Gizlenecek")
    container = client.app.state.container  # type: ignore[attr-defined]
    case = container.repo.get_case(case_id)
    case.status = CaseLifecycleStatus.APPROVED
    container.repo.save_case(case)

    assert client.post(f"/api/v1/cases/{case_id}/hide", headers=_hdr(expert)).status_code == 204
    assert container.repo.get_case(case_id) is not None
    expert_ids = {r["case_id"] for r in client.get("/api/v1/cases", headers=_hdr(expert)).json()}
    vet_ids = {r["case_id"] for r in client.get("/api/v1/cases", headers=_hdr(vet)).json()}
    assert case_id not in expert_ids
    assert case_id in vet_ids
