"""SQLite persistence behind CaseRepository."""

from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.schemas.enums import AnatomicalRegion, Modality, Species
from app.services.sqlite_repository import SqliteCaseRepository
from app.settings import Settings
from tests.conftest import make_payload


def test_sqlite_case_survives_reopen(tmp_path: Path) -> None:
    db = tmp_path / "vetmind.sqlite3"
    repo1 = SqliteCaseRepository(db)
    from uuid import uuid4

    from app.schemas.case import CaseRecord
    from app.schemas.enums import CaseLifecycleStatus

    case = CaseRecord(
        case_id=f"case-{uuid4().hex[:8]}",
        patient_name="Persist Demo",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        status=CaseLifecycleStatus.CREATED,
        classification_confirmed=True,
    )
    repo1.save_case(case)
    repo1.close()

    repo2 = SqliteCaseRepository(db)
    loaded = repo2.get_case(case.case_id)
    assert loaded is not None
    assert loaded.patient_name == "Persist Demo"
    assert loaded.modality == Modality.MR
    repo2.close()


def test_sqlite_api_restart_keeps_case(tmp_path: Path) -> None:
    db = tmp_path / "api.sqlite3"
    settings = Settings(
        storage_backend="sqlite",
        sqlite_path=db,
        quarantine_root=tmp_path / "quarantine",
    )
    container1 = AppContainer(settings=settings)
    client1 = TestClient(create_app(container1))

    created = client1.post("/api/v1/cases", json=make_payload().model_dump(mode="json"))
    assert created.status_code == 201
    case_id = created.json()["case_id"]

    health = client1.get("/api/v1/health").json()
    assert health["storage"] == "sqlite"

    # New container + client sharing the same DB file (simulates process restart).
    container2 = AppContainer(settings=settings)
    client2 = TestClient(create_app(container2))
    got = client2.get(f"/api/v1/cases/{case_id}")
    assert got.status_code == 200
    assert got.json()["case_id"] == case_id
    assert got.json()["patient_name"] == "Pax"


def test_sqlite_dicom_ingest_persists(tmp_path: Path) -> None:
    from app.dicom.fixtures import brain_mri_study_files

    db = tmp_path / "dicom.sqlite3"
    settings = Settings(
        storage_backend="sqlite",
        sqlite_path=db,
        quarantine_root=tmp_path / "quarantine-dicom",
    )
    client = TestClient(create_app(AppContainer(settings=settings)))

    files = brain_mri_study_files(1)
    upload = client.post(
        "/api/v1/dicom/upload",
        data={"patient_name": "Persist Dicom", "species": "canine"},
        files=[("files", (name, data, "application/dicom")) for name, data in files],
    )
    assert upload.status_code == 201
    ingest_id = upload.json()["ingest_id"]

    client2 = TestClient(create_app(AppContainer(settings=settings)))
    got = client2.get(f"/api/v1/dicom/ingestions/{ingest_id}")
    assert got.status_code == 200
    assert got.json()["patient_name"] == "Persist Dicom"


def test_build_repository_memory() -> None:
    from app.services.repository import InMemoryCaseRepository, build_repository

    repo = build_repository(
        Settings(
            storage_backend="memory",
            sqlite_path=Path("unused.db"),
            quarantine_root=Path("unused-quarantine"),
        )
    )
    assert isinstance(repo, InMemoryCaseRepository)


def test_default_tests_still_memory(client: TestClient) -> None:
    health = client.get("/api/v1/health").json()
    assert health["storage"] == "memory"
