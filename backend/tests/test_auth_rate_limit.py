"""Issue #31 step 5 — attempt limits on auth endpoints and protected-mode secret strength."""

from __future__ import annotations

import re
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.security.rate_limit import (
    FORGOT_PER_EMAIL,
    LOGIN_PER_EMAIL,
    LOGIN_PER_IP,
    REGISTER_PER_IP,
    RESET_PER_IP,
    Limit,
    RateLimiter,
)
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings, validate_security_settings


def _settings(tmp_path: Path, **overrides) -> Settings:
    base = Settings(
        storage_backend="memory",
        sqlite_path=tmp_path / "db" / "vetmind.sqlite3",
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-rate-limit",
        tenant_isolation=True,
        async_analyze_delay_ms=0,
        public_base_url="https://vetmind.example",
    )
    return replace(base, **overrides)


def _app(tmp_path: Path, **overrides) -> tuple[TestClient, AppContainer]:
    container = AppContainer(repo=InMemoryCaseRepository(), settings=_settings(tmp_path, **overrides))
    return TestClient(create_app(container)), container


def _login(client: TestClient, email: str, password: str, ip: str | None = None):
    headers = {"X-Forwarded-For": ip} if ip else {}
    return client.post("/api/v1/auth/login", json={"email": email, "password": password}, headers=headers)


# --- limiter unit -----------------------------------------------------------


def test_sliding_window_and_retry_after() -> None:
    clock = [0.0]
    rl = RateLimiter(clock=lambda: clock[0])
    lim = Limit(3, 60)
    for _ in range(3):
        assert rl.retry_after("s", "k", lim) is None
        rl.hit("s", "k", lim)
        clock[0] += 10
    assert rl.retry_after("s", "k", lim) == 30  # oldest hit at t=0 expires at t=60; now t=30
    clock[0] = 60.5
    assert rl.retry_after("s", "k", lim) is None  # first hit slid out of the window
    assert rl.retry_after("s", "other", lim) is None  # keys are independent


def test_disabled_limiter_never_limits() -> None:
    rl = RateLimiter(enabled=False)
    for _ in range(100):
        rl.hit("s", "k", Limit(1, 60))
    assert rl.retry_after("s", "k", Limit(1, 60)) is None


def test_key_table_is_bounded() -> None:
    rl = RateLimiter(max_keys=3)
    for i in range(10):
        rl.hit("s", f"k{i}", Limit(1, 60))
    assert len(rl._hits) == 3


# --- login ------------------------------------------------------------------


