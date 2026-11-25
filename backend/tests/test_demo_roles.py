"""#104 — auth off (demo): the backend uses the role picked in the UI."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


def _client(tmp_path: Path, **over) -> TestClient:
    s = Settings(
        storage_backend="memory",
        sqlite_path=tmp_path / "u.sqlite3",
        quarantine_root=tmp_path / "q",
        auth_enabled=False,
        async_analyze_delay_ms=0,
    )
    return TestClient(create_app(AppContainer(repo=InMemoryCaseRepository(), settings=replace(s, **over))))


def _as(role: str, subject: str | None = None) -> dict[str, str]:
    h = {"X-VetMind-Demo-Role": role}
    if subject:
        h["X-VetMind-Demo-Subject"] = subject
    return h


def test_admin_role_can_do_admin_work(tmp_path: Path) -> None:
    c = _client(tmp_path)
    res = c.post(
        "/api/v1/admin/users",
        json={"email": "new@clinic.test", "password": "Patiler2026", "role": "admin"},
        headers=_as("admin", "admin@demo.local"),
    )
    assert res.status_code == 201, res.text
    assert c.get("/api/v1/rag/documents", headers=_as("admin")).status_code == 200


def test_vet_role_is_still_refused_admin_work(tmp_path: Path) -> None:
    c = _client(tmp_path)
    res = c.post(
        "/api/v1/admin/users",
        json={"email": "x@clinic.test", "password": "Patiler2026", "role": "admin"},
        headers=_as("vet", "vet@demo.local"),
    )
    assert res.status_code == 403
    assert c.get("/api/v1/rag/documents", headers=_as("vet")).status_code == 403


def test_unknown_or_missing_role_falls_back_to_limited_demo(tmp_path: Path) -> None:
    c = _client(tmp_path)
    body = {"email": "y@clinic.test", "password": "Patiler2026", "role": "admin"}
    assert c.post("/api/v1/admin/users", json=body).status_code == 403
    assert c.post("/api/v1/admin/users", json=body, headers=_as("service")).status_code == 403


def test_headers_ignored_when_auth_is_on(tmp_path: Path) -> None:
    c = _client(tmp_path, auth_enabled=True, jwt_secret="test-secret-demo-roles", auth_api_key="k")
    res = c.post(
        "/api/v1/admin/users",
        json={"email": "z@clinic.test", "password": "Patiler2026", "role": "admin"},
        headers=_as("admin", "admin@demo.local"),
    )
    assert res.status_code == 401
