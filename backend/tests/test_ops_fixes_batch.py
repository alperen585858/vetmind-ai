"""#127 audit order on timestamp ties, #137 configurable CORS origins."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.security.audit import AuditLogger, AuditQuery, new_event_id
from app.settings import Settings, load_settings, validate_security_settings

# ---- #127 -------------------------------------------------------------------------------

def test_event_ids_grow_even_within_one_clock_tick() -> None:
    ids = [new_event_id() for _ in range(200)]
    assert ids == sorted(ids)
    assert len(set(ids)) == len(ids)


@pytest.mark.parametrize("store", ["memory", "jsonl"])
def test_same_timestamp_events_keep_write_order(tmp_path: Path, store: str) -> None:
    log = AuditLogger(tmp_path / "audit.jsonl") if store == "jsonl" else AuditLogger()
    frozen = datetime(2026, 11, 28, 12, 0, tzinfo=timezone.utc)

    class _Frozen(datetime):
        @classmethod
        def now(cls, tz=None):  # noqa: ANN001
            return frozen

    with patch("app.security.audit.datetime", _Frozen):
        for i in range(30):
            log.record(event_type=f"step.{i:02d}", actor="a@b.c", resource="/x")
    events, _ = log.query(AuditQuery(limit=30))
    # Newest first: step.29 ... step.00, never shuffled.
    assert [e["event_type"] for e in events] == [f"step.{i:02d}" for i in reversed(range(30))]


# ---- #137 -------------------------------------------------------------------------------

def test_cors_default_is_the_vite_dev_server(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VETMIND_CORS_ORIGINS", raising=False)
    assert load_settings().cors_origins == ("http://localhost:5173", "http://127.0.0.1:5173")


def test_cors_origins_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VETMIND_CORS_ORIGINS", " https://vet.example.com/ ,https://app.example.com,")
    assert load_settings().cors_origins == ("https://vet.example.com", "https://app.example.com")
    monkeypatch.setenv("VETMIND_CORS_ORIGINS", "")
    assert load_settings().cors_origins == ()


def test_cors_header_follows_setting(tmp_path: Path) -> None:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=tmp_path / "x.sqlite3",
        quarantine_root=tmp_path / "q",
        cors_origins=("https://vet.example.com",),
    )
    client = TestClient(create_app(AppContainer(settings=settings)))
    ok = client.get("/api/v1/health", headers={"Origin": "https://vet.example.com"})
    assert ok.headers.get("access-control-allow-origin") == "https://vet.example.com"
    other = client.get("/api/v1/health", headers={"Origin": "http://localhost:5173"})
    assert "access-control-allow-origin" not in other.headers


def test_protected_mode_refuses_wildcard_cors(tmp_path: Path) -> None:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=tmp_path / "x.sqlite3",
        quarantine_root=tmp_path / "q",
        deployment_mode="protected",
        auth_enabled=True,
        jwt_secret="s" * 48,
        cors_origins=("*",),
    )
    with pytest.raises(RuntimeError, match="CORS"):
        validate_security_settings(settings)
