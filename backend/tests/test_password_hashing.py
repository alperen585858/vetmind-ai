"""Issue #31 step 1 — stored passwords are scrypt hashes, never plaintext."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.auth.passwords import hash_password, is_password_hash, needs_rehash, verify_password
from app.auth.security import DEMO_USERS, demo_password_hash
from app.container import AppContainer
from app.main import create_app
from app.schemas.workflow import ManagedUser
from app.services.repository import InMemoryCaseRepository
from app.services.workflow_store import SqliteWorkflowStore
from app.settings import Settings

SECRET_PASSWORD = "Gizli-Sifre-2026"


# --- passwords module -------------------------------------------------------


def test_hash_has_expected_format_and_is_salted() -> None:
    first = hash_password(SECRET_PASSWORD)
    second = hash_password(SECRET_PASSWORD)
    assert first.startswith("scrypt$16384$8$1$")
    assert is_password_hash(first)
    assert SECRET_PASSWORD not in first
    assert first != second  # random salt per hash


def test_verify_accepts_correct_and_rejects_wrong_password() -> None:
    stored = hash_password(SECRET_PASSWORD)
    assert verify_password(SECRET_PASSWORD, stored)
    assert not verify_password("wrong-password", stored)
    assert not verify_password("", stored)


@pytest.mark.parametrize(
    "stored",
    [None, "", "scrypt$16384$8$1$not-base64!$abc", "scrypt$x$8$1$AAAA$AAAA", "scrypt$1$2"],
)
def test_verify_rejects_missing_or_malformed_hash(stored: str | None) -> None:
    assert not verify_password(SECRET_PASSWORD, stored)


def test_verify_still_accepts_plaintext_demo_seed() -> None:
    assert verify_password("demo1234", "demo1234")
    assert not verify_password("demo12345", "demo1234")


def test_hash_password_rejects_empty() -> None:
    with pytest.raises(ValueError):
        hash_password("")


def test_needs_rehash() -> None:
    assert needs_rehash("plaintext")
    assert needs_rehash(None)
    assert needs_rehash("scrypt$1024$8$1$AAAA$AAAA")
    assert not needs_rehash(hash_password(SECRET_PASSWORD))


def test_demo_password_hash_is_cached_and_valid() -> None:
    h = demo_password_hash("vet@demo.local")
    assert h is not None and is_password_hash(h)
    assert h == demo_password_hash("VET@demo.local".lower())
    assert verify_password("demo1234", h)
    assert demo_password_hash("nobody@demo.local") is None


# --- API / storage ----------------------------------------------------------


def _settings(tmp_path: Path, *, backend: str = "memory") -> Settings:
    return Settings(
        storage_backend=backend,
        sqlite_path=tmp_path / "db" / "vetmind.sqlite3",
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-issue31",
        tenant_isolation=True,
        async_analyze_delay_ms=0,
    )


def _app(tmp_path: Path, *, backend: str = "memory") -> tuple[TestClient, AppContainer]:
    container = AppContainer(repo=InMemoryCaseRepository(), settings=_settings(tmp_path, backend=backend))
    return TestClient(create_app(container)), container


def _login(client: TestClient, email: str, password: str):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def _admin_headers(client: TestClient) -> dict[str, str]:
    res = _login(client, "admin@demo.local", "demo1234")
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def test_demo_seed_is_stored_hashed_and_demo_login_works(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    for email in DEMO_USERS:
        stored = container.workflow_store.get_user(email)
        assert stored is not None
        assert stored.password is None
        assert is_password_hash(stored.password_hash)
        assert is_password_hash(container.auth.users[email].password)
    assert _login(client, "vet@demo.local", "demo1234").status_code == 200
    assert _login(client, "vet@demo.local", "wrong").status_code == 401


def test_admin_created_user_is_hashed_and_never_returned(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    admin = _admin_headers(client)
    created = client.post(
        "/api/v1/admin/users",
        json={"email": "NewVet@Clinic.test", "password": SECRET_PASSWORD, "role": "vet", "clinic_id": "clinic-demo-a"},
        headers=admin,
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert "password" not in body and "password_hash" not in body
    assert body["email"] == "newvet@clinic.test"

    stored = container.workflow_store.get_user("newvet@clinic.test")
    assert stored is not None
    assert stored.password is None
    assert is_password_hash(stored.password_hash)
    assert SECRET_PASSWORD not in stored.model_dump_json()

    assert _login(client, "newvet@clinic.test", SECRET_PASSWORD).status_code == 200
    assert _login(client, "newvet@clinic.test", "demo1234").status_code == 401

    listed = client.get("/api/v1/admin/users", headers=admin)
    assert listed.status_code == 200
    for u in listed.json():
        assert "password" not in u and "password_hash" not in u


def test_password_change_by_admin_rehashes(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    admin = _admin_headers(client)
    res = client.patch("/api/v1/admin/users/vet@demo.local", json={"password": SECRET_PASSWORD}, headers=admin)
    assert res.status_code == 200, res.text
    assert "password_hash" not in res.json()

    stored = container.workflow_store.get_user("vet@demo.local")
    assert stored is not None and stored.password is None
    assert verify_password(SECRET_PASSWORD, stored.password_hash)

    assert _login(client, "vet@demo.local", SECRET_PASSWORD).status_code == 200
    assert _login(client, "vet@demo.local", "demo1234").status_code == 401


def test_update_without_password_keeps_existing_hash(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    admin = _admin_headers(client)
    before = container.workflow_store.get_user("vet@demo.local").password_hash
    res = client.patch("/api/v1/admin/users/vet@demo.local", json={"display_name": "Dr. Vet"}, headers=admin)
    assert res.status_code == 200, res.text
    assert container.workflow_store.get_user("vet@demo.local").password_hash == before
    assert _login(client, "vet@demo.local", "demo1234").status_code == 200


def test_deactivated_demo_user_cannot_log_in(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    admin = _admin_headers(client)
    assert _login(client, "owner@demo.local", "demo1234").status_code == 200
    res = client.patch("/api/v1/admin/users/owner@demo.local", json={"active": False}, headers=admin)
    assert res.status_code == 200, res.text
    assert _login(client, "owner@demo.local", "demo1234").status_code == 401


def test_legacy_plaintext_rows_are_migrated_on_startup(tmp_path: Path) -> None:
    settings = _settings(tmp_path, backend="sqlite")
    db_path = Path(settings.sqlite_path).with_name("vetmind_workflow.sqlite3")
    legacy = SqliteWorkflowStore(db_path)
    legacy.save_user(
        ManagedUser(email="legacy@clinic.test", role="vet", clinic_id="clinic-demo-a", password=SECRET_PASSWORD)
    )
    legacy.save_user(
        ManagedUser(email="admin@demo.local", role="admin", password="demo1234")
    )
    del legacy

    client, container = _app(tmp_path, backend="sqlite")

    migrated = container.workflow_store.get_user("legacy@clinic.test")
    assert migrated is not None
    assert migrated.password is None
    assert verify_password(SECRET_PASSWORD, migrated.password_hash)
    assert _login(client, "legacy@clinic.test", SECRET_PASSWORD).status_code == 200
    assert _login(client, "admin@demo.local", "demo1234").status_code == 200

    with sqlite3.connect(db_path) as conn:
        payloads = [row[0] for row in conn.execute("SELECT payload FROM managed_users")]
    assert payloads
    assert all(SECRET_PASSWORD not in p for p in payloads)
    assert all('"password":null' in p.replace(" ", "") for p in payloads)


def test_migration_is_idempotent(tmp_path: Path) -> None:
    _, container = _app(tmp_path)
    assert container.workflow._migrate_plaintext_passwords() == 0
