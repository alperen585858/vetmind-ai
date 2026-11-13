"""Issue #31 step 2 — public sign-up via POST /api/v1/auth/register."""

from __future__ import annotations

import threading
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.auth.passwords import is_password_hash, password_policy_error
from app.container import AppContainer
from app.main import create_app
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings

GOOD_PASSWORD = "Patiler2026"


def _settings(tmp_path: Path, **overrides) -> Settings:
    base = Settings(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-register",
        tenant_isolation=True,
        async_analyze_delay_ms=0,
    )
    return replace(base, **overrides)


def _app(tmp_path: Path, **overrides) -> tuple[TestClient, AppContainer]:
    container = AppContainer(repo=InMemoryCaseRepository(), settings=_settings(tmp_path, **overrides))
    return TestClient(create_app(container)), container


def _register(client: TestClient, **body):
    payload = {"email": "ayse@example.com", "password": GOOD_PASSWORD, "role": "owner"}
    payload.update(body)
    return client.post("/api/v1/auth/register", json=payload)


def _login(client: TestClient, email: str, password: str):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def _hdr(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _admin(client: TestClient) -> dict[str, str]:
    res = _login(client, "admin@demo.local", "demo1234")
    assert res.status_code == 200, res.text
    return _hdr(res.json()["access_token"])


# --- password policy --------------------------------------------------------


@pytest.mark.parametrize(
    ("password", "ok"),
    [
        ("Patiler2026", True),
        ("abcdefg1", True),
        ("kısa1", False),  # too short
        ("sadeceharf", False),  # no digit
        ("1234567890", False),  # no letter
        ("a1" * 61, False),  # too long
    ],
)
def test_password_policy(password: str, ok: bool) -> None:
    assert (password_policy_error(password) is None) is ok


# --- owner sign-up ----------------------------------------------------------


def test_owner_registers_gets_session_and_can_log_in_again(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    res = _register(client, email="  Ayse@Example.COM ", display_name="Ayşe Yılmaz")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "active"
    assert body["email"] == "ayse@example.com"
    assert body["role"] == "owner"
    session = body["session"]
    assert session["access_token"]
    assert session["clinic_id"] == "clinic-demo-a"

    me = client.get("/api/v1/auth/me", headers=_hdr(session["access_token"]))
    assert me.status_code == 200
    assert me.json()["subject"] == "ayse@example.com"
    assert me.json()["role"] == "owner"

    # A different "browser": a fresh login with the same credentials works.
    again = _login(client, "ayse@example.com", GOOD_PASSWORD)
    assert again.status_code == 200, again.text

    stored = container.workflow_store.get_user("ayse@example.com")
    assert stored is not None
    assert stored.display_name == "Ayşe Yılmaz"
    assert stored.password is None
    assert is_password_hash(stored.password_hash)
    assert GOOD_PASSWORD not in stored.model_dump_json()


def test_registered_owner_can_create_a_pet(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    token = _register(client).json()["session"]["access_token"]
    pet = client.post(
        "/api/v1/pets",
        json={"name": "Pamuk", "species": "feline"},
        headers=_hdr(token),
    )
    assert pet.status_code in (200, 201), pet.text
    assert pet.json()["owner_subject"] == "ayse@example.com"


def test_owner_clinic_comes_from_settings_not_client(tmp_path: Path) -> None:
    client, container = _app(tmp_path, self_registration_owner_clinic_id="clinic-demo-b")
    res = client.post(
        "/api/v1/auth/register",
        json={"email": "a@b.co", "password": GOOD_PASSWORD, "role": "owner", "clinic_id": "clinic-demo-a"},
    )
    assert res.status_code == 422  # unknown field is rejected
    res = _register(client, email="a@b.co")
    assert res.status_code == 201
    assert container.workflow_store.get_user("a@b.co").clinic_id == "clinic-demo-b"


# --- vet sign-up ------------------------------------------------------------


def test_vet_registration_is_pending_until_admin_activates(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    res = _register(client, email="vet.new@clinic.test", role="vet")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "pending_approval"
    assert body["session"] is None

    stored = container.workflow_store.get_user("vet.new@clinic.test")
    assert stored is not None and stored.active is False and stored.clinic_id is None
    assert _login(client, "vet.new@clinic.test", GOOD_PASSWORD).status_code == 401

    admin = _admin(client)
    listed = client.get("/api/v1/admin/users", headers=admin).json()
    assert any(u["email"] == "vet.new@clinic.test" and u["active"] is False for u in listed)

    activated = client.patch(
        "/api/v1/admin/users/vet.new@clinic.test",
        json={"active": True, "clinic_id": "clinic-demo-a"},
        headers=admin,
    )
    assert activated.status_code == 200, activated.text
    login = _login(client, "vet.new@clinic.test", GOOD_PASSWORD)
    assert login.status_code == 200, login.text
    assert login.json()["role"] == "vet"
    assert login.json()["clinic_id"] == "clinic-demo-a"


@pytest.mark.parametrize("role", ["admin", "expert", "clinic_owner", "demo", "service"])
def test_privileged_roles_cannot_self_register(tmp_path: Path, role: str) -> None:
    client, container = _app(tmp_path)
    res = _register(client, email=f"{role}@evil.test", role=role)
    assert res.status_code == 422
    assert container.workflow_store.get_user(f"{role}@evil.test") is None


# --- validation / conflicts -------------------------------------------------


@pytest.mark.parametrize("email", ["not-an-email", "a@b", "a b@c.com", "@example.com"])
def test_invalid_email_is_rejected(tmp_path: Path, email: str) -> None:
    client, _ = _app(tmp_path)
    assert _register(client, email=email).status_code == 422


@pytest.mark.parametrize("password", ["short1", "onlyletters", "12345678"])
def test_weak_password_is_rejected_with_reason(tmp_path: Path, password: str) -> None:
    client, container = _app(tmp_path)
    res = _register(client, password=password)
    assert res.status_code == 422
    assert "Password must" in res.json()["detail"]
    assert container.workflow_store.get_user("ayse@example.com") is None


def test_duplicate_email_is_rejected_and_password_unchanged(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    assert _register(client).status_code == 201
    dup = _register(client, email="AYSE@example.com", password="Baskasifre99")
    assert dup.status_code == 409
    assert _login(client, "ayse@example.com", GOOD_PASSWORD).status_code == 200
    assert _login(client, "ayse@example.com", "Baskasifre99").status_code == 401


def test_demo_account_email_cannot_be_taken_over(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    res = _register(client, email="admin@demo.local", password="Hijack2026x")
    assert res.status_code == 409
    assert _login(client, "admin@demo.local", "Hijack2026x").status_code == 401
    assert _login(client, "admin@demo.local", "demo1234").status_code == 200


def test_self_registration_can_be_disabled(tmp_path: Path) -> None:
    client, container = _app(tmp_path, self_registration_enabled=False)
    res = _register(client)
    assert res.status_code == 403
    assert container.workflow_store.get_user("ayse@example.com") is None


def test_concurrent_registrations_for_same_email_create_one_account(tmp_path: Path) -> None:
    _, container = _app(tmp_path)
    results: list[str] = []

    def attempt(pw: str) -> None:
        try:
            container.workflow.register_user(email="race@example.com", password=pw, role="owner")
            results.append("ok")
        except Exception as exc:  # HTTPException 409
            results.append(type(exc).__name__)

    threads = [threading.Thread(target=attempt, args=(f"Parola{i}abc",)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count("ok") == 1
    assert results.count("HTTPException") == 3


# --- audit ------------------------------------------------------------------


def test_register_is_audited(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    _register(client)
    _register(client)  # duplicate → denied
    events = [e for e in container.audit.list_events(limit=50) if e["event_type"] == "auth.register"]
    outcomes = {(e["outcome"], e["detail"]) for e in events}
    assert ("success", "active") in outcomes
    assert ("denied", "rejected_409") in outcomes
    assert all(GOOD_PASSWORD not in str(e) for e in events)


# --- admin guards (clinic required, same password policy) --------------------


def test_admin_cannot_activate_pending_vet_without_clinic(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    _register(client, email="vet.pending@clinic.test", role="vet")
    admin = _admin(client)
    res = client.patch("/api/v1/admin/users/vet.pending@clinic.test", json={"active": True}, headers=admin)
    assert res.status_code == 422
    assert "Assign a clinic" in res.json()["detail"]
    assert container.workflow_store.get_user("vet.pending@clinic.test").active is False
    assert _login(client, "vet.pending@clinic.test", GOOD_PASSWORD).status_code == 401


@pytest.mark.parametrize("role", ["vet", "expert", "clinic_owner"])
def test_admin_cannot_create_clinic_staff_without_clinic(tmp_path: Path, role: str) -> None:
    client, container = _app(tmp_path)
    admin = _admin(client)
    for clinic in (None, "", "   "):
        body = {"email": f"{role}@clinic.test", "password": GOOD_PASSWORD, "role": role}
        if clinic is not None:
            body["clinic_id"] = clinic
        res = client.post("/api/v1/admin/users", json=body, headers=admin)
        assert res.status_code == 422, (clinic, res.text)
    assert container.workflow_store.get_user(f"{role}@clinic.test") is None


def test_admin_cannot_clear_clinic_of_active_vet(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    admin = _admin(client)
    res = client.patch("/api/v1/admin/users/vet@demo.local", json={"clinic_id": ""}, headers=admin)
    assert res.status_code == 422
    assert container.workflow_store.get_user("vet@demo.local").clinic_id == "clinic-demo-a"


def test_admin_and_owner_without_clinic_are_allowed(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    admin = _admin(client)
    for role in ("admin", "owner"):
        res = client.post(
            "/api/v1/admin/users",
            json={"email": f"{role}2@clinic.test", "password": GOOD_PASSWORD, "role": role},
            headers=admin,
        )
        assert res.status_code == 201, res.text


@pytest.mark.parametrize("password", ["kisa1", "sadeceharf", "12345678"])
def test_admin_create_and_reset_use_same_password_policy(tmp_path: Path, password: str) -> None:
    client, container = _app(tmp_path)
    admin = _admin(client)
    created = client.post(
        "/api/v1/admin/users",
        json={"email": "weak@clinic.test", "password": password, "role": "owner"},
        headers=admin,
    )
    assert created.status_code == 422
    assert "Password must" in created.json()["detail"]
    assert container.workflow_store.get_user("weak@clinic.test") is None

    reset = client.patch("/api/v1/admin/users/vet@demo.local", json={"password": password}, headers=admin)
    assert reset.status_code == 422
    assert _login(client, "vet@demo.local", "demo1234").status_code == 200
