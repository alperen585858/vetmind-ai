from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.schemas.case import CaseCreate
from app.schemas.enums import AnatomicalRegion, MockScenario, Modality, Species
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


@pytest.fixture
def container(tmp_path: Path) -> AppContainer:
    # Tests always use in-memory storage for isolation and speed.
    return AppContainer(
        repo=InMemoryCaseRepository(),
        settings=Settings(
            storage_backend="memory",
            sqlite_path=Path("unused-memory.sqlite3"),
            quarantine_root=tmp_path / "quarantine",
            async_analyze_delay_ms=50,
        ),
    )


@pytest.fixture
def client(container: AppContainer) -> TestClient:
    return TestClient(create_app(container))


def make_payload(**kwargs) -> CaseCreate:
    data = dict(
        patient_name="Pax",
        species=Species.CANINE,
        breed="Golden Retriever",
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        clinical_history="Synthetic demo case. Not a real patient.",
        scenario=MockScenario.BRAIN_MRI_SUSPECTED,
    )
    data.update(kwargs)
    return CaseCreate(**data)
