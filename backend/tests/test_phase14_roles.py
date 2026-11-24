"""Phase 14 — pet owner submissions, vet verification, ACL, admin users."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


def _client(tmp_path: Path, *, isolation: bool = True) -> TestClient:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-phase14",
        tenant_isolation=isolation,
        async_analyze_delay_ms=0,
    )
    return TestClient(create_app(AppContainer(repo=InMemoryCaseRepository(), settings=settings)))


def _token(client: TestClient, email: str) -> str:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def _hdr(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_vet_can_assign_radiologist(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    created = client.post(
        "/api/v1/cases",
        json={
            "patient_name": "AssignMe",
            "species": "canine",
            "modality": "MR",
            "anatomical_region": "BRAIN",
        },
        headers=_hdr(vet),
    )
    case_id = created.json()["case_id"]
    assigned = client.patch(
        f"/api/v1/cases/{case_id}/assignment",
        json={"assigned_reviewer_id": "expert@demo.local", "priority": "stat"},
        headers=_hdr(vet),
    )
    assert assigned.status_code == 200
    assert assigned.json()["assigned_reviewer_id"] == "expert@demo.local"
    assert assigned.json()["priority"] == "stat"


def test_admin_user_management(tmp_path: Path) -> None:
    client = _client(tmp_path)
    admin = _token(client, "admin@demo.local")
    created = client.post(
        "/api/v1/admin/users",
        json={
            "email": "newvet@demo.local",
            "password": "demo1234",
            "role": "vet",
            "clinic_id": "clinic-demo-a",
            "display_name": "New Vet",
        },
        headers=_hdr(admin),
    )
    assert created.status_code == 201, created.text
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "newvet@demo.local", "password": "demo1234"},
    )
    assert login.status_code == 200
    assert login.json()["role"] == "vet"

    users = client.get("/api/v1/admin/users", headers=_hdr(admin))
    assert users.status_code == 200
    assert any(u["email"] == "newvet@demo.local" for u in users.json())
    assert all(u.get("password") is None for u in users.json())


def test_clinic_owner_stats(tmp_path: Path) -> None:
    client = _client(tmp_path)
    co = _token(client, "clinic-owner@demo.local")
    stats = client.get("/api/v1/clinic/stats", headers=_hdr(co))
    assert stats.status_code == 200
    assert stats.json()["clinic_id"] == "clinic-demo-a"
