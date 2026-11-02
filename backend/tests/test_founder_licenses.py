"""Founder license admin — clinics + owners; admin cannot access."""

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
        jwt_secret="test-secret-founder",
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


def test_founder_lists_seed_clinics_admin_forbidden(tmp_path: Path) -> None:
    client = _client(tmp_path)
    founder = _token(client, "founder@demo.local")
    admin = _token(client, "admin@demo.local")
    expert = _token(client, "expert@demo.local")

    ok = client.get("/api/v1/founder/licenses", headers=_hdr(founder))
    assert ok.status_code == 200, ok.text
    ids = {c["clinic_id"] for c in ok.json()}
    assert "clinic-demo-a" in ids
    assert "clinic-demo-b" in ids

    denied_admin = client.get("/api/v1/founder/licenses", headers=_hdr(admin))
    assert denied_admin.status_code == 403

    denied_expert = client.get("/api/v1/founder/licenses", headers=_hdr(expert))
    assert denied_expert.status_code == 403


def test_founder_create_and_inactive_blocks_login(tmp_path: Path) -> None:
    client = _client(tmp_path)
    founder = _token(client, "founder@demo.local")

    created = client.post(
        "/api/v1/founder/licenses",
        headers=_hdr(founder),
        json={
            "name": "Yeni Klinik",
            "clinic_id": "clinic-yeni",
            "clinic_owner_email": "owner-yeni@demo.local",
            "clinic_owner_password": "demo1234",
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["clinic_id"] == "clinic-yeni"
    assert body["status"] == "active"
    assert body["staff_count"] >= 1

    detail = client.get("/api/v1/founder/licenses/clinic-yeni", headers=_hdr(founder))
    assert detail.status_code == 200
    assert detail.json()["name"] == "Yeni Klinik"

    # clinic owner can log in while active
    assert _token(client, "owner-yeni@demo.local")

    patched = client.patch(
        "/api/v1/founder/licenses/clinic-yeni",
        headers=_hdr(founder),
        json={"status": "inactive"},
    )
    assert patched.status_code == 200
    assert patched.json()["status"] == "inactive"

    blocked = client.post(
        "/api/v1/auth/login",
        json={"email": "owner-yeni@demo.local", "password": "demo1234"},
    )
    assert blocked.status_code == 403
    assert "inactive" in blocked.json()["detail"].lower()

    # founder still logs in
    assert _token(client, "founder@demo.local")


def test_founder_staff_create_and_toggle(tmp_path: Path) -> None:
    client = _client(tmp_path)
    founder = _token(client, "founder@demo.local")
    admin = _token(client, "admin@demo.local")

    listed = client.get("/api/v1/founder/licenses/staff", headers=_hdr(founder))
    assert listed.status_code == 200, listed.text
    emails = {s["email"] for s in listed.json()}
    assert "vet@demo.local" in emails
    assert "clinic-owner@demo.local" in emails
    assert all(s["role"] in {"vet", "clinic_owner"} for s in listed.json())

    denied = client.get("/api/v1/founder/licenses/staff", headers=_hdr(admin))
    assert denied.status_code == 403

    created = client.post(
        "/api/v1/founder/licenses/staff",
        headers=_hdr(founder),
        json={
            "email": "vet-yeni@demo.local",
            "password": "demo1234",
            "role": "vet",
            "clinic_id": "clinic-demo-a",
            "display_name": "Yeni Vet",
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["role"] == "vet"
    assert created.json()["clinic_id"] == "clinic-demo-a"
    assert _token(client, "vet-yeni@demo.local")

    admin_created = client.post(
        "/api/v1/founder/licenses/staff",
        headers=_hdr(founder),
        json={
            "email": "admin-klinik@demo.local",
            "password": "demo1234",
            "role": "clinic_owner",
            "clinic_id": "clinic-demo-b",
        },
    )
    assert admin_created.status_code == 201, admin_created.text
    assert admin_created.json()["role"] == "clinic_owner"

    toggled = client.patch(
        "/api/v1/founder/licenses/staff/vet-yeni@demo.local",
        headers=_hdr(founder),
        json={"active": False},
    )
    assert toggled.status_code == 200
    assert toggled.json()["active"] is False
    blocked = client.post(
        "/api/v1/auth/login",
        json={"email": "vet-yeni@demo.local", "password": "demo1234"},
    )
    assert blocked.status_code == 401


def test_founder_owners_toggle(tmp_path: Path) -> None:
    client = _client(tmp_path)
    founder = _token(client, "founder@demo.local")
    admin = _token(client, "admin@demo.local")

    owners = client.get("/api/v1/founder/licenses/owners", headers=_hdr(founder))
    assert owners.status_code == 200, owners.text
    emails = {o["email"] for o in owners.json()}
    assert "owner@demo.local" in emails

    denied = client.get("/api/v1/founder/licenses/owners", headers=_hdr(admin))
    assert denied.status_code == 403

    toggled = client.patch(
        "/api/v1/founder/licenses/owners/owner@demo.local",
        headers=_hdr(founder),
        json={"active": False},
    )
    assert toggled.status_code == 200, toggled.text
    assert toggled.json()["active"] is False

    blocked = client.post(
        "/api/v1/auth/login",
        json={"email": "owner@demo.local", "password": "demo1234"},
    )
    assert blocked.status_code == 401
