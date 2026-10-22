from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings
from tests.conftest import make_payload


def _client(tmp_path: Path, **kwargs) -> TestClient:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret",
        async_analyze_delay_ms=0,
        rag_backend="embedding",
        **kwargs,
    )
    return TestClient(create_app(AppContainer(repo=InMemoryCaseRepository(), settings=settings)))


def _token(client: TestClient, email: str) -> str:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def test_vet_cannot_review(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    created = client.post(
        "/api/v1/cases",
        json=make_payload().model_dump(mode="json"),
        headers={"Authorization": f"Bearer {vet}"},
    )
    assert created.status_code == 201
    case_id = created.json()["case_id"]
    client.post(f"/api/v1/cases/{case_id}/analyze", headers={"Authorization": f"Bearer {vet}"})
    denied = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "vet", "action": "approve", "comment": "nope"},
        headers={"Authorization": f"Bearer {vet}"},
    )
    assert denied.status_code == 403


def test_expert_can_review(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    expert = _token(client, "expert@demo.local")
    created = client.post(
        "/api/v1/cases",
        json=make_payload().model_dump(mode="json"),
        headers={"Authorization": f"Bearer {vet}"},
    )
    case_id = created.json()["case_id"]
    client.post(f"/api/v1/cases/{case_id}/analyze", headers={"Authorization": f"Bearer {vet}"})
    ok = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "expert-demo", "action": "approve", "comment": "ok"},
        headers={"Authorization": f"Bearer {expert}"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "approved"


def test_owner_cannot_create_case(tmp_path: Path) -> None:
    client = _client(tmp_path)
    owner = _token(client, "owner@demo.local")
    denied = client.post(
        "/api/v1/cases",
        json=make_payload().model_dump(mode="json"),
        headers={"Authorization": f"Bearer {owner}"},
    )
    assert denied.status_code == 403
