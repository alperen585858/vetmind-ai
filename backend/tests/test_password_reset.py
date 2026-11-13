"""Issue #31 step 4 — password change, forgot-password email, single-use reset links."""

from __future__ import annotations

import logging
import re
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.auth.mailer import LogMailer, OutgoingMail, SmtpMailer, build_mailer
from app.auth.password_reset import (
    InMemoryPasswordResetStore,
    PasswordResetError,
    PasswordResetService,
    SqlitePasswordResetStore,
)
from app.container import AppContainer
from app.main import create_app
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings

NEW_PASSWORD = "Yeni-Sifre-2026"


def _settings(tmp_path: Path, **overrides) -> Settings:
    base = Settings(
        storage_backend="memory",
        sqlite_path=tmp_path / "db" / "vetmind.sqlite3",
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-reset",
        tenant_isolation=True,
        async_analyze_delay_ms=0,
        public_base_url="https://vetmind.example",
    )
    return replace(base, **overrides)


def _app(tmp_path: Path, **overrides) -> tuple[TestClient, AppContainer]:
    container = AppContainer(repo=InMemoryCaseRepository(), settings=_settings(tmp_path, **overrides))
    return TestClient(create_app(container)), container


def _login(client: TestClient, email: str = "vet@demo.local", password: str = "demo1234"):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _forgot(client: TestClient, email: str):
    return client.post("/api/v1/auth/password/forgot", json={"email": email})


def _reset(client: TestClient, token: str, password: str = NEW_PASSWORD):
    return client.post("/api/v1/auth/password/reset", json={"token": token, "new_password": password})


def _token_from_mail(container: AppContainer) -> str:
    mail = container.mailer.outbox[-1]
    match = re.search(r"https://vetmind\.example/sifre-sifirla\?token=([\w-]+)", mail.body)
    assert match, mail.body
    return match.group(1)


# --- change -----------------------------------------------------------------


