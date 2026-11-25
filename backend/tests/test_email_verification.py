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


# --- step 2: verification tokens ----------------------------------------------

import sqlite3  # noqa: E402

import pytest  # noqa: E402

from app.auth.email_verification import EmailVerificationError, EmailVerificationService  # noqa: E402
from app.auth.password_reset import (  # noqa: E402
    InMemoryPasswordResetStore,
    SqlitePasswordResetStore,
)


def _svc(clock: list[float]) -> EmailVerificationService:
    return EmailVerificationService(InMemoryPasswordResetStore(), ttl_seconds=86400, clock=lambda: clock[0])


def test_verification_token_works_once() -> None:
    svc = _svc([0.0])
    raw = svc.issue("A@B.co")
    assert svc.consume(raw) == "a@b.co"
    with pytest.raises(EmailVerificationError) as exc:
        svc.consume(raw)
    assert exc.value.reason == "used"


def test_verification_token_expires_after_ttl() -> None:
    clock = [0.0]
    svc = _svc(clock)
    raw = svc.issue("a@b.co")
    clock[0] += 86400
    with pytest.raises(EmailVerificationError) as exc:
        svc.consume(raw)
    assert exc.value.reason == "expired"


def test_new_verification_link_voids_the_old_one() -> None:
    svc = _svc([0.0])
    old = svc.issue("a@b.co")
    new = svc.issue("a@b.co")
    with pytest.raises(EmailVerificationError):
        svc.consume(old)
    assert svc.consume(new) == "a@b.co"


def test_unknown_or_empty_token_is_rejected() -> None:
    svc = _svc([0.0])
    for raw, reason in (("", "missing"), ("nope", "unknown")):
        with pytest.raises(EmailVerificationError) as exc:
            svc.consume(raw)
        assert exc.value.reason == reason


def test_sql_store_uses_its_own_table_and_keeps_only_hashes(tmp_path: Path) -> None:
    db = tmp_path / "auth.sqlite3"
    svc = EmailVerificationService(SqlitePasswordResetStore(db, table="email_verifications"), ttl_seconds=60)
    raw = svc.issue("a@b.co")
    with sqlite3.connect(db) as conn:
        rows = conn.execute("SELECT token_hash FROM email_verifications").fetchall()
        resets = conn.execute("SELECT count(*) FROM password_resets").fetchone()[0]
    assert rows and all(raw not in r[0] for r in rows)
    assert resets == 0  # a verification link is not a password reset link
    assert svc.consume(raw) == "a@b.co"


