from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.models.http_vision import HttpRemoteVisionModel
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, Modality, Species
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings
from tests.conftest import make_payload


def test_http_vision_maps_response() -> None:
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200,
            json={
                "execution_status": "success",
                "source_kind": "real",
                "findings": [
                    {
                        "finding_code": "REMOTE-BRAIN",
                        "description": "Remote finding stub",
                        "anatomical_location": "brain",
                        "finding_status": "suspected",
                    }
                ],
                "warnings": ["from mock remote"],
            },
        )
    )
    model = HttpRemoteVisionModel(model_id="remote-vision-v1", endpoint="http://vision.test/infer")
    case = CaseRecord(
        case_id="case-1",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
    )
    original_client = httpx.Client

    class PatchedClient(original_client):  # type: ignore[misc,valid-type]
        def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)

    import app.models.http_vision as hv

    hv.httpx.Client = PatchedClient  # type: ignore[assignment]
    try:
        out = model.analyze(case)
    finally:
        hv.httpx.Client = original_client  # type: ignore[assignment]

    assert out.source_kind.value == "real"
    assert out.findings[0].finding_code == "REMOTE-BRAIN"


def test_remote_vision_registered_when_endpoint_set(tmp_path: Path) -> None:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        vision_endpoint="http://127.0.0.1:9/infer",
        vision_model_id="remote-vision-v1",
        async_analyze_delay_ms=0,
    )
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    assert "remote-vision-v1" in container.models
    client = TestClient(create_app(container))
    health = client.get("/api/v1/health").json()
    assert health["vision_endpoint"] is True
    created = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json"))
    assert created.status_code == 201
