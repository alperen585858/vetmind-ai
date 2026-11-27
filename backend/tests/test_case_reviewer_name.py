"""Case list shows the assigned expert's display name, not the e-mail prefix (#77)."""

from __future__ import annotations

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
        jwt_secret="test-secret-reviewer-77",
        tenant_isolation=True,
        async_analyze_delay_ms=0,
    )
    return TestClient(create_app(AppContainer(repo=InMemoryCaseRepository(), settings=settings)))


def _hdr(client: TestClient, email: str) -> dict[str, str]:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _row(client: TestClient, headers: dict[str, str], case_id: str) -> dict:
    rows = client.get("/api/v1/cases", headers=headers).json()
    return next(r for r in rows if r["case_id"] == case_id)


def test_case_summary_carries_reviewer_display_name(tmp_path: Path):
    client = _client(tmp_path)
    vet = _hdr(client, "vet@demo.local")
    expert = _hdr(client, "expert@demo.local")
    created = client.post(
        "/api/v1/cases",
        json={"patient_name": "Rex", "species": "canine", "modality": "MR", "anatomical_region": "BRAIN"},
        headers=vet,
    )
    assert created.status_code == 201, created.text
    cid = created.json()["case_id"]

    assert _row(client, vet, cid)["assigned_reviewer_name"] is None

    res = client.patch(f"/api/v1/cases/{cid}/assignment", json={"assigned_reviewer_id": "expert@demo.local"}, headers=expert)
    assert res.status_code == 200, res.text
    # Only the e-mail is known: no name (the UI shows a generic label, not "expert").
    row = _row(client, vet, cid)
    assert row["assigned_reviewer_id"] == "expert@demo.local"
    assert row["assigned_reviewer_name"] is None

    assert client.put("/api/v1/settings/me", json={"display_name": "Dr. Ahmet Demir"}, headers=expert).status_code == 200
    assert _row(client, vet, cid)["assigned_reviewer_name"] == "Dr. Ahmet Demir"
