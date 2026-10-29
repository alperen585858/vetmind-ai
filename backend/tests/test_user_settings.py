from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


def _client(tmp_path: Path) -> TestClient:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=tmp_path / "unused.sqlite3",
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-settings",
        tenant_isolation=True,
        async_analyze_delay_ms=0,
        demo_seed=False,
    )
    return TestClient(create_app(AppContainer(repo=InMemoryCaseRepository(), settings=settings)))


def _hdr(client: TestClient, email: str = "vet@demo.local") -> dict[str, str]:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def test_settings_default_then_update(tmp_path: Path) -> None:
    client = _client(tmp_path)
    headers = _hdr(client)

    got = client.get("/api/v1/settings/me", headers=headers)
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["subject"] == "vet@demo.local"
    assert body["email_notifications"] is True
    assert body["compact_sidebar"] is False

    put = client.put(
        "/api/v1/settings/me",
        headers=headers,
        json={
            "display_name": "Dr. Elif",
            "org": "Ankara Klinik",
            "email_notifications": False,
            "compact_sidebar": True,
            "language": "tr",
        },
    )
    assert put.status_code == 200, put.text
    saved = put.json()
    assert saved["display_name"] == "Dr. Elif"
    assert saved["org"] == "Ankara Klinik"
    assert saved["email_notifications"] is False
    assert saved["compact_sidebar"] is True

    again = client.get("/api/v1/settings/me", headers=headers)
    assert again.status_code == 200
    assert again.json()["display_name"] == "Dr. Elif"
    assert again.json()["compact_sidebar"] is True


def test_settings_are_per_subject(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _hdr(client, "vet@demo.local")
    expert = _hdr(client, "expert@demo.local")

    assert client.put("/api/v1/settings/me", headers=vet, json={"display_name": "Vet Only"}).status_code == 200
    assert client.put("/api/v1/settings/me", headers=expert, json={"display_name": "Expert Only"}).status_code == 200

    assert client.get("/api/v1/settings/me", headers=vet).json()["display_name"] == "Vet Only"
    assert client.get("/api/v1/settings/me", headers=expert).json()["display_name"] == "Expert Only"


def test_settings_persist_in_sqlite(tmp_path: Path) -> None:
    settings = Settings(
        storage_backend="sqlite",
        sqlite_path=tmp_path / "cases.sqlite3",
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-settings-sqlite",
        tenant_isolation=True,
        async_analyze_delay_ms=0,
        demo_seed=False,
    )
    c1 = TestClient(create_app(AppContainer(settings=settings)))
    headers = _hdr(c1)
    assert (
        c1.put("/api/v1/settings/me", headers=headers, json={"display_name": "Persisted"}).status_code
        == 200
    )

    c2 = TestClient(create_app(AppContainer(settings=settings)))
    headers2 = _hdr(c2)
    assert c2.get("/api/v1/settings/me", headers=headers2).json()["display_name"] == "Persisted"
