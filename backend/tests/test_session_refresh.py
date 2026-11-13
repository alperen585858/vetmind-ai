"""Issue #31 step 3 — short-lived access tokens, rotating refresh tokens, logout, revocation."""

from __future__ import annotations

import sqlite3
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.auth.refresh_tokens import (
    CONCURRENT_GRACE_SECONDS,
    PURGE_INTERVAL_SECONDS,
    InMemoryRefreshTokenStore,
    RefreshTokenError,
    RefreshTokenService,
    hash_refresh_token,
)
from app.auth.security import DemoUserRecord, create_access_token, decode_token
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
        jwt_secret="test-secret-refresh",
        tenant_isolation=True,
        async_analyze_delay_ms=0,
    )
    return replace(base, **overrides)


def _app(tmp_path: Path, **overrides) -> tuple[TestClient, AppContainer]:
    container = AppContainer(repo=InMemoryCaseRepository(), settings=_settings(tmp_path, **overrides))
    return TestClient(create_app(container)), container


class _Clock:
    def __init__(self, start: float = 1_000_000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now


def _with_clock(container: AppContainer) -> _Clock:
    clock = _Clock()
    container.refresh_tokens._clock = clock
    return clock


def _login(client: TestClient, email: str = "vet@demo.local", password: str = "demo1234"):
    res = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return res.json()


def _refresh(client: TestClient, token: str):
    return client.post("/api/v1/auth/refresh", json={"refresh_token": token})


def _me(client: TestClient, access: str):
    return client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"})


# --- defaults / token shape -------------------------------------------------


def test_default_lifetimes() -> None:
    s = Settings(storage_backend="memory", sqlite_path=Path("x"), quarantine_root=Path("q"))
    assert s.jwt_ttl_seconds == 15 * 60
    assert s.refresh_ttl_seconds == 7 * 24 * 60 * 60


def test_login_returns_short_access_token_and_refresh_token(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    body = _login(client)
    assert body["expires_in"] == 15 * 60
    assert body["refresh_expires_in"] == 7 * 24 * 60 * 60
    assert len(body["refresh_token"]) >= 40
    claims = decode_token(body["access_token"], "test-secret-refresh")
    assert claims["exp"] - claims["iat"] == 15 * 60
    assert claims["tv"] == 0
    # Only the hash is stored.
    assert container.refresh_tokens._store.get(hash_refresh_token(body["refresh_token"])) is not None
    assert container.refresh_tokens._store.get(body["refresh_token"]) is None


def test_register_returns_refresh_token(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    res = client.post(
        "/api/v1/auth/register",
        json={"email": "new@owner.test", "password": "Patiler2026", "role": "owner"},
    )
    assert res.status_code == 201, res.text
    session = res.json()["session"]
    assert _refresh(client, session["refresh_token"]).status_code == 200


# --- refresh ----------------------------------------------------------------


def test_refresh_rotates_and_issues_working_access_token(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    first = _login(client)
    res = _refresh(client, first["refresh_token"])
    assert res.status_code == 200, res.text
    second = res.json()
    assert second["refresh_token"] != first["refresh_token"]
    assert second["email"] == "vet@demo.local" and second["role"] == "vet"
    assert _me(client, second["access_token"]).status_code == 200
    # The new refresh token works too.
    assert _refresh(client, second["refresh_token"]).status_code == 200


def test_reusing_a_rotated_refresh_token_revokes_the_whole_family(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    clock = _with_clock(container)
    first = _login(client)
    second = _refresh(client, first["refresh_token"]).json()
    clock.now += CONCURRENT_GRACE_SECONDS + 1

    stolen = _refresh(client, first["refresh_token"])  # replay of the old token
    assert stolen.status_code == 401
    assert stolen.json()["detail"] == "Session expired. Please sign in again."
    # The legitimate (newer) token of the same family is now dead as well.
    assert _refresh(client, second["refresh_token"]).status_code == 401

    reasons = [
        e["detail"] for e in container.audit.list_events(limit=50) if e["event_type"] == "auth.refresh"
    ]
    assert "reused" in reasons


def test_other_sign_ins_survive_a_revoked_family(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    clock = _with_clock(container)
    laptop = _login(client)
    phone = _login(client)
    _refresh(client, laptop["refresh_token"])
    clock.now += CONCURRENT_GRACE_SECONDS + 1
    _refresh(client, laptop["refresh_token"])  # reuse → laptop family revoked
    assert _refresh(client, phone["refresh_token"]).status_code == 200


@pytest.mark.parametrize("token", ["", "x" * 10, "not-a-real-token-but-long-enough-to-look-real-123"])
def test_unknown_or_empty_refresh_token_is_rejected(tmp_path: Path, token: str) -> None:
    client, _ = _app(tmp_path)
    res = _refresh(client, token)
    assert res.status_code in (401, 422)


def test_refresh_after_password_change_is_rejected_and_old_access_token_dies(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    vet = _login(client)
    admin = _login(client, "admin@demo.local")
    assert _me(client, vet["access_token"]).status_code == 200

    res = client.patch(
        "/api/v1/admin/users/vet@demo.local",
        json={"password": NEW_PASSWORD},
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert res.status_code == 200, res.text

    assert _me(client, vet["access_token"]).status_code == 401
    assert _refresh(client, vet["refresh_token"]).status_code == 401
    fresh = _login(client, "vet@demo.local", NEW_PASSWORD)
    assert decode_token(fresh["access_token"], "test-secret-refresh")["tv"] == 1
    assert _me(client, fresh["access_token"]).status_code == 200
    # The admin's own session is untouched.
    assert _me(client, admin["access_token"]).status_code == 200


def test_refresh_for_deactivated_user_is_rejected(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    owner = _login(client, "owner@demo.local")
    admin = _login(client, "admin@demo.local")
    client.patch(
        "/api/v1/admin/users/owner@demo.local",
        json={"active": False},
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert _me(client, owner["access_token"]).status_code == 401
    assert _refresh(client, owner["refresh_token"]).status_code == 401


def test_recreating_a_user_does_not_revive_old_tokens(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    admin = {"Authorization": f"Bearer {_login(client, 'admin@demo.local')['access_token']}"}
    body = {"email": "temp@clinic.test", "password": "Patiler2026", "role": "owner"}
    assert client.post("/api/v1/admin/users", json=body, headers=admin).status_code == 201
    old = _login(client, "temp@clinic.test", "Patiler2026")
    assert client.post("/api/v1/admin/users", json=body, headers=admin).status_code == 201
    assert _me(client, old["access_token"]).status_code == 401
    assert _refresh(client, old["refresh_token"]).status_code == 401


def test_access_token_with_wrong_token_version_is_rejected(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    forged = create_access_token(
        subject="vet@demo.local",
        role="vet",
        secret="test-secret-refresh",
        ttl_seconds=600,
        clinic_id="clinic-demo-a",
        token_version=5,
    )
    assert _me(client, forged).status_code == 401


# --- logout -----------------------------------------------------------------


def test_logout_revokes_refresh_token_and_is_idempotent(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    session = _login(client)
    for _ in range(2):
        res = client.post("/api/v1/auth/logout", json={"refresh_token": session["refresh_token"]})
        assert res.status_code == 204
    assert _refresh(client, session["refresh_token"]).status_code == 401


def test_logout_with_unknown_token_still_returns_204(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    res = client.post("/api/v1/auth/logout", json={"refresh_token": "nope-nope-nope"})
    assert res.status_code == 204


# --- service / storage ------------------------------------------------------


def _service(clock: list[float], directory: dict[str, DemoUserRecord] | None = None) -> RefreshTokenService:
    return RefreshTokenService(
        InMemoryRefreshTokenStore(),
        ttl_seconds=100,
        directory=directory if directory is not None else {"a@b.co": DemoUserRecord("h", "owner")},
        clock=lambda: clock[0],
    )


def test_refresh_token_expires_after_ttl() -> None:
    clock = [1000.0]
    svc = _service(clock)
    raw = svc.issue("a@b.co", token_version=0)
    clock[0] += 99
    _, _, raw2 = svc.rotate(raw)  # sliding window: new token gets a fresh TTL
    clock[0] += 100
    with pytest.raises(RefreshTokenError) as exc:
        svc.rotate(raw2)
    assert exc.value.reason == "expired"


def test_revoke_all_for_subject() -> None:
    clock = [0.0]
    svc = _service(clock)
    a = svc.issue("a@b.co", token_version=0)
    b = svc.issue("a@b.co", token_version=0)
    assert svc.revoke_all_for("A@B.co") == 2
    for raw in (a, b):
        with pytest.raises(RefreshTokenError):
            svc.rotate(raw)


def test_sqlite_store_persists_only_hashes_across_restart(tmp_path: Path) -> None:
    client, _ = _app(tmp_path, storage_backend="sqlite")
    session = _login(client)
    db = tmp_path / "db" / "vetmind_auth.sqlite3"
    with sqlite3.connect(db) as conn:
        rows = conn.execute("SELECT token_hash, subject FROM refresh_tokens").fetchall()
    assert rows and all(session["refresh_token"] not in r[0] for r in rows)

    # A new process (container) over the same files still honours the token.
    client2, _ = _app(tmp_path, storage_backend="sqlite")
    assert _refresh(client2, session["refresh_token"]).status_code == 200


# --- concurrent tabs / housekeeping ----------------------------------------


def test_two_tabs_refreshing_at_once_do_not_kill_the_session(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    clock = _with_clock(container)
    session = _login(client)
    tab_a = _refresh(client, session["refresh_token"])
    clock.now += 2
    tab_b = _refresh(client, session["refresh_token"])  # same token, a moment later
    assert tab_a.status_code == 200
    assert tab_b.status_code == 401
    # Tab B then picks up tab A's pair from shared storage; the session is alive.
    assert _refresh(client, tab_a.json()["refresh_token"]).status_code == 200
    reasons = [e["detail"] for e in container.audit.list_events(limit=50) if e["event_type"] == "auth.refresh"]
    assert "rotated_concurrently" in reasons and "reused" not in reasons


def test_replay_after_grace_window_is_still_treated_as_theft() -> None:
    clock = [0.0]
    svc = _service(clock)
    raw = svc.issue("a@b.co", token_version=0)
    _, _, new_raw = svc.rotate(raw)
    clock[0] += CONCURRENT_GRACE_SECONDS
    with pytest.raises(RefreshTokenError) as exc:
        svc.rotate(raw)
    assert exc.value.reason == "rotated_concurrently"
    clock[0] += 1
    with pytest.raises(RefreshTokenError) as exc:
        svc.rotate(raw)
    assert exc.value.reason == "reused"
    with pytest.raises(RefreshTokenError):
        svc.rotate(new_raw)  # family revoked


def test_logged_out_token_reuse_is_never_graced() -> None:
    clock = [0.0]
    svc = _service(clock)
    raw = svc.issue("a@b.co", token_version=0)
    svc.revoke(raw)
    with pytest.raises(RefreshTokenError) as exc:
        svc.rotate(raw)
    assert exc.value.reason == "reused"


def test_expired_rows_are_purged_periodically() -> None:
    clock = [0.0]
    store = InMemoryRefreshTokenStore()
    svc = RefreshTokenService(
        store, ttl_seconds=100, directory={"a@b.co": DemoUserRecord("h", "owner")}, clock=lambda: clock[0]
    )
    for _ in range(3):
        svc.issue("a@b.co", token_version=0)
    assert len(store._rows) == 3
    clock[0] += PURGE_INTERVAL_SECONDS + 1  # all three expired long ago
    svc.issue("a@b.co", token_version=0)
    assert len(store._rows) == 1


def test_sqlite_store_purge(tmp_path: Path) -> None:
    from app.auth.refresh_tokens import RefreshRecord, SqliteRefreshTokenStore

    store = SqliteRefreshTokenStore(tmp_path / "auth.sqlite3")
    store.save(RefreshRecord("old", "a@b.co", "f1", 0, 0.0, 10.0))
    store.save(RefreshRecord("new", "a@b.co", "f2", 0, 0.0, 1000.0))
    assert store.purge_expired(500.0) == 1
    assert store.get("old") is None and store.get("new") is not None