def test_change_password_keeps_this_session_and_ends_the_others(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    laptop = _login(client).json()
    phone = _login(client).json()

    res = client.post(
        "/api/v1/auth/password/change",
        json={"current_password": "demo1234", "new_password": NEW_PASSWORD},
        headers=_bearer(laptop["access_token"]),
    )
    assert res.status_code == 200, res.text
    fresh = res.json()

    me = lambda tok: client.get("/api/v1/auth/me", headers=_bearer(tok)).status_code  # noqa: E731
    assert me(fresh["access_token"]) == 200
    assert me(laptop["access_token"]) == 401
    assert me(phone["access_token"]) == 401
    refresh = lambda tok: client.post("/api/v1/auth/refresh", json={"refresh_token": tok}).status_code  # noqa: E731
    assert refresh(phone["refresh_token"]) == 401
    assert refresh(fresh["refresh_token"]) == 200
    assert _login(client, password="demo1234").status_code == 401
    assert _login(client, password=NEW_PASSWORD).status_code == 200


def test_change_password_requires_correct_current_password(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    tok = _login(client).json()["access_token"]
    res = client.post(
        "/api/v1/auth/password/change",
        json={"current_password": "wrong", "new_password": NEW_PASSWORD},
        headers=_bearer(tok),
    )
    assert res.status_code == 400
    assert _login(client).status_code == 200


def test_change_password_enforces_policy(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    tok = _login(client).json()["access_token"]
    res = client.post(
        "/api/v1/auth/password/change",
        json={"current_password": "demo1234", "new_password": "zayif"},
        headers=_bearer(tok),
    )
    assert res.status_code == 422
    assert _login(client).status_code == 200


def test_change_password_needs_a_user_session(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    no_auth = client.post(
        "/api/v1/auth/password/change", json={"current_password": "demo1234", "new_password": NEW_PASSWORD}
    )
    assert no_auth.status_code == 401
    api_key = client.post(
        "/api/v1/auth/password/change",
        json={"current_password": "demo1234", "new_password": NEW_PASSWORD},
        headers={"X-API-Key": "test-api-key"},
    )
    assert api_key.status_code == 400


# --- forgot -----------------------------------------------------------------


def test_forgot_sends_link_and_same_answer_for_unknown_email(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    known = _forgot(client, "Vet@Demo.local")
    unknown = _forgot(client, "nobody@nowhere.test")
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()
    assert len(container.mailer.outbox) == 1
    mail = container.mailer.outbox[-1]
    assert mail.to == "vet@demo.local"
    assert "30" in mail.body  # minutes
    _token_from_mail(container)


def test_forgot_for_inactive_account_sends_nothing(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    admin = _login(client, "admin@demo.local").json()["access_token"]
    client.patch("/api/v1/admin/users/owner@demo.local", json={"active": False}, headers=_bearer(admin))
    assert _forgot(client, "owner@demo.local").status_code == 202
    assert len(container.mailer.outbox) == 0


def test_forgot_audit_never_contains_the_token(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    _forgot(client, "vet@demo.local")
    token = _token_from_mail(container)
    assert token not in str(container.audit.list_events(limit=50))


# --- reset ------------------------------------------------------------------


def test_reset_flow_end_to_end(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    old = _login(client).json()
    _forgot(client, "vet@demo.local")
    token = _token_from_mail(container)

    assert _reset(client, token).status_code == 204
    assert _login(client, password=NEW_PASSWORD).status_code == 200
    assert _login(client, password="demo1234").status_code == 401
    # All sessions from before the reset are gone.
    assert client.get("/api/v1/auth/me", headers=_bearer(old["access_token"])).status_code == 401
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": old["refresh_token"]}).status_code == 401


def test_reset_link_works_only_once(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    _forgot(client, "vet@demo.local")
    token = _token_from_mail(container)
    assert _reset(client, token).status_code == 204
    again = _reset(client, token, "Baska-Sifre-99")
    assert again.status_code == 400
    assert "invalid or has expired" in again.json()["detail"]
    assert _login(client, password=NEW_PASSWORD).status_code == 200


def test_new_link_invalidates_the_older_one(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    _forgot(client, "vet@demo.local")
    first = _token_from_mail(container)
    _forgot(client, "vet@demo.local")
    second = _token_from_mail(container)
    assert first != second
    assert _reset(client, first).status_code == 400
    assert _reset(client, second).status_code == 204


def test_weak_password_does_not_burn_the_link(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    _forgot(client, "vet@demo.local")
    token = _token_from_mail(container)
    assert _reset(client, token, "zayif").status_code == 422
    assert _reset(client, token).status_code == 204


@pytest.mark.parametrize("token", ["x", "made-up-token-made-up-token-made-up-token"])
def test_unknown_reset_token_is_rejected(tmp_path: Path, token: str) -> None:
    client, _ = _app(tmp_path)
    assert _reset(client, token).status_code == 400


def test_reset_for_user_deactivated_after_request_is_rejected(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    _forgot(client, "owner@demo.local")
    token = _token_from_mail(container)
    admin = _login(client, "admin@demo.local").json()["access_token"]
    client.patch("/api/v1/admin/users/owner@demo.local", json={"active": False}, headers=_bearer(admin))
    assert _reset(client, token).status_code == 400


def test_reset_link_expires() -> None:
    clock = [0.0]
    svc = PasswordResetService(InMemoryPasswordResetStore(), ttl_seconds=1800, clock=lambda: clock[0])
    raw = svc.issue("a@b.co")
    clock[0] += 1800
    with pytest.raises(PasswordResetError) as exc:
        svc.consume(raw)
    assert exc.value.reason == "expired"


def test_sqlite_reset_store_keeps_only_hashes(tmp_path: Path) -> None:
    store = SqlitePasswordResetStore(tmp_path / "auth.sqlite3")
    svc = PasswordResetService(store, ttl_seconds=1800)
    raw = svc.issue("a@b.co")
    import sqlite3

    with sqlite3.connect(tmp_path / "auth.sqlite3") as conn:
        rows = conn.execute("SELECT token_hash FROM password_resets").fetchall()
    assert rows and all(raw not in r[0] for r in rows)
    assert svc.consume(raw) == "a@b.co"


# --- mailer -----------------------------------------------------------------


def test_build_mailer_choices(tmp_path: Path) -> None:
    assert isinstance(build_mailer(_settings(tmp_path)), LogMailer)
    assert isinstance(build_mailer(_settings(tmp_path, smtp_host="smtp.example.com")), SmtpMailer)


def test_log_mailer_hides_body_in_protected_mode(caplog: pytest.LogCaptureFixture) -> None:
    mail = OutgoingMail("a@b.co", "Reset", "secret-link-123")
    with caplog.at_level(logging.WARNING, logger="app.auth.mailer"):
        LogMailer(log_body=True).send(mail)
        assert "secret-link-123" in caplog.text
        caplog.clear()
        LogMailer(log_body=False).send(mail)
        assert "secret-link-123" not in caplog.text
        assert "NOT delivered" in caplog.text


def test_smtp_failure_does_not_raise() -> None:
    mailer = SmtpMailer(
        host="127.0.0.1", port=1, sender="x@y.z", username=None, password=None, starttls=False, timeout_s=0.5
    )
    mailer.send(OutgoingMail("a@b.co", "Reset", "body"))  # connection refused → logged, not raised
    assert len(mailer.outbox) == 1


def test_forgot_does_the_same_work_before_answering_for_any_address(tmp_path: Path) -> None:
    """Timing: account lookup, token and email all run after the response is sent."""
    from fastapi import BackgroundTasks
    from starlette.requests import Request

    from app.api.auth import PasswordForgotRequest, _send_reset_link, forgot_password

    _, container = _app(tmp_path)
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/auth/password/forgot",
            "headers": [],
            "query_string": b"",
            "client": ("192.0.2.10", 5000),
            "server": ("test", 80),
            "scheme": "http",
        }
    )
    scheduled = {}
    for email in ("vet@demo.local", "nobody@nowhere.test"):
        background = BackgroundTasks()
        body = forgot_password(PasswordForgotRequest(email=email), request, background, container)
        assert len(container.mailer.outbox) == 0  # nothing sent before the response
        assert [t.func for t in background.tasks] == [_send_reset_link]
        scheduled[email] = (body, background)
    assert scheduled["vet@demo.local"][0] == scheduled["nobody@nowhere.test"][0]

    for _, background in scheduled.values():
        for task in background.tasks:
            task.func(*task.args, **task.kwargs)
    assert [m.to for m in container.mailer.outbox] == ["vet@demo.local"]


# --- admin reset link (issue #31 follow-up) ---------------------------------


def _admin_hdr(client: TestClient) -> dict[str, str]:
    return _bearer(_login(client, "admin@demo.local").json()["access_token"])


def test_admin_reset_link_works_once_and_signs_out_the_user(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    old = _login(client, "owner@demo.local").json()
    res = client.post("/api/v1/admin/users/Owner@Demo.local/reset-link", headers=_admin_hdr(client))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["email"] == "owner@demo.local"
    assert body["expires_in"] == 30 * 60
    assert body["link"].startswith("https://vetmind.example/sifre-sifirla?token=")
    token = body["link"].split("token=")[1]
    assert len(container.mailer.outbox) == 0  # nothing emailed

    assert _reset(client, token).status_code == 204
    assert _reset(client, token).status_code == 400
    assert _login(client, "owner@demo.local", NEW_PASSWORD).status_code == 200
    assert client.get("/api/v1/auth/me", headers=_bearer(old["access_token"])).status_code == 401
    events = [e for e in container.audit.list_events(limit=100) if e["event_type"] == "admin.password_reset_link"]
    assert events and token not in str(events)


def test_admin_reset_link_requires_admin_and_an_active_account(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    vet = _bearer(_login(client).json()["access_token"])
    assert client.post("/api/v1/admin/users/owner@demo.local/reset-link", headers=vet).status_code == 403
    admin = _admin_hdr(client)
    assert client.post("/api/v1/admin/users/nobody@x.test/reset-link", headers=admin).status_code == 404
    client.patch("/api/v1/admin/users/owner@demo.local", json={"active": False}, headers=admin)
    assert client.post("/api/v1/admin/users/owner@demo.local/reset-link", headers=admin).status_code == 404


# --- timestamps and rehash on login -----------------------------------------


def test_created_and_last_login_timestamps(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    res = client.post(
        "/api/v1/auth/register", json={"email": "ts@owner.test", "password": "Patiler2026", "role": "owner"}
    )
    assert res.status_code == 201
    user = container.workflow_store.get_user("ts@owner.test")
    assert user.created_at is not None and user.last_login_at is None
    assert _login(client, "ts@owner.test", "Patiler2026").status_code == 200
    user = container.workflow_store.get_user("ts@owner.test")
    assert user.last_login_at is not None and user.last_login_at >= user.created_at

    listed = client.get("/api/v1/admin/users", headers=_admin_hdr(client)).json()
    row = next(u for u in listed if u["email"] == "ts@owner.test")
    assert row["created_at"] and row["last_login_at"]
    assert "updated_at" not in row and "token_version" not in row


def test_login_upgrades_outdated_hash_without_signing_out(tmp_path: Path) -> None:
    import hashlib
    import secrets as _secrets
    import base64

    client, container = _app(tmp_path)
    salt = _secrets.token_bytes(16)
    weak_key = hashlib.scrypt(b"demo1234", salt=salt, n=2**10, r=8, p=1, dklen=32)
    weak = f"scrypt$1024$8$1${base64.b64encode(salt).decode()}${base64.b64encode(weak_key).decode()}"
    stored = container.workflow_store.get_user("vet@demo.local")
    container.workflow_store.save_user(stored.model_copy(update={"password_hash": weak}))
    container.workflow.sync_auth_directory()

    session = _login(client).json()  # old-parameter hash still verifies
    upgraded = container.workflow_store.get_user("vet@demo.local")
    assert upgraded.password_hash != weak
    assert upgraded.password_hash.startswith("scrypt$16384$8$1$")
    assert upgraded.token_version == stored.token_version
    assert client.get("/api/v1/auth/me", headers=_bearer(session["access_token"])).status_code == 200
    assert _login(client).status_code == 200
