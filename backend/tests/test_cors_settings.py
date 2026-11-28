"""VETMIND_CORS_ORIGINS controls which browser origins may call the API (#137)."""

from __future__ import annotations

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.services.repository import InMemoryCaseRepository
from app.settings import load_settings, validate_security_settings


def test_defaults_to_the_vite_dev_origins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VETMIND_CORS_ORIGINS", raising=False)
    assert load_settings().cors_origins == ("http://localhost:5173", "http://127.0.0.1:5173")


def test_reads_a_comma_separated_list(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VETMIND_CORS_ORIGINS", " https://vetmind.example/ , https://staging.vetmind.example ,")
    assert load_settings().cors_origins == ("https://vetmind.example", "https://staging.vetmind.example")


def test_protected_mode_rejects_wildcard(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VETMIND_CORS_ORIGINS", raising=False)
    settings = replace(
        load_settings(),
        deployment_mode="protected",
        auth_enabled=True,
        jwt_secret="x" * 48,
        cors_origins=("*",),
    )
    with pytest.raises(RuntimeError, match="VETMIND_CORS_ORIGINS"):
        validate_security_settings(settings)


def test_middleware_allows_only_configured_origins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VETMIND_CORS_ORIGINS", "https://vetmind.example")
    client = TestClient(create_app(AppContainer(repo=InMemoryCaseRepository())))
    preflight = {"Access-Control-Request-Method": "GET"}

    ok = client.options("/api/v1/health", headers={"Origin": "https://vetmind.example", **preflight})
    assert ok.headers.get("access-control-allow-origin") == "https://vetmind.example"

    other = client.options("/api/v1/health", headers={"Origin": "http://localhost:5173", **preflight})
    assert "access-control-allow-origin" not in other.headers
