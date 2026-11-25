"""Issue #41 — email verification for self-registered vets."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.schemas.workflow import ManagedUser
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings

GOOD_PASSWORD = "Patiler2026"
NEW_VET = "vet.new@clinic.test"


def _app(tmp_path: Path, **overrides) -> tuple[TestClient, AppContainer]:
    settings = replace(
        Settings(
            storage_backend="memory",
            sqlite_path=Path("unused.sqlite3"),
            quarantine_root=tmp_path / "q",
            auth_enabled=True,
            auth_api_key="test-api-key",
            jwt_secret="test-secret-verify",
            tenant_isolation=True,
            async_analyze_delay_ms=0,
        ),
        **overrides,
    )
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    return TestClient(create_app(container)), container


def _admin(client: TestClient) -> dict[str, str]:
    res = client.post("/api/v1/auth/login", json={"email": "admin@demo.local", "password": "demo1234"})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _register(client: TestClient, email: str = NEW_VET, password: str = GOOD_PASSWORD):
    return client.post("/api/v1/auth/register", json={"email": email, "password": password, "role": "vet"})


# --- step 1: model and activation rule ---------------------------------------


def test_rows_without_the_field_count_as_verified() -> None:
    legacy = ManagedUser.model_validate({"email": "old@clinic.test", "role": "vet", "clinic_id": "c"})
    assert legacy.email_verified is True
    assert legacy.to_public().email_verified is True


def test_self_registered_vet_starts_unverified(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    _register(client)
    stored = container.workflow_store.get_user(NEW_VET)
    assert stored is not None and stored.email_verified is False and stored.email_verified_at is None
    listed = client.get("/api/v1/admin/users", headers=_admin(client)).json()
    row = next(u for u in listed if u["email"] == NEW_VET)
    assert row["email_verified"] is False


def test_demo_and_admin_created_users_are_verified(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    admin = _admin(client)
    created = client.post(
        "/api/v1/admin/users",
        json={"email": "staff@clinic.test", "password": GOOD_PASSWORD, "role": "admin"},
        headers=admin,
    )
    assert created.status_code == 201, created.text
    assert created.json()["email_verified"] is True
    listed = client.get("/api/v1/admin/users", headers=admin).json()
    assert all(u["email_verified"] for u in listed if u["email"].endswith("@demo.local"))


def test_admin_cannot_activate_unverified_vet(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    _register(client)
    res = client.patch(
        f"/api/v1/admin/users/{NEW_VET}",
        json={"active": True, "clinic_id": "clinic-demo-a"},
        headers=_admin(client),
    )
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "email_not_verified"
    assert container.workflow_store.get_user(NEW_VET).active is False


def test_admin_can_mark_verified_and_activate(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    _register(client)
    admin = _admin(client)
    marked = client.patch(f"/api/v1/admin/users/{NEW_VET}", json={"email_verified": True}, headers=admin)
    assert marked.status_code == 200, marked.text
    assert marked.json()["email_verified"] is True
    assert container.workflow_store.get_user(NEW_VET).email_verified_at is not None
    res = client.patch(
        f"/api/v1/admin/users/{NEW_VET}", json={"active": True, "clinic_id": "clinic-demo-a"}, headers=admin
    )
    assert res.status_code == 200, res.text


def test_admin_cannot_unverify(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    res = client.patch(
        "/api/v1/admin/users/vet@demo.local", json={"email_verified": False}, headers=_admin(client)
    )
    assert res.status_code == 422