def test_sql_store_rejects_unknown_table(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        SqlitePasswordResetStore(tmp_path / "x.sqlite3", table="managed_users")


def test_ttl_setting_is_clamped(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.settings import load_settings

    monkeypatch.setenv("VETMIND_EMAIL_VERIFY_TTL_SECONDS", "10")
    assert load_settings().email_verify_ttl_seconds == 300
    monkeypatch.setenv("VETMIND_EMAIL_VERIFY_TTL_SECONDS", "999999999")
    assert load_settings().email_verify_ttl_seconds == 7 * 24 * 60 * 60
    monkeypatch.delenv("VETMIND_EMAIL_VERIFY_TTL_SECONDS")
    assert load_settings().email_verify_ttl_seconds == 24 * 60 * 60


# --- step 3: API ----------------------------------------------------------------

import re  # noqa: E402

from app.security.rate_limit import VERIFY_PER_IP, VERIFY_RESEND_PER_EMAIL  # noqa: E402


def _token_from_outbox(container: AppContainer, to: str = NEW_VET) -> str:
    mail = next(m for m in reversed(container.mailer.outbox) if m.to == to and "/eposta-dogrula" in m.body)
    match = re.search(r"/eposta-dogrula\?token=([\w-]+)", mail.body)
    assert match, mail.body
    return match.group(1)


def _verify(client: TestClient, token: str):
    return client.post("/api/v1/auth/verify-email", json={"token": token})


def _activate(client: TestClient, admin: dict[str, str]):
    return client.patch(
        f"/api/v1/admin/users/{NEW_VET}", json={"active": True, "clinic_id": "clinic-demo-a"}, headers=admin
    )


def test_register_answer_is_identical_for_new_and_existing_email(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    new = _register(client)
    again = _register(client)
    demo = _register(client, email="vet@demo.local")
    assert new.status_code == again.status_code == demo.status_code == 202
    assert new.json()["status"] == "verification_sent"
    # Body differs only by the echoed address the caller typed.
    assert {k: v for k, v in new.json().items() if k != "email"} == {
        k: v for k, v in demo.json().items() if k != "email"
    }
    assert new.json() == again.json()


def test_new_account_gets_verification_mail(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    _register(client)
    mail = container.mailer.outbox[-1]
    assert mail.to == NEW_VET
    assert "doğrula" in mail.subject.lower() and "verify" in mail.subject.lower()
    assert "24" in mail.body  # hours
    assert GOOD_PASSWORD not in mail.body


def test_existing_account_gets_account_exists_mail_and_keeps_password(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    res = _register(client, email="vet@demo.local", password="Hijack2026x")
    assert res.status_code == 202
    mail = container.mailer.outbox[-1]
    assert mail.to == "vet@demo.local"
    assert "zaten" in mail.body and "/sifremi-unuttum" in mail.body
    assert "/eposta-dogrula" not in mail.body
    login = client.post("/api/v1/auth/login", json={"email": "vet@demo.local", "password": "demo1234"})
    assert login.status_code == 200


def test_full_flow_register_verify_activate_login(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    _register(client)
    admin = _admin(client)
    assert _activate(client, admin).status_code == 409  # not verified yet

    res = _verify(client, _token_from_outbox(container))
    assert res.status_code == 200, res.text
    assert res.json() == {"email": NEW_VET, "status": "verified", "pending_approval": True}
    assert container.workflow_store.get_user(NEW_VET).email_verified is True

    assert _activate(client, admin).status_code == 200
    login = client.post("/api/v1/auth/login", json={"email": NEW_VET, "password": GOOD_PASSWORD})
    assert login.status_code == 200, login.text


def test_verify_link_works_only_once(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    _register(client)
    token = _token_from_outbox(container)
    assert _verify(client, token).status_code == 200
    again = _verify(client, token)
    assert again.status_code == 400
    assert again.json()["detail"]["code"] == "verify_link_invalid"


def test_verify_link_expires(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    clock = [1_000.0]
    container.email_verifications._clock = lambda: clock[0]
    _register(client)
    token = _token_from_outbox(container)
    clock[0] += container.settings.email_verify_ttl_seconds + 1
    assert _verify(client, token).status_code == 400
    assert container.workflow_store.get_user(NEW_VET).email_verified is False


def test_password_reset_token_is_not_a_verification_token(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    _register(client)
    reset_raw = container.password_resets.issue(NEW_VET)
    assert _verify(client, reset_raw).status_code == 400


def test_resend_sends_new_link_and_voids_old(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    _register(client)
    old = _token_from_outbox(container)
    res = client.post("/api/v1/auth/verify-email/resend", json={"email": NEW_VET.upper()})
    assert res.status_code == 202
    new = _token_from_outbox(container)
    assert new != old
    assert _verify(client, old).status_code == 400
    assert _verify(client, new).status_code == 200


def test_resend_answer_is_identical_and_sends_nothing_for_others(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    before = len(container.mailer.outbox)
    unknown = client.post("/api/v1/auth/verify-email/resend", json={"email": "nobody@clinic.test"})
    verified = client.post("/api/v1/auth/verify-email/resend", json={"email": "vet@demo.local"})
    assert unknown.status_code == verified.status_code == 202
    assert unknown.json() == verified.json()
    assert len(container.mailer.outbox) == before


def test_resend_is_rate_limited_per_email(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    for _ in range(VERIFY_RESEND_PER_EMAIL.attempts):
        assert client.post("/api/v1/auth/verify-email/resend", json={"email": NEW_VET}).status_code == 202
    assert client.post("/api/v1/auth/verify-email/resend", json={"email": NEW_VET}).status_code == 429


def test_bad_verify_attempts_are_rate_limited(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    for _ in range(VERIFY_PER_IP.attempts):
        assert _verify(client, "guess-guess-guess").status_code == 400
    assert _verify(client, "guess-guess-guess").status_code == 429


def test_invalid_input_still_fails_fast(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    assert _register(client, email="not-an-email").status_code == 422
    assert _register(client, password="kisa1").status_code == 422
    assert len(container.mailer.outbox) == 0


def test_protected_mode_without_smtp_makes_no_link(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    # Only the mail decision reads this; a full protected setup is covered elsewhere.
    container.settings = replace(container.settings, deployment_mode="protected", smtp_host=None)
    assert _register(client).status_code == 202
    assert container.workflow_store.get_user(NEW_VET) is not None
    assert not any("/eposta-dogrula" in m.body for m in container.mailer.outbox)
    events = [e for e in container.audit.list_events(limit=50) if e["event_type"] == "auth.register"]
    assert any(e["detail"] == "smtp_required" for e in events)


def test_verification_is_audited(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    _register(client)
    _verify(client, _token_from_outbox(container))
    _verify(client, "bad-token-value")
    client.post("/api/v1/auth/verify-email/resend", json={"email": NEW_VET})
    events = container.audit.list_events(limit=100)
    kinds = {(e["event_type"], e["outcome"], e.get("detail")) for e in events}
    assert ("auth.verify_email", "success", None) in kinds
    assert ("auth.verify_email", "denied", "unknown") in kinds
    assert ("auth.verify_email_resend", "info", "no_unverified_account") in kinds