def test_login_locks_account_after_failed_attempts(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    for _ in range(LOGIN_PER_EMAIL.attempts):
        assert _login(client, "vet@demo.local", "wrong").status_code == 401
    blocked = _login(client, "vet@demo.local", "demo1234")  # even the right password waits
    assert blocked.status_code == 429
    assert int(blocked.headers["Retry-After"]) > 0
    assert re.match(r"Too many attempts\. Try again in \d+ min\.", blocked.json()["detail"])
    # Other accounts are unaffected (per-IP budget is larger).
    assert _login(client, "owner@demo.local", "demo1234").status_code == 200
    events = [e for e in container.audit.list_events(limit=100) if e["event_type"] == "auth.rate_limited"]
    assert events and events[-1]["detail"] == "login_email"


def test_successful_login_clears_the_account_counter(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    for _ in range(LOGIN_PER_EMAIL.attempts - 1):
        _login(client, "vet@demo.local", "wrong")
    assert _login(client, "vet@demo.local", "demo1234").status_code == 200
    for _ in range(LOGIN_PER_EMAIL.attempts - 1):
        assert _login(client, "vet@demo.local", "wrong").status_code == 401
    assert _login(client, "vet@demo.local", "demo1234").status_code == 200


def test_login_per_ip_limit_stops_spraying_many_accounts(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    for i in range(LOGIN_PER_IP.attempts):
        assert _login(client, f"user{i}@spray.test", "wrong").status_code == 401
    assert _login(client, "vet@demo.local", "demo1234").status_code == 429


def test_forwarded_for_is_ignored_unless_trusted(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    for i in range(LOGIN_PER_IP.attempts):
        _login(client, f"user{i}@spray.test", "wrong", ip=f"10.0.0.{i}")  # spoofed, ignored
    assert _login(client, "vet@demo.local", "demo1234", ip="10.9.9.9").status_code == 429


def test_forwarded_for_is_used_behind_a_trusted_proxy(tmp_path: Path) -> None:
    client, _ = _app(tmp_path, trust_proxy_headers=True)
    for i in range(LOGIN_PER_IP.attempts):
        _login(client, f"user{i}@spray.test", "wrong", ip="203.0.113.7, 10.0.0.1")
    assert _login(client, "vet@demo.local", "demo1234", ip="203.0.113.7").status_code == 429
    assert _login(client, "vet@demo.local", "demo1234", ip="198.51.100.2").status_code == 200


def test_rate_limit_can_be_disabled(tmp_path: Path) -> None:
    client, _ = _app(tmp_path, auth_rate_limit_enabled=False)
    for _ in range(LOGIN_PER_EMAIL.attempts + 3):
        _login(client, "vet@demo.local", "wrong")
    assert _login(client, "vet@demo.local", "demo1234").status_code == 200


# --- other endpoints --------------------------------------------------------


def test_forgot_limited_per_email_and_same_for_unknown_addresses(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    for email in ("vet@demo.local", "nobody@nowhere.test"):
        for _ in range(FORGOT_PER_EMAIL.attempts):
            assert client.post("/api/v1/auth/password/forgot", json={"email": email}).status_code == 202
        assert client.post("/api/v1/auth/password/forgot", json={"email": email}).status_code == 429
    assert len(container.mailer.outbox) == FORGOT_PER_EMAIL.attempts  # no mail once limited


def test_register_limited_per_ip(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    for i in range(REGISTER_PER_IP.attempts):
        res = client.post(
            "/api/v1/auth/register",
            json={"email": f"o{i}@owner.test", "password": "Patiler2026", "role": "owner"},
        )
        assert res.status_code == 201, res.text
    res = client.post(
        "/api/v1/auth/register", json={"email": "late@owner.test", "password": "Patiler2026", "role": "owner"}
    )
    assert res.status_code == 429


def test_reset_failures_limited_per_ip(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    body = {"token": "guess-guess-guess", "new_password": "Yeni-Sifre-2026"}
    for _ in range(RESET_PER_IP.attempts):
        assert client.post("/api/v1/auth/password/reset", json=body).status_code == 400
    assert client.post("/api/v1/auth/password/reset", json=body).status_code == 429


def test_password_change_wrong_current_password_is_limited(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    tok = _login(client, "vet@demo.local", "demo1234").json()["access_token"]
    hdr = {"Authorization": f"Bearer {tok}"}
    body = {"current_password": "wrong", "new_password": "Yeni-Sifre-2026"}
    for _ in range(5):
        assert client.post("/api/v1/auth/password/change", json=body, headers=hdr).status_code == 400
    ok_body = {"current_password": "demo1234", "new_password": "Yeni-Sifre-2026"}
    assert client.post("/api/v1/auth/password/change", json=ok_body, headers=hdr).status_code == 429


# --- protected mode secret --------------------------------------------------


def _protected(tmp_path: Path, secret: str) -> Settings:
    return _settings(
        tmp_path,
        deployment_mode="protected",
        jwt_secret=secret,
        malware_scan_required=True,
        dicom_identity_scrub=True,
    )


def test_protected_mode_rejects_short_jwt_secret(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="at least 32 characters"):
        validate_security_settings(_protected(tmp_path, "short-but-not-default"))


def test_protected_mode_accepts_long_jwt_secret(tmp_path: Path) -> None:
    validate_security_settings(_protected(tmp_path, "k" * 32))
