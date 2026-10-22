"""F11: configurable LLM provider selection (mock / stub / http)."""

from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.container import AppContainer
from app.llm.factory import build_llm_provider
from app.llm.http_provider import HttpLLMProvider
from app.llm.interfaces import LLMConfigError, LLMMalformedResponseError
from app.llm.mock_provider import MockLLMProvider
from app.llm.stub_provider import DeterministicStubLLMProvider, STUB_BANNER
from app.main import create_app
from app.models.mock_vision import MockBrainMriModel
from app.orchestration.orchestrator import AIOrchestrator
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, MockScenario, Modality, Species
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings
from tests.conftest import make_payload


def _settings(tmp_path: Path, **kwargs) -> Settings:
    base = dict(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        async_analyze_delay_ms=0,
        llm_provider="mock",
    )
    base.update(kwargs)
    return Settings(**base)


def _case() -> CaseRecord:
    return CaseRecord(
        case_id="case-llm",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        scenario=MockScenario.BRAIN_MRI_SUSPECTED,
    )


def test_default_provider_is_mock(tmp_path: Path) -> None:
    provider = build_llm_provider(_settings(tmp_path))
    assert isinstance(provider, MockLLMProvider)
    container = AppContainer(repo=InMemoryCaseRepository(), settings=_settings(tmp_path))
    assert container.llm.provider_id == "mock-llm"
    health = TestClient(create_app(container)).get("/api/v1/health").json()
    assert health["llm_provider"] == "mock"


def test_stub_provider_via_settings(tmp_path: Path) -> None:
    settings = _settings(tmp_path, llm_provider="stub")
    provider = build_llm_provider(settings)
    assert isinstance(provider, DeterministicStubLLMProvider)
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    case = _case()
    result = container.orchestrator.run(case, AIOrchestrator.new_job(case.case_id))
    assert result.report is not None
    assert result.report.generation.provider_id == "stub-llm"
    assert STUB_BANNER in result.report.findings.text


def test_http_provider_requires_endpoint(tmp_path: Path) -> None:
    with pytest.raises(LLMConfigError, match="llm_endpoint"):
        build_llm_provider(_settings(tmp_path, llm_provider="http", llm_endpoint=None))


def test_http_provider_no_network_at_startup(tmp_path: Path) -> None:
    # Construction must not contact the endpoint (unreachable port is fine).
    provider = build_llm_provider(
        _settings(
            tmp_path,
            llm_provider="http",
            llm_endpoint="http://127.0.0.1:9/llm",
            llm_provider_id="http-llm",
            llm_model_id="generic-http-llm",
            llm_model_version="0.1.0",
        )
    )
    assert isinstance(provider, HttpLLMProvider)
    assert provider.provider_id == "http-llm"


def test_http_provider_with_fake_local_transport() -> None:
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200,
            json={
                "technique": "HTTP technique draft",
                "findings": "HTTP findings draft",
                "impression": "HTTP impression draft",
                "recommendations": "Expert review required.",
                "cited_finding_ids": [],
            },
        )
    )
    provider = HttpLLMProvider(endpoint="http://llm.test/generate")
    original = httpx.Client

    class Patched(original):  # type: ignore[misc,valid-type]
        def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)

    import app.llm.http_provider as hp

    hp.httpx.Client = Patched  # type: ignore[assignment]
    try:
        from app.llm.gateway import LLMGateway

        case = _case()
        findings = MockBrainMriModel().analyze(case)
        report = LLMGateway(provider).generate_draft(case, findings)
    finally:
        hp.httpx.Client = original  # type: ignore[assignment]

    assert report.generation.provider_id == "http-llm"
    assert "HTTP findings draft" in report.findings.text
    assert report.clinically_validated is False


def test_http_malformed_response_rejected() -> None:
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"oops": True}))
    provider = HttpLLMProvider(endpoint="http://llm.test/generate")
    original = httpx.Client

    class Patched(original):  # type: ignore[misc,valid-type]
        def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)

    import app.llm.http_provider as hp

    hp.httpx.Client = Patched  # type: ignore[assignment]
    try:
        from app.llm.gateway import LLMGateway

        case = _case()
        findings = MockBrainMriModel().analyze(case)
        with pytest.raises(LLMMalformedResponseError):
            LLMGateway(provider).generate_draft(case, findings)
    finally:
        hp.httpx.Client = original  # type: ignore[assignment]


def test_mock_workflow_unchanged_via_api(client: TestClient) -> None:
    case_id = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json")).json()["case_id"]
    analyzed = client.post(f"/api/v1/cases/{case_id}/analyze").json()
    assert analyzed["outcome"] == "success"
    assert analyzed["report"]["generation"]["provider_id"] == "mock-llm"
