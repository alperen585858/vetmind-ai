from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.models.http_vision import HttpRemoteVisionModel
from app.models.interfaces import ImagingAdapterError
from app.models.model_input_builder import build_imaging_model_input
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, Modality, ModelExecutionStatus, SourceKind, Species
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings
from tests.conftest import make_payload


def _case() -> CaseRecord:
    case = CaseRecord(
        case_id="case-1",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
    )
    case.model_input = build_imaging_model_input(case)
    return case


def _analyze_with_json(body: object, *, status_code: int = 200):
    transport = httpx.MockTransport(lambda request: httpx.Response(status_code, json=body))
    model = HttpRemoteVisionModel(model_id="remote-vision-v1", endpoint="http://vision.test/infer")
    original_client = httpx.Client

    class PatchedClient(original_client):  # type: ignore[misc,valid-type]
        def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)

    import app.models.http_vision as hv

    hv.httpx.Client = PatchedClient  # type: ignore[assignment]
    try:
        return model.analyze(_case())
    finally:
        hv.httpx.Client = original_client  # type: ignore[assignment]


def test_http_vision_maps_valid_success_response() -> None:
    out = _analyze_with_json(
        {
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
        }
    )
    assert out.execution_status == ModelExecutionStatus.SUCCESS
    assert out.source_kind == SourceKind.REAL
    assert out.findings[0].finding_code == "REMOTE-BRAIN"
    assert out.findings[0].synthetic is False
    assert out.findings[0].source_model == "remote-vision-v1"


def test_http_vision_preserves_partial_and_failed_status() -> None:
    partial = _analyze_with_json(
        {
            "execution_status": "partial",
            "source_kind": "real",
            "findings": [
                {
                    "finding_code": "REMOTE-PARTIAL",
                    "description": "Partial remote finding",
                    "finding_status": "uncertain",
                }
            ],
        }
    )
    assert partial.execution_status == ModelExecutionStatus.PARTIAL
    assert len(partial.findings) == 1

    failed = _analyze_with_json(
        {
            "execution_status": "failed",
            "source_kind": "real",
            "findings": [
                {
                    "finding_code": "SHOULD-NOT-MAP",
                    "description": "Must not be fabricated from failed remote",
                    "finding_status": "suspected",
                }
            ],
        }
    )
    assert failed.execution_status == ModelExecutionStatus.FAILED
    assert failed.findings == []
    assert any("ignoring finding" in w.lower() for w in failed.warnings)


@pytest.mark.parametrize(
    "body",
    [
        {"findings": []},  # missing execution_status
        {"execution_status": None, "findings": []},
        {"execution_status": "", "findings": []},
        {"execution_status": "   ", "findings": []},
        {"execution_status": "ok", "findings": []},  # unknown
        {"execution_status": "SUCCESSFUL", "findings": []},
        ["not", "an", "object"],
        {"execution_status": "success", "findings": "not-a-list"},
    ],
)
def test_http_vision_rejects_missing_unknown_malformed_status(body: object) -> None:
    with pytest.raises(ImagingAdapterError):
        _analyze_with_json(body)


def test_http_vision_flags_contradictory_synthetic_on_real() -> None:
    out = _analyze_with_json(
        {
            "execution_status": "success",
            "source_kind": "real",
            "findings": [
                {
                    "finding_code": "REMOTE-CONTRA",
                    "description": "Contradictory synthetic flag",
                    "finding_status": "possible",
                    "synthetic": True,
                }
            ],
        }
    )
    assert out.source_kind == SourceKind.REAL
    assert out.findings[0].synthetic is True  # preserved, not rewritten
    assert any("contradictory provenance" in w.lower() for w in out.warnings)


def test_remote_vision_registered_when_endpoint_set(tmp_path: Path) -> None:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        vision_endpoint="http://127.0.0.1:9/infer",
        vision_model_id="remote-vision-v1",
        vision_modalities=("MR",),
        vision_regions=("BRAIN",),
        vision_species=("canine", "feline"),
        vision_execution_policy="exclusive_real",
        async_analyze_delay_ms=0,
    )
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    assert "remote-vision-v1" in container.models
    client = TestClient(create_app(container))
    health = client.get("/api/v1/health").json()
    assert health["vision_endpoint"] is True
    assert health["vision_execution_policy"] == "exclusive_real"
    created = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json"))
    assert created.status_code == 201
