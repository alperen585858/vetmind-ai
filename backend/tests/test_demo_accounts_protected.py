"""The shared-password *@demo.local seed accounts must not sign in to a protected deployment."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.auth.security import DEMO_USERS
from app.container import AppContainer
from app.main import create_app
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings, demo_accounts_enabled, load_settings

API_KEY = "test-api-key"


def _settings(tmp_path: Path, **kwargs) -> Settings:
    base = dict(
        storage_backend="sqlite",
        sqlite_path=tmp_path / "vetmind.sqlite3",
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key=API_KEY,
        jwt_secret="k" * 32,
        async_analyze_delay_ms=0,
        rag_backend="embedding",
        tenant_isolation=True,
        deployment_mode="protected",
        malware_scan_required=True,
        dicom_identity_scrub=True,
        self_registration_enabled=False,
        audit_log_path=tmp_path / "audit.jsonl",
        max_concurrent_analyze=4,
        analyze_gate_path=tmp_path / "analyze_gate.count",
    )
    base.update(kwargs)
    return Settings(**base)


def _client(tmp_path: Path, **kwargs) -> TestClient:
    os.environ.setdefault("VETMIND_MALWARE_SCANNER", "fake_clean")
    return TestClient(
        create_app(AppContainer(repo=InMemoryCaseRepository(), settings=_settings(tmp_path, **kwargs)))
    )


def _login(client: TestClient, email: str) -> int:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    return res.status_code


@pytest.mark.parametrize("email", sorted(DEMO_USERS))
def test_protected_mode_rejects_every_demo_account(tmp_path: Path, email: str) -> None:
    assert _login(_client(tmp_path), email) == 401


def test_demo_rows_from_an_earlier_demo_run_stay_locked(tmp_path: Path) -> None:
    """Same database first run in demo mode (seeds the accounts), then switched to protected."""
    demo = _client(tmp_path, deployment_mode="demo", malware_scan_required=False, dicom_identity_scrub=False)
    assert _login(demo, "admin@demo.local") == 200
    protected = _client(tmp_path)
    assert _login(protected, "admin@demo.local") == 401
    assert "admin@demo.local" not in protected.app.state.container.auth.users  # type: ignore[attr-defined]


def test_admin_cannot_recreate_a_demo_address_in_protected_mode(tmp_path: Path) -> None:
    client = _client(tmp_path)
    headers = {"X-API-Key": API_KEY}
    created = client.post(
        "/api/v1/admin/users",
        headers=headers,
        json={"email": "admin@demo.local", "password": "Str0ng-pass!", "role": "admin"},
    )
    assert created.status_code == 422
    patched = client.patch(
        "/api/v1/admin/users/admin@demo.local", headers=headers, json={"password": "Str0ng-pass!"}
    )
    assert patched.status_code == 404
    assert _login(client, "admin@demo.local") == 401


def test_explicit_opt_in_keeps_demo_accounts_for_readiness_runs(tmp_path: Path) -> None:
    assert _login(_client(tmp_path, demo_accounts=True), "vet@demo.local") == 200


def test_demo_mode_keeps_demo_accounts(tmp_path: Path) -> None:
    client = _client(tmp_path, deployment_mode="demo", malware_scan_required=False, dicom_identity_scrub=False)
    assert _login(client, "vet@demo.local") == 200


def test_env_default_follows_deployment_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VETMIND_DEMO_ACCOUNTS", raising=False)
    monkeypatch.setenv("VETMIND_DEPLOYMENT_MODE", "protected")
    assert demo_accounts_enabled(load_settings()) is False
    monkeypatch.setenv("VETMIND_DEPLOYMENT_MODE", "demo")
    assert demo_accounts_enabled(load_settings()) is True
    monkeypatch.setenv("VETMIND_DEPLOYMENT_MODE", "protected")
    monkeypatch.setenv("VETMIND_DEMO_ACCOUNTS", "1")
    assert demo_accounts_enabled(load_settings()) is True
