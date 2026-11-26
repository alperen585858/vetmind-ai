"""Issue #106 — admin audit screen API and suspicious-event rules."""

from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.security.audit_insights import csv_cell, find_suspicious, is_flagged, summarize
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings

T0 = datetime(2026, 11, 26, 12, 0, tzinfo=timezone.utc)


def _ev(minutes: int, event_type: str, actor: str, outcome: str = "success", detail: str | None = None) -> dict:
    return {
        "event_id": f"aud-{minutes:04d}-{actor[:4]}",
        "timestamp": (T0 + timedelta(minutes=minutes)).isoformat(),
        "event_type": event_type,
        "actor": actor,
        "resource": "/r",
        "outcome": outcome,
        "detail": detail,
        "clinic_id": None,
    }


# --- rules (pure) ------------------------------------------------------------------------


def test_failed_logins_need_five_within_fifteen_minutes() -> None:
    spread = [_ev(m * 10, "auth.login", "a@x", "denied") for m in range(6)]  # 10 min apart
    assert find_suspicious(spread) == []
    burst = [_ev(m, "auth.login", "b@x", "denied") for m in range(5)]
    [item] = find_suspicious(burst)
    assert (item["kind"], item["actor"], item["count"]) == ("failed_logins", "b@x", 5)
    # Successful logins never count.
    assert find_suspicious([_ev(m, "auth.login", "c@x") for m in range(9)]) == []


def test_rate_limit_and_refresh_reuse_are_flagged() -> None:
    events = [
        _ev(1, "auth.rate_limited", "d@x", "denied", "login_email"),
        _ev(2, "auth.rate_limited", "d@x", "denied", "login_ip"),
        _ev(3, "auth.refresh", "anonymous", "denied", "reused"),
        _ev(4, "auth.refresh", "anonymous", "denied", "expired"),  # normal expiry: not suspicious
    ]
    kinds = {(i["kind"], i["count"]) for i in find_suspicious(events)}
    assert kinds == {("rate_limited", 2), ("refresh_reuse", 1)}
    assert is_flagged(events[0], set()) and is_flagged(events[2], set()) and not is_flagged(events[3], set())
    assert is_flagged(_ev(5, "auth.login", "e@x", "denied"), {"e@x"})
    assert not is_flagged(_ev(5, "auth.login", "e@x", "denied"), set())


def test_summary_counts_windows() -> None:
    now = T0 + timedelta(days=2)
    events = [
        _ev(0, "auth.login", "a@x"),  # 2 days ago: 7d only
        _ev(60 * 47, "auth.login", "a@x"),  # 1 hour ago
        _ev(60 * 47 + 1, "auth.login", "b@x", "denied"),
        _ev(60 * 47 + 2, "auth.rate_limited", "b@x", "denied"),
    ]
    s = summarize(events, now=now)
    assert (s["events_24h"], s["events_7d"], s["logins_24h"], s["failed_logins_24h"], s["rate_limited_24h"]) == (3, 4, 1, 1, 1)
    assert s["by_type_7d"][0] == {"event_type": "auth.login", "count": 3}


@pytest.mark.parametrize(
    ("value", "out"),
    [("=HYPERLINK(1)", "'=HYPERLINK(1)"), ("+1", "'+1"), ("-2", "'-2"), ("@x", "'@x"), ("ok", "ok"), (None, "")],
)
def test_csv_cells_cannot_become_formulas(value, out) -> None:
    assert csv_cell(value) == out


# --- API ---------------------------------------------------------------------------------


def _app(tmp_path: Path) -> tuple[TestClient, AppContainer]:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-audit-1234567890123456",
        tenant_isolation=True,
        async_analyze_delay_ms=0,
    )
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    return TestClient(create_app(container)), container


