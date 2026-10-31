"""DELETE /api/v1/cases/{id} — report/case cleanup with ownership checks."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.schemas.enums import CaseLifecycleStatus
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


def _client(tmp_path: Path) -> TestClient:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=tmp_path / "unused.sqlite3",
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-case-delete",
        tenant_isolation=True,
        async_analyze_delay_ms=0,
    )
    return TestClient(create_app(AppContainer(repo=InMemoryCaseRepository(), settings=settings)))


def _token(client: TestClient, email: str) -> str:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def _hdr(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _new_case(client: TestClient, token: str, name: str) -> str:
    created = client.post(
        "/api/v1/cases",
        json={
            "patient_name": name,
            "species": "canine",
            "breed": "Mix",
            "modality": "MR",
            "anatomical_region": "BRAIN",
        },
        headers=_hdr(token),
    )
    assert created.status_code == 201, created.text
    return created.json()["case_id"]


def test_vet_can_delete_case(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    case_id = _new_case(client, vet, "Silinecek")
    assert client.delete(f"/api/v1/cases/{case_id}", headers=_hdr(vet)).status_code == 204
    assert client.get(f"/api/v1/cases/{case_id}", headers=_hdr(vet)).status_code == 404


def test_owner_can_delete_own_approved_report(tmp_path: Path) -> None:
    client = _client(tmp_path)
    container = client.app.state.container  # type: ignore[attr-defined]
    vet_token = _token(client, "vet@demo.local")
    owner_token = _token(client, "owner@demo.local")

    case_id = _new_case(client, vet_token, "Zeytin-Del")
    case = container.repo.get_case(case_id)
    assert case is not None
    case.status = CaseLifecycleStatus.APPROVED
    case.pet_owner_subject = "owner@demo.local"
    container.repo.save_case(case)

    assert client.delete(f"/api/v1/cases/{case_id}", headers=_hdr(owner_token)).status_code == 204
    assert container.repo.get_case(case_id) is None


def test_owner_cannot_delete_unrelated_case(tmp_path: Path) -> None:
    client = _client(tmp_path)
    container = client.app.state.container  # type: ignore[attr-defined]
    vet_token = _token(client, "vet@demo.local")
    owner_token = _token(client, "owner@demo.local")

    case_id = _new_case(client, vet_token, "Yabanci")
    case = container.repo.get_case(case_id)
    assert case is not None
    case.status = CaseLifecycleStatus.APPROVED
    case.pet_owner_subject = "someone-else@demo.local"
    container.repo.save_case(case)

    # 404 — do not leak existence across owners
    assert client.delete(f"/api/v1/cases/{case_id}", headers=_hdr(owner_token)).status_code == 404
    assert container.repo.get_case(case_id) is not None
