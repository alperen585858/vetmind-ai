"""Admin retention dry-run / apply with temp quarantine."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, Modality, Species
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings
from app.storage.quarantine import QuarantineStore


def _client(tmp_path: Path) -> TestClient:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=tmp_path / "unused.sqlite3",
        quarantine_root=tmp_path / "q",
        retention_dicom_days=1,
        auth_enabled=True,
        jwt_secret="retention-test-secret",
        async_analyze_delay_ms=0,
    )
    return TestClient(create_app(AppContainer(repo=InMemoryCaseRepository(), settings=settings)))


def _admin_token(client: TestClient) -> str:
    res = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@demo.local", "password": "demo1234"},
    )
    assert res.status_code == 200
    return res.json()["access_token"]


def test_retention_dry_run_and_apply(tmp_path: Path) -> None:
    q = QuarantineStore(tmp_path / "q")
    ingest_id = "dicom-retention-test"
    q.store_files(ingest_id, [("a.dcm", b"DICM" + b"\x00" * 128)])

    repo = InMemoryCaseRepository()
    old = datetime.now(timezone.utc) - timedelta(days=30)
    repo.save_case(
        CaseRecord(
            case_id="case-ret",
            created_at=old,
            patient_name="P",
            species=Species.CANINE,
            modality=Modality.MR,
            anatomical_region=AnatomicalRegion.BRAIN,
            dicom_ingest_id=ingest_id,
        )
    )
    settings = Settings(
        storage_backend="memory",
        sqlite_path=tmp_path / "unused.sqlite3",
        quarantine_root=tmp_path / "q",
        retention_dicom_days=1,
        auth_enabled=True,
        jwt_secret="retention-test-secret",
    )
    client = TestClient(create_app(AppContainer(repo=repo, settings=settings)))
    token = _admin_token(client)
    headers = {"Authorization": f"Bearer {token}"}

    plan = client.get("/api/v1/admin/retention/plan", headers=headers)
    assert plan.status_code == 200
    body = plan.json()
    assert body["dry_run"] is True
    assert any(i["kind"] == "dicom_ingest" for i in body["planned"])

    ingest_path = tmp_path / "q" / ingest_id
    assert ingest_path.is_dir()
    applied = client.post("/api/v1/admin/retention/apply", headers=headers)
    assert applied.status_code == 200
    body_apply = applied.json()
    assert body_apply["dry_run"] is False
    assert any(a.startswith("deleted:dicom_ingest:") for a in body_apply["applied"])
    assert not ingest_path.exists()
