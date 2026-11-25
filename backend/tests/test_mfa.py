"""Issue #107 — two-step sign-in (TOTP): core, setup, sign-in, admin; demo accounts exempt."""

from __future__ import annotations

import base64
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.auth import totp
from app.auth.mfa_crypto import MfaSecretBox, MfaSecretUnreadable
from app.container import AppContainer
from app.main import create_app
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings

PW = "Patiler2026"
USER = "radyolog@klinik.test"


# --- TOTP core ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("t", "expected8"),
    [(59, "94287082"), (1111111109, "07081804"), (1234567890, "89005924"), (2000000000, "69279037")],
)
def test_rfc6238_vectors(t: int, expected8: str) -> None:
    secret = base64.b32encode(b"12345678901234567890").decode()
    assert totp.code_at(secret, t // 30) == expected8[-6:]


def test_verify_accepts_one_step_drift_and_refuses_replay() -> None:
    s = totp.generate_secret()
    now = 1_800_000_000.0
    step = totp.current_step(now)
    assert totp.verify(s, totp.code_at(s, step - 1), now=now) == step - 1
    assert totp.verify(s, totp.code_at(s, step + 1), now=now) == step + 1
    assert totp.verify(s, totp.code_at(s, step - 2), now=now) is None
    code = totp.code_at(s, step)
    assert totp.verify(s, f"{code[:3]} {code[3:]}", now=now) == step  # spaces are fine
    assert totp.verify(s, code, now=now, last_used_step=step) is None  # replay
    assert totp.verify(s, "12345", now=now) is None


def test_otpauth_uri() -> None:
    uri = totp.otpauth_uri("ABCDEF", "a@b.co")
    assert uri.startswith("otpauth://totp/VetMind%3Aa%40b.co?") and "secret=ABCDEF" in uri and "issuer=VetMind" in uri


def test_secret_box_round_trip_and_key_mismatch() -> None:
    box = MfaSecretBox(dedicated_key=None, jwt_secret="x" * 40)
    sealed = box.seal("JBSWY3DPEHPK3PXP")
    assert "JBSWY3DP" not in sealed and box.open(sealed) == "JBSWY3DPEHPK3PXP"
    with pytest.raises(MfaSecretUnreadable):
        MfaSecretBox(dedicated_key=None, jwt_secret="y" * 40).open(sealed)


# --- API helpers -------------------------------------------------------------------------


def _app(tmp_path: Path, **overrides) -> tuple[TestClient, AppContainer]:
    settings = replace(
        Settings(
            storage_backend="memory",
            sqlite_path=Path("unused.sqlite3"),
            quarantine_root=tmp_path / "q",
            auth_enabled=True,
            auth_api_key="test-api-key",
            jwt_secret="test-secret-mfa-12345678901234567890",
            tenant_isolation=True,
            async_analyze_delay_ms=0,
        ),
        **overrides,
    )
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    return TestClient(create_app(container)), container


def _login(client: TestClient, email: str, password: str = "demo1234"):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_user(client: TestClient, email: str = USER, role: str = "admin") -> dict[str, str]:
    admin = _bearer(_login(client, "admin@demo.local").json()["access_token"])
    body = {"email": email, "password": PW, "role": role}
    if role != "admin":
        body["clinic_id"] = "clinic-demo-a"
    assert client.post("/api/v1/admin/users", json=body, headers=admin).status_code == 201
    res = _login(client, email, PW)
    assert res.status_code == 200, res.text
    return _bearer(res.json()["access_token"])


def _code(secret: str, offset: int = 0) -> str:
    return totp.code_at(secret, totp.current_step() + offset)


def _enable(client: TestClient, headers: dict[str, str]) -> tuple[str, list[str], dict[str, str]]:
    setup = client.post("/api/v1/auth/mfa/setup", headers=headers)
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"]
    res = client.post("/api/v1/auth/mfa/enable", json={"code": _code(secret)}, headers=headers)
    assert res.status_code == 200, res.text
    return secret, res.json()["backup_codes"], _bearer(res.json()["session"]["access_token"])


# --- setup ---------------------------------------------------------------------------------


def test_setup_enable_status_and_secret_never_returned(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    headers = _make_user(client)
    assert client.get("/api/v1/auth/mfa/status", headers=headers).json()["enabled"] is False
    setup = client.post("/api/v1/auth/mfa/setup", headers=headers).json()
    assert setup["otpauth_uri"].startswith("otpauth://totp/") and len(setup["secret"]) == 32
    assert client.get("/api/v1/auth/mfa/status", headers=headers).json()["setup_pending"] is True

    res = client.post("/api/v1/auth/mfa/enable", json={"code": _code(setup["secret"])}, headers=headers)
    body = res.json()
    assert len(body["backup_codes"]) == 10 and len(set(body["backup_codes"])) == 10
    new_headers = _bearer(body["session"]["access_token"])
    status = client.get("/api/v1/auth/mfa/status", headers=new_headers).json()
    assert status["enabled"] is True and status["backup_codes_left"] == 10

    # The old access token is revoked (other sessions end); the fresh one works.
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401
    stored = container.workflow_store.get_user(USER)
    assert setup["secret"] not in stored.model_dump_json()
    assert not any(c in stored.model_dump_json() for c in body["backup_codes"])
    admin = _bearer(_login(client, "admin@demo.local").json()["access_token"])
    listed = client.get("/api/v1/admin/users", headers=admin).text
    assert "mfa_secret" not in listed and "mfa_backup" not in listed and setup["secret"] not in listed


def test_wrong_code_is_refused_and_rate_limited(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    headers = _make_user(client)
    client.post("/api/v1/auth/mfa/setup", headers=headers)
    for _ in range(5):
        res = client.post("/api/v1/auth/mfa/enable", json={"code": "000000"}, headers=headers)
        assert res.status_code in (400, 429)
    assert client.post("/api/v1/auth/mfa/enable", json={"code": "000000"}, headers=headers).status_code == 429


def test_disable_needs_password_and_a_fresh_code(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    secret, _codes, headers = _enable(client, _make_user(client))
    used = _code(secret)  # same step as enable: a replay
    assert client.post("/api/v1/auth/mfa/disable", json={"password": "nope", "code": _code(secret, 1)}, headers=headers).status_code == 400
    assert client.post("/api/v1/auth/mfa/disable", json={"password": PW, "code": used}, headers=headers).status_code == 400
    res = client.post("/api/v1/auth/mfa/disable", json={"password": PW, "code": _code(secret, 1)}, headers=headers)
    assert res.status_code == 200, res.text
    after = _bearer(res.json()["access_token"])
    assert client.get("/api/v1/auth/mfa/status", headers=after).json()["enabled"] is False


def test_backup_codes_can_be_regenerated(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    secret, first, headers = _enable(client, _make_user(client))
    res = client.post("/api/v1/auth/mfa/backup-codes", json={"password": PW, "code": _code(secret, 1)}, headers=headers)
    assert res.status_code == 200, res.text
    assert len(res.json()["backup_codes"]) == 10 and not set(res.json()["backup_codes"]) & set(first)


@pytest.mark.parametrize("email", ["admin@demo.local", "vet@demo.local", "expert@demo.local"])
def test_demo_accounts_cannot_turn_mfa_on(tmp_path: Path, email: str) -> None:
    client, _ = _app(tmp_path)
    headers = _bearer(_login(client, email).json()["access_token"])
    res = client.post("/api/v1/auth/mfa/setup", headers=headers)
    assert res.status_code == 403 and res.json()["detail"]["code"] == "mfa_demo_account"
    assert client.get("/api/v1/auth/mfa/status", headers=headers).json()["demo_account"] is True
