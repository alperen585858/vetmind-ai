"""Delete imaging submissions from the list."""

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
        jwt_secret="test-secret-sub-delete",
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


def test_owner_can_delete_draft_and_pending(tmp_path: Path) -> None:
    client = _client(tmp_path)
    owner = _token(client, "owner@demo.local")
    pet = client.post(
        "/api/v1/pets",
        json={"name": "Pax", "species": "canine"},
        headers=_hdr(owner),
    ).json()
    sub = client.post(
        "/api/v1/submissions",
        json={"pet_id": pet["pet_id"], "chief_complaint": "Silinecek"},
        headers=_hdr(owner),
    ).json()
    sid = sub["submission_id"]
    assert client.delete(f"/api/v1/submissions/{sid}", headers=_hdr(owner)).status_code == 204
    assert client.get(f"/api/v1/submissions/{sid}", headers=_hdr(owner)).status_code == 404


def test_cannot_delete_linked_submission(tmp_path: Path) -> None:
    client = _client(tmp_path)
    owner = _token(client, "owner@demo.local")
    vet = _token(client, "vet@demo.local")
    pet = client.post(
        "/api/v1/pets",
        json={"name": "Mila", "species": "canine"},
        headers=_hdr(owner),
    ).json()
    sub = client.post(
        "/api/v1/submissions",
        json={"pet_id": pet["pet_id"], "chief_complaint": "Bağlı"},
        headers=_hdr(owner),
    ).json()
    sid = sub["submission_id"]
    approve_demo_payment(client, sid, _hdr(owner))
    accepted = client.post(
        f"/api/v1/submissions/{sid}/vet-action",
        json={"action": "accept", "run_analyze": False},
        headers=_hdr(vet),
    )
    assert accepted.status_code == 200, accepted.text
    blocked = client.delete(f"/api/v1/submissions/{sid}", headers=_hdr(owner))
    assert blocked.status_code == 409
