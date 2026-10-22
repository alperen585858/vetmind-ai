"""F12: safe LLM generation DTO and typed provider failures."""

from pathlib import Path

import pytest

from app.container import AppContainer
from app.llm.gateway import LLMGateway, build_generation_input
from app.llm.interfaces import (
    LLMErrorKind,
    LLMGenerationInput,
    LLMProviderError,
    LLMRequest,
    LLMResponse,
    LLMTimeoutError,
    LLMUnavailableError,
)
from app.llm.mock_provider import MockLLMProvider
from app.models.mock_vision import MockBrainMriModel
from app.orchestration.orchestrator import AIOrchestrator
from app.schemas.case import CaseRecord
from app.schemas.documents import CaseDocumentContext, ExtractedDocument
from app.schemas.enums import (
    AnatomicalRegion,
    CaseLifecycleStatus,
    FileContentKind,
    MockScenario,
    Modality,
    PipelineOutcome,
    Species,
)
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


def _case(**kwargs) -> CaseRecord:
    data = dict(
        case_id="case-safe",
        patient_name="Secret Patient Name",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        scenario=MockScenario.BRAIN_MRI_SUSPECTED,
        clinical_history="Seizures",
        quarantine_dir="/var/quarantine/secret-case",
        referring_clinic="Hidden Clinic",
        document_context=CaseDocumentContext(
            document_ingest_id="ingest-docs-1",
            documents=[
                ExtractedDocument(
                    filename="note.pdf",
                    content_kind=FileContentKind.PDF,
                    quarantine_relative_path="docs/note.pdf",
                    extracted_text="draft text",
                    text_truncated=True,
                    char_count=10,
                )
            ],
            combined_text_preview="draft text",
        ),
    )
    data.update(kwargs)
    return CaseRecord(**data)


class _CapturingProvider:
    provider_id = "capture-llm"
    model_id = "capture-model"
    model_version = "0.0.1"
    last_request: LLMRequest | None = None
    last_payload: dict | None = None

    def generate(self, request: LLMRequest) -> LLMResponse:
        self.last_request = request
        self.last_payload = request.model_dump(mode="json")
        # Delegate to mock for a valid report shape using the same safe DTO.
        return MockLLMProvider().generate(request)


class _FailingProvider:
    provider_id = "fail-llm"
    model_id = "fail-model"
    model_version = "0.0.1"

    def __init__(self, exc: LLMProviderError) -> None:
        self._exc = exc

    def generate(self, request: LLMRequest) -> LLMResponse:
        raise self._exc


def test_generation_input_excludes_disallowed_fields() -> None:
    case = _case()
    findings = MockBrainMriModel().analyze(case)
    gen = build_generation_input(case, findings)
    payload = gen.model_dump(mode="json")
    blob = str(payload)
    assert "patient_name" not in payload
    assert "Secret Patient Name" not in blob
    assert "quarantine_dir" not in payload
    assert "/var/quarantine" not in blob
    assert "referring_clinic" not in payload
    assert "Hidden Clinic" not in blob
    assert "api_key" not in payload
    assert "Authorization" not in blob
    assert payload["case_id"] == "case-safe"
    assert payload["document_context_file_count"] == 1
    assert isinstance(gen, LLMGenerationInput)


def test_capturing_provider_outbound_payload_is_safe() -> None:
    case = _case()
    findings = MockBrainMriModel().analyze(case)
    capture = _CapturingProvider()
    report = LLMGateway(capture).generate_draft(case, findings)
    assert report is not None
    assert capture.last_payload is not None
    blob = str(capture.last_payload)
    assert "quarantine" not in blob.lower() or "document_context_file_count" in blob
    assert "/var/quarantine" not in blob
    assert "Secret Patient Name" not in blob
    assert "generation" in capture.last_payload
    assert "case" not in capture.last_payload
    assert capture.last_payload["generation"]["case_id"] == "case-safe"


def test_provider_timeout_no_approvable_draft() -> None:
    container = AppContainer(
        repo=InMemoryCaseRepository(),
        settings=Settings(
            storage_backend="memory",
            sqlite_path=Path("unused.sqlite3"),
            quarantine_root=Path("q"),
            async_analyze_delay_ms=0,
        ),
    )
    container.llm.set_provider(_FailingProvider(LLMTimeoutError()))
    case = _case()
    result = container.orchestrator.run(case, AIOrchestrator.new_job(case.case_id))
    assert result.outcome == PipelineOutcome.FAILED
    assert result.report is None
    assert case.draft_report is None
    assert case.structured_findings is not None
    assert case.status == CaseLifecycleStatus.FAILED
    assert result.job.error_message
    assert LLMErrorKind.TIMEOUT.value in (result.job.error_message or "")


def test_provider_unavailable_no_mock_fallback() -> None:
    from app.llm.gateway import LLMGateway as GW

    case = _case()
    findings = MockBrainMriModel().analyze(case)
    gateway = GW(_FailingProvider(LLMUnavailableError("down")))
    with pytest.raises(LLMUnavailableError):
        gateway.generate_draft(case, findings)


def test_orchestrator_typed_llm_failure_preserves_findings() -> None:
    orch = AppContainer(
        repo=InMemoryCaseRepository(),
        settings=Settings(
            storage_backend="memory",
            sqlite_path=Path("unused.sqlite3"),
            quarantine_root=Path("q"),
            async_analyze_delay_ms=0,
        ),
    ).orchestrator
    # Replace gateway provider after container build
    orch._llm.set_provider(  # noqa: SLF001 — test seam for typed failure path
        _FailingProvider(LLMProviderError("boom", kind=LLMErrorKind.MALFORMED_RESPONSE))
    )
    case = _case()
    result = orch.run(case, AIOrchestrator.new_job(case.case_id))
    assert result.outcome == PipelineOutcome.FAILED
    assert result.findings is not None
    assert result.report is None
    assert "malformed_response" in (result.job.error_message or "")
