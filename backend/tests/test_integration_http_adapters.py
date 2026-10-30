"""Stage B — HTTP adapter fixtures + orchestrator fail-closed integration."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from app.container import AppContainer
from app.llm.http_provider import HttpLLMProvider
from app.llm.interfaces import LLMFindingRef, LLMGenerationInput, LLMRequest
from app.models.http_vision import HttpRemoteVisionModel
from app.models.interfaces import ImagingAdapterError
from app.models.model_input_builder import build_imaging_model_input
from app.orchestration.orchestrator import AIOrchestrator
from app.schemas.case import CaseRecord
from app.schemas.rag import RagPassage
from app.schemas.enums import (
    AnatomicalRegion,
    JobStatus,
    Modality,
    ModelExecutionStatus,
    PipelineOutcome,
    SourceKind,
    Species,
)
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings

_FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "integration"


def _case() -> CaseRecord:
    case = CaseRecord(
        case_id="case-http-int",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        classification_confirmed=True,
    )
    case.model_input = build_imaging_model_input(case)
    return case


def _patch_httpx_client(monkeypatch: pytest.MonkeyPatch, transport: httpx.MockTransport) -> None:
    import app.models.http_vision as hv

    original = hv.httpx.Client

    class PatchedClient(original):  # type: ignore[misc,valid-type]
        def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(hv.httpx, "Client", PatchedClient)


def test_vision_fixture_response_maps_via_http_adapter() -> None:
    body = json.loads((_FIXTURES / "vision_response.example.json").read_text(encoding="utf-8"))
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=body))
    model = HttpRemoteVisionModel(model_id="remote-vision-v1", endpoint="http://vision.test/infer")
    import app.models.http_vision as hv

    original = hv.httpx.Client

    class PatchedClient(original):  # type: ignore[misc,valid-type]
        def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)

    hv.httpx.Client = PatchedClient  # type: ignore[assignment]
    try:
        out = model.analyze(_case())
    finally:
        hv.httpx.Client = original  # type: ignore[assignment]
    assert out.execution_status == ModelExecutionStatus.SUCCESS
    assert out.source_kind == SourceKind.REAL
    assert out.findings[0].finding_code == "EXAMPLE-MASS-EFFECT"


def test_vision_http_503_fail_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    transport = httpx.MockTransport(
        lambda request: httpx.Response(503, json={"error": "overloaded"})
    )
    _patch_httpx_client(monkeypatch, transport)
    model = HttpRemoteVisionModel(model_id="remote-vision-v1", endpoint="http://vision.test/infer")
    with pytest.raises(ImagingAdapterError, match="503"):
        model.analyze(_case())


def test_orchestrator_remote_vision_unavailable_no_fake_real_success(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=tmp_path / "unused.sqlite3",
        quarantine_root=tmp_path / "q",
        vision_endpoint="http://vision.test/infer",
        vision_model_id="remote-vision-v1",
        vision_modalities=("MR",),
        vision_regions=("BRAIN",),
        vision_species=("canine", "feline"),
        vision_execution_policy="exclusive_real",
        async_analyze_delay_ms=0,
    )
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    transport = httpx.MockTransport(
        lambda request: httpx.Response(503, json={"execution_status": "success", "findings": []})
    )
    _patch_httpx_client(monkeypatch, transport)

    case = CaseRecord(
        case_id="case-orch-fail",
        patient_name="P",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        classification_confirmed=True,
    )
    result = container.orchestrator.run(case, AIOrchestrator.new_job(case.case_id))
    assert result.outcome == PipelineOutcome.FAILED
    assert result.job.status in {JobStatus.FAILED, JobStatus.TIMED_OUT}
    assert result.report is None
    if result.findings is not None:
        assert result.findings.source_kind != SourceKind.REAL or not result.findings.findings


def test_llm_fixture_response_maps_via_http_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    wire = json.loads((_FIXTURES / "llm_response.example.json").read_text(encoding="utf-8"))

    class FakeClient:
        def __init__(self, *args, **kwargs):  # noqa: ANN002, ANN003
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):  # noqa: ANN002
            return False

        def post(self, *args, **kwargs):  # noqa: ANN002, ANN003
            return httpx.Response(200, json=wire)

    monkeypatch.setattr("app.llm.http_provider.httpx.Client", FakeClient)
    gen = LLMGenerationInput(
        case_id="case-http-int",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        findings=[
            LLMFindingRef(
                finding_id="f-1",
                finding_code="CODE",
                description="d",
                anatomical_location="brain",
                finding_status="suspected",
                source_model="remote",
            )
        ],
        findings_source_kind=SourceKind.REAL,
        findings_model_id="remote",
        findings_model_version="1",
        execution_status=ModelExecutionStatus.SUCCESS,
        no_findings_returned=False,
        rag_passages=[
            RagPassage(source_id="kb-1", title="T", section="s", passage="p", score=0.5)
        ],
    )
    report = HttpLLMProvider(endpoint="http://127.0.0.1:9/draft").generate(
        LLMRequest(generation=gen)
    ).report
    assert report.used_passage_ids == ["kb-1"]
    assert report.findings.cited_finding_ids == ["f-1"]