def _login(client: TestClient, email: str, password: str = "demo1234"):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def _hdr(client: TestClient, email: str) -> dict[str, str]:
    res = _login(client, email)
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def test_only_admin_and_clinic_owner(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    for email in ("vet@demo.local", "expert@demo.local"):
        assert client.get("/api/v1/admin/audit", headers=_hdr(client, email)).status_code == 403
    assert client.get("/api/v1/admin/audit").status_code == 401
    assert client.get("/api/v1/admin/audit", headers=_hdr(client, "admin@demo.local")).status_code == 200


def test_admin_sees_failed_login_flagged_and_filters(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    for _ in range(5):
        assert _login(client, "vet@demo.local", "wrong-password").status_code == 401
    admin = _hdr(client, "admin@demo.local")
    page = client.get("/api/v1/admin/audit", params={"event_type": "auth.login", "outcome": "denied"}, headers=admin).json()
    assert len(page["items"]) == 5 and all(i["actor"] == "vet@demo.local" for i in page["items"])
    assert all(i["suspicious"] for i in page["items"])
    summary = client.get("/api/v1/admin/audit/summary", headers=admin).json()
    assert summary["failed_logins_24h"] == 5
    assert any(s["kind"] == "failed_logins" and s["actor"] == "vet@demo.local" for s in summary["suspicious"])
    # Prefix and actor filters.
    auth_only = client.get("/api/v1/admin/audit", params={"event_type": "auth.", "limit": 200}, headers=admin).json()
    assert auth_only["items"] and all(i["event_type"].startswith("auth.") for i in auth_only["items"])
    assert client.get("/api/v1/admin/audit", params={"since": "not-a-date"}, headers=admin).status_code == 422


def test_paging_with_cursor(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    for i in range(7):
        container.audit.record(event_type="dicom.upload", actor=f"u{i}@x", resource="/r")
    admin = _hdr(client, "admin@demo.local")
    first = client.get("/api/v1/admin/audit", params={"event_type": "dicom.upload", "limit": 4}, headers=admin).json()
    second = client.get(
        "/api/v1/admin/audit", params={"event_type": "dicom.upload", "limit": 4, "cursor": first["next_cursor"]}, headers=admin
    ).json()
    ids = [i["event_id"] for i in first["items"] + second["items"]]
    assert len(ids) == 7 == len(set(ids)) and second["next_cursor"] is None


def test_clinic_owner_only_sees_own_clinic(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    mine = container.audit.record(event_type="case.create", actor="vet@demo.local", resource="/c", clinic_id="clinic-demo-a")
    container.audit.record(event_type="case.create", actor="vet-b@demo.local", resource="/c", clinic_id="clinic-demo-b")
    owner = _hdr(client, "clinic-owner@demo.local")
    page = client.get("/api/v1/admin/audit", params={"event_type": "case.create", "clinic_id": "clinic-demo-b"}, headers=owner).json()
    assert page["scoped_to_clinic"] == "clinic-demo-a"
    assert [i["event_id"] for i in page["items"]] == [mine.event_id]  # the clinic filter cannot widen the scope


def test_csv_export(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    container.audit.record(event_type="auth.login", actor="=cmd|'/c calc'!A1", resource="/r", outcome="denied")
    admin = _hdr(client, "admin@demo.local")
    res = client.get("/api/v1/admin/audit/export.csv", params={"event_type": "auth.login"}, headers=admin)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    assert "attachment" in res.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(res.text.lstrip("﻿"))))
    assert rows[0] == ["timestamp", "event_type", "actor", "outcome", "clinic_id", "resource", "detail"]
    assert any(r[2].startswith("'=cmd") for r in rows[1:])
    assert int(res.headers["x-audit-rows"]) == len(rows) - 1


def test_viewing_and_exporting_are_audited_but_paging_is_not(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    for i in range(3):
        container.audit.record(event_type="dicom.upload", actor=f"u{i}", resource="/r")
    admin = _hdr(client, "admin@demo.local")
    first = client.get("/api/v1/admin/audit", params={"limit": 1}, headers=admin).json()
    client.get("/api/v1/admin/audit", params={"limit": 1, "cursor": first["next_cursor"]}, headers=admin)
    client.get("/api/v1/admin/audit/export.csv", headers=admin)
    kinds = [e["event_type"] for e in container.audit.list_events(limit=500)]
    assert kinds.count("admin.audit_view") == 1
    assert kinds.count("admin.audit_export") == 1


def test_no_secrets_in_audit_rows(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    _login(client, "vet@demo.local", "Sifre-Gizli-123")
    res = _login(client, "admin@demo.local")
    token = res.json()["access_token"]
    refresh = res.json()["refresh_token"]
    admin = {"Authorization": f"Bearer {token}"}
    text = client.get("/api/v1/admin/audit", params={"limit": 200}, headers=admin).text
    text += client.get("/api/v1/admin/audit/export.csv", headers=admin).text
    for secret in ("Sifre-Gizli-123", "demo1234", token, refresh):
        assert secret not in text


def test_demo_accounts_untouched_after_using_the_screen(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    admin = _hdr(client, "admin@demo.local")
    client.get("/api/v1/admin/audit", headers=admin)
    client.get("/api/v1/admin/audit/summary", headers=admin)
    client.get("/api/v1/admin/audit/export.csv", headers=admin)
    for email in ("vet@demo.local", "expert@demo.local", "clinic-owner@demo.local", "admin@demo.local"):
        assert _login(client, email).status_code == 200
