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


# --- sign-in --------------------------------------------------------------------------------


def _start(client: TestClient, email: str = USER, password: str = PW) -> str:
    res = _login(client, email, password)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["mfa_required"] is True and "access_token" not in body
    return body["mfa_token"]


def _verify(client: TestClient, ticket: str, code: str):
    return client.post("/api/v1/auth/mfa/verify", json={"mfa_token": ticket, "code": code})


def test_sign_in_needs_the_code_when_enabled(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    secret, _codes, _h = _enable(client, _make_user(client))
    ticket = _start(client)
    # The ticket alone opens nothing.
    assert client.get("/api/v1/auth/me", headers=_bearer(ticket)).status_code == 401
    assert _verify(client, ticket, "000000").status_code == 401
    res = _verify(client, ticket, _code(secret, 1))
    assert res.status_code == 200, res.text
    assert client.get("/api/v1/auth/me", headers=_bearer(res.json()["access_token"])).status_code == 200
    # Ticket is single use and the code cannot be replayed.
    assert _verify(client, ticket, _code(secret, 1)).status_code == 401
    assert _verify(client, _start(client), _code(secret, 1)).status_code == 401


def test_backup_code_works_once(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    _secret, codes, _h = _enable(client, _make_user(client))
    assert _verify(client, _start(client), codes[0].upper().replace("-", " ")).status_code == 200
    assert _verify(client, _start(client), codes[0]).status_code == 401
    assert len(container.workflow_store.get_user(USER).mfa_backup_hashes) == 9
    kinds = [e["event_type"] for e in container.audit.list_events(limit=500)]
    assert "auth.mfa_backup_used" in kinds and "auth.mfa_failed" in kinds


def test_wrong_codes_are_rate_limited(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    secret, _codes, _h = _enable(client, _make_user(client))
    ticket = _start(client)
    for _ in range(5):
        assert _verify(client, ticket, "999999").status_code == 401
    assert _verify(client, ticket, _code(secret, 1)).status_code == 429


def test_expired_or_forged_ticket(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    secret, _codes, _h = _enable(client, _make_user(client))
    ticket = _start(client)
    forged = ticket[:-3] + ("AAA" if not ticket.endswith("AAA") else "BBB")
    assert _verify(client, forged, _code(secret, 1)).status_code == 401
    container.mfa_challenges._clock = lambda: 10**12  # noqa: SLF001 — far future
    assert _verify(client, ticket, _code(secret, 1)).status_code == 401


def test_password_change_voids_a_pending_ticket(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    secret, _codes, _h = _enable(client, _make_user(client))
    ticket = _start(client)
    container.workflow.set_password(USER, "YeniSifre2027")
    assert _verify(client, ticket, _code(secret, 1)).status_code == 401


def test_demo_accounts_still_sign_in_in_one_step(tmp_path: Path) -> None:
    client, _ = _app(tmp_path, mfa_required_roles=("admin", "expert", "vet", "clinic_owner"))
    for email in ("admin@demo.local", "vet@demo.local", "vet-b@demo.local", "expert@demo.local", "clinic-owner@demo.local"):
        body = _login(client, email).json()
        assert body["access_token"] and body["mfa_setup_required"] is False, email
        assert client.get("/api/v1/cases", headers=_bearer(body["access_token"])).status_code == 200


# --- required roles and admin reset ------------------------------------------------------


def test_required_role_gets_a_setup_only_session(tmp_path: Path) -> None:
    client, _ = _app(tmp_path, mfa_required_roles=("expert",))
    admin = _bearer(_login(client, "admin@demo.local").json()["access_token"])
    client.post(
        "/api/v1/admin/users",
        json={"email": USER, "password": PW, "role": "expert", "clinic_id": "clinic-demo-a"},
        headers=admin,
    )
    body = _login(client, USER, PW).json()
    assert body["mfa_setup_required"] is True
    limited = _bearer(body["access_token"])
    blocked = client.get("/api/v1/cases", headers=limited)
    assert blocked.status_code == 403 and blocked.json()["detail"]["code"] == "mfa_setup_required"
    assert client.get("/api/v1/auth/mfa/status", headers=limited).json()["required_for_role"] is True
    # Refreshing keeps the restriction.
    refreshed = client.post("/api/v1/auth/refresh", json={"refresh_token": body["refresh_token"]}).json()
    assert refreshed["mfa_setup_required"] is True
    secret = client.post("/api/v1/auth/mfa/setup", headers=limited).json()["secret"]
    done = client.post("/api/v1/auth/mfa/enable", json={"code": _code(secret)}, headers=limited).json()
    assert done["session"]["mfa_setup_required"] is False
    assert client.get("/api/v1/cases", headers=_bearer(done["session"]["access_token"])).status_code == 200
    # Admin of the policy endpoint sees the roles.
    policy = client.get("/api/v1/admin/mfa-policy", headers=admin).json()
    assert (policy["required_roles"], policy["source"]) == (["expert"], "env")


def test_admin_reset_turns_mfa_off_and_ends_sessions(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    _secret, _codes, user_headers = _enable(client, _make_user(client, role="vet"))
    admin = _bearer(_login(client, "admin@demo.local").json()["access_token"])
    listed = {u["email"]: u for u in client.get("/api/v1/admin/users", headers=admin).json()}
    assert listed[USER]["mfa_enabled"] is True
    res = client.post(f"/api/v1/admin/users/{USER}/mfa-reset", headers=admin)
    assert res.status_code == 200 and res.json()["mfa_enabled"] is False
    assert client.get("/api/v1/auth/me", headers=user_headers).status_code == 401
    body = _login(client, USER, PW).json()
    assert "access_token" in body  # one step again
    assert any(e["event_type"] == "admin.mfa_reset" for e in container.audit.list_events(limit=500))
    vet = _bearer(_login(client, "vet@demo.local").json()["access_token"])
    assert client.post(f"/api/v1/admin/users/{USER}/mfa-reset", headers=vet).status_code == 403



# --- policy saved from the admin screen ------------------------------------------------------


def test_admin_saves_policy_and_it_overrides_the_server_setting(tmp_path: Path) -> None:
    client, container = _app(tmp_path, mfa_required_roles=("vet",))
    admin = _bearer(_login(client, "admin@demo.local").json()["access_token"])
    start = client.get("/api/v1/admin/mfa-policy", headers=admin).json()
    assert start == {"required_roles": ["vet"], "source": "env", "available_roles": ["admin", "expert", "vet", "clinic_owner"]}

    res = client.put("/api/v1/admin/mfa-policy", json={"required_roles": ["expert", "admin", "expert"]}, headers=admin)
    assert res.status_code == 200, res.text
    assert (res.json()["required_roles"], res.json()["source"]) == (["admin", "expert"], "admin")
    # An empty list is a real choice too: nobody is forced, even though the env said "vet".
    cleared = client.put("/api/v1/admin/mfa-policy", json={"required_roles": []}, headers=admin).json()
    assert (cleared["required_roles"], cleared["source"]) == ([], "admin")
    events = [e for e in container.audit.list_events(limit=500) if e["event_type"] == "admin.mfa_policy_update"]
    assert [e["detail"] for e in events] == ["vet -> admin,expert", "admin,expert -> -"]


def test_policy_rejects_unknown_roles_and_non_admins(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    admin = _bearer(_login(client, "admin@demo.local").json()["access_token"])
    bad = client.put("/api/v1/admin/mfa-policy", json={"required_roles": ["owner"]}, headers=admin)
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "mfa_policy_unknown_role"
    for email in ("vet@demo.local", "expert@demo.local", "clinic-owner@demo.local"):
        headers = _bearer(_login(client, email).json()["access_token"])
        assert client.put("/api/v1/admin/mfa-policy", json={"required_roles": []}, headers=headers).status_code == 403


def test_saved_policy_applies_at_next_sign_in_and_spares_demo_accounts(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    admin = _bearer(_login(client, "admin@demo.local").json()["access_token"])
    client.post("/api/v1/admin/users", json={"email": USER, "password": PW, "role": "vet", "clinic_id": "clinic-demo-a"}, headers=admin)
    assert _login(client, USER, PW).json()["mfa_setup_required"] is False
    client.put("/api/v1/admin/mfa-policy", json={"required_roles": ["vet", "admin", "expert", "clinic_owner"]}, headers=admin)
    assert _login(client, USER, PW).json()["mfa_setup_required"] is True
    for email in ("admin@demo.local", "vet@demo.local", "vet-b@demo.local", "expert@demo.local", "clinic-owner@demo.local"):
        body = _login(client, email).json()
        assert body["mfa_setup_required"] is False, email
        assert client.get("/api/v1/cases", headers=_bearer(body["access_token"])).status_code == 200


def test_policy_survives_a_restart_on_sqlite(tmp_path: Path) -> None:
    """The saved policy lives in the database (Alembic 0005), not in process memory."""
    from app.services.app_settings_store import SqlAppSettingsStore
    from app.storage.sql import Database

    db = tmp_path / "settings.sqlite3"
    SqlAppSettingsStore(Database.sqlite(db).connect()).set("mfa_policy", {"required_roles": ["expert"]}, updated_by="a@b")
    again = SqlAppSettingsStore(Database.sqlite(db).connect())
    assert again.get("mfa_policy") == {"required_roles": ["expert"]}
    assert again.get("missing") is None
