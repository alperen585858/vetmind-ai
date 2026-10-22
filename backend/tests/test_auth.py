from pathlib import Path

from fastapi.testclient import TestClient

from app.auth.security import create_access_token, decode_token
from app.container import AppContainer
from app.main import create_app
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings
from tests.conftest import make_payload


def _auth_client(tmp_path: Path) -> TestClient:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret",
        async_analyze_delay_ms=0,
        rag_backend="embedding",
    )
    return TestClient(create_app(AppContainer(repo=InMemoryCaseRepository(), settings=settings)))


def test_jwt_roundtrip() -> None:
    token = create_access_token(subject="vet@demo.local", role="vet", secret="s", ttl_seconds=60)
    payload = decode_token(token, "s")
    assert payload["sub"] == "vet@demo.local"
    assert payload["role"] == "vet"


def test_auth_disabled_allows_anonymous(client: TestClient) -> None:
    status = client.get("/api/v1/auth/status").json()
    assert status["auth_enabled"] is False
    created = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json"))
    assert created.status_code == 201


def test_auth_enabled_requires_credentials(tmp_path: Path) -> None:
    client = _auth_client(tmp_path)
    denied = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json"))
    assert denied.status_code == 401

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "vet@demo.local", "password": "demo1234"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    ok = client.post(
        "/api/v1/cases",
        json=make_payload().model_dump(mode="json"),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert ok.status_code == 201

    api_key_ok = client.post(
        "/api/v1/cases",
        json=make_payload().model_dump(mode="json"),
        headers={"X-API-Key": "test-api-key"},
    )
    assert api_key_ok.status_code == 201


def test_auth_enabled_denies_unauthenticated_case_access(tmp_path: Path) -> None:
    client = _auth_client(tmp_path)
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "vet@demo.local", "password": "demo1234"},
    )
    token = login.json()["access_token"]
    created = client.post(
        "/api/v1/cases",
        json=make_payload().model_dump(mode="json"),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert created.status_code == 201
    case_id = created.json()["case_id"]

    denied = client.get(f"/api/v1/cases/{case_id}")
    assert denied.status_code == 401

    allowed = client.get(
        f"/api/v1/cases/{case_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert allowed.status_code == 200
    assert allowed.json()["case_id"] == case_id
