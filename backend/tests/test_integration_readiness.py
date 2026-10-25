"""Plug-in readiness: fixtures, health mode, encryption fail-fast, bulk RAG, LLM cancel."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.models.mock_vision import default_model_registry
from app.models.registry import ModelRegistry
from app.orchestration.orchestrator import AIOrchestrator
from app.rag.vector_store import JsonVectorStore
from app.routing.capabilities import default_capabilities
from app.schemas.case import CaseCreate
from app.schemas.enums import (
    AnatomicalRegion,
    JobStatus,
    Modality,
    PipelineOutcome,
    Species,
)
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings, load_settings, validate_security_settings

_FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "integration"


def _mem_settings(tmp_path: Path, **overrides) -> Settings:
    base = load_settings()
    data = {
        **base.__dict__,
        "storage_backend": "memory",
        "sqlite_path": tmp_path / "unused.sqlite3",
        "quarantine_root": tmp_path / "q",
        "rag_index_path": tmp_path / "rag.json",
        "analyze_gate_path": tmp_path / "gate.count",
        "audit_log_path": None,
        "feedback_log_path": None,
        "demo_seed": False,
        "auth_enabled": False,
        "deployment_mode": "demo",
        "allow_insecure_demo": True,
        "malware_scan_required": False,
        "encryption_at_rest": "none",
        "vision_endpoint": None,
        "llm_provider": "mock",
    }
    data.update(overrides)
    return Settings(**data)


def test_integration_fixtures_parse() -> None:
    for name in (
        "vision_request.example.json",
        "vision_response.example.json",
        "llm_request.example.json",
        "llm_response.example.json",
    ):
        path = _FIXTURES / name
        assert path.is_file(), path
        data = json.loads(path.read_text(encoding="utf-8"))
        assert isinstance(data, dict)


def test_encryption_unimplemented_refuses_startup(tmp_path: Path) -> None:
    settings = _mem_settings(tmp_path, encryption_at_rest="fernet")
    with pytest.raises(RuntimeError, match="not implemented"):
        validate_security_settings(settings)


def test_health_mode_reflects_llm_and_vision(tmp_path: Path) -> None:
    settings = _mem_settings(
        tmp_path,
        llm_provider="http",
        llm_endpoint="http://127.0.0.1:9/draft",
        llm_model_id="generic-http-llm",
        vision_endpoint="http://127.0.0.1:8090/infer",
        vision_modalities=("MR",),
        vision_regions=("BRAIN",),
        vision_species=("canine", "feline"),
    )
    app = create_app(AppContainer(repo=InMemoryCaseRepository(), settings=settings))
    client = TestClient(app)
    body = client.get("/api/v1/health").json()
    assert body["mode"] == "configured"
    assert body["llm_provider"] == "http"
    assert body["vision_endpoint"] is True

    settings2 = _mem_settings(tmp_path / "b", llm_provider="mock", vision_endpoint=None)
    app2 = create_app(AppContainer(repo=InMemoryCaseRepository(), settings=settings2))
    assert TestClient(app2).get("/api/v1/health").json()["mode"] == "mock"


def test_rag_bulk_ingest_approved_default_false(tmp_path: Path) -> None:
    store = JsonVectorStore(path=tmp_path / "idx.json")
    store.load()
    before = len(store)
    added = store.add_documents_bulk(
        [
            {
                "title": "Bulk A",
                "section": "S",
                "passage": "Educational passage one.",
                "keywords": ["disk"],
            },
            {
                "title": "Bulk B",
                "passage": "Educational passage two.",
                "approved": True,
            },
        ],
        default_approved=False,
    )
    assert len(added) == 2
    assert added[0].approved is False
    assert added[1].approved is True
    assert len(store) == before + 2
    assert added[0].source_id.startswith("custom-")


def test_rag_bulk_api(tmp_path: Path) -> None:
    settings = _mem_settings(tmp_path, rag_backend="embedding")
    app = create_app(AppContainer(repo=InMemoryCaseRepository(), settings=settings))
    client = TestClient(app)
    res = client.post(
        "/api/v1/rag/documents/bulk",
        json={
            "documents": [
                {
                    "title": "API Bulk",
                    "section": "Neuro",
                    "passage": "Bulk via API.",
                    "keywords": ["ivdd"],
                }
            ]
        },
    )
    assert res.status_code == 201
    body = res.json()
    assert body["added"] == 1
    assert body["source_ids"]


def test_cancel_after_llm_discards_draft(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _mem_settings(tmp_path)
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    case = container.cases.create_case(
        CaseCreate(
            patient_name="Pax",
            species=Species.CANINE,
            modality=Modality.MR,
            anatomical_region=AnatomicalRegion.BRAIN,
        )
    )
    flags = {"cancel": False}
    original_generate = container.orchestrator._llm.generate_draft

    def generate_and_arm_cancel(c, f):  # noqa: ANN001
        report = original_generate(c, f)
        flags["cancel"] = True
        return report

    monkeypatch.setattr(container.orchestrator._llm, "generate_draft", generate_and_arm_cancel)
    result = container.orchestrator.run(
        case,
        AIOrchestrator.new_job(case.case_id),
        cancel_probe=lambda: flags["cancel"],
    )
    assert result.outcome == PipelineOutcome.FAILED
    assert result.job.status == JobStatus.CANCELLED
    assert result.report is None
    assert "LLM" in (result.job.error_message or "")


def test_readiness_remaining_steps_aligned() -> None:
    view = ModelRegistry(
        capabilities=default_capabilities(),
        adapters=default_model_registry(),
    )
    steps = view.readiness_payload()["remaining_steps_to_first_real_model"]
    assert len(steps) == 8
    assert any("consent" in s.lower() or "imaging_analysis_consent" in s for s in steps)
