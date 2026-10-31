"""Imaging interface, routing, fusion, and LLM substitution regressions."""

from app.container import AppContainer
from app.llm.gateway import LLMGateway
from app.llm.mock_provider import MockLLMProvider
from app.llm.stub_provider import DeterministicStubLLMProvider, STUB_BANNER
from app.models.interfaces import ImagingAdapterError, ImagingModel
from app.models.mock_vision import MockBrainMriAltModel, MockBrainMriModel, MockVisionError, default_model_registry
from app.models.normalizer import detect_potential_conflicts, normalize_outputs
from app.orchestration.orchestrator import AIOrchestrator
from app.routing.capabilities import ModelCapability, default_capabilities
from app.routing.model_router import ModelRouter
from app.routing.scenario_policy import ScenarioRoutingPolicy
from app.schemas.case import CaseRecord
from app.schemas.enums import (
    AnatomicalRegion,
    CaseLifecycleStatus,
    FindingStatus,
    MockScenario,
    Modality,
    ModelExecutionStatus,
    PipelineOutcome,
    SourceKind,
    Species,
)
from app.schemas.findings import Finding, StructuredFindings
from app.services.repository import InMemoryCaseRepository
from app.validation.report_validator import ReportValidator


def _case(**kwargs) -> CaseRecord:
    base = dict(
        case_id="case-2a",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        scenario=MockScenario.BRAIN_MRI_SUSPECTED,
    )
    base.update(kwargs)
    return CaseRecord(**base)


class _NonMockImagingAdapter:
    """Minimal non-mock ImagingModel for registry/orchestrator compatibility tests."""

    model_id = "test-nonmock-brain-v1"
    version = "9.9.9"

    def analyze(self, case: CaseRecord) -> StructuredFindings:
        return StructuredFindings(
            case_id=case.case_id,
            study=case.study,
            species=case.species,
            modality=case.modality,
            anatomical_region=case.anatomical_region,
            source_model_id=self.model_id,
            source_model_version=self.version,
            source_kind=SourceKind.REAL,
            execution_status=ModelExecutionStatus.SUCCESS,
            findings=[
                Finding(
                    finding_id=f"{case.case_id}-nm-1",
                    finding_code="TEST-NONMOCK-FINDING",
                    description="Non-mock test adapter finding (not a clinical result).",
                    anatomical_location="beyin / olfaktör bulbus bölgesi",
                    finding_status=FindingStatus.POSSIBLE,
                    source_model=self.model_id,
                    source_model_version=self.version,
                    synthetic=False,
                )
            ],
            contributing_model_ids=[self.model_id],
            contributing_source_kinds=[SourceKind.REAL],
            warnings=[],
        )


class _FailingAdapter:
    model_id = "test-failing-v1"
    version = "0.0.1"

    def analyze(self, case: CaseRecord) -> StructuredFindings:
        raise ImagingAdapterError("Deterministic non-mock adapter failure.")


def test_non_mock_imaging_adapter_protocol_and_registry() -> None:
    adapter: ImagingModel = _NonMockImagingAdapter()
    assert isinstance(adapter, ImagingModel)
    registry: dict[str, ImagingModel] = default_model_registry()
    registry[adapter.model_id] = adapter
    assert adapter.model_id in registry
    out = registry[adapter.model_id].analyze(_case())
    assert out.source_kind == SourceKind.REAL
    assert out.findings[0].source_model_version == "9.9.9"


def test_strongly_typed_registry_in_orchestrator() -> None:
    adapter = _NonMockImagingAdapter()
    caps = [
        ModelCapability(
            model_id=adapter.model_id,
            modalities=frozenset({Modality.MR}),
            regions=frozenset({AnatomicalRegion.BRAIN}),
            species=frozenset({Species.CANINE}),
            priority=1,
        )
    ]
    orch = AIOrchestrator(
        router=ModelRouter(capabilities=caps),
        model_registry={adapter.model_id: adapter},
        llm_gateway=LLMGateway(MockLLMProvider()),
        validator=ReportValidator(),
        scenario_policy=ScenarioRoutingPolicy(),
    )
    case = _case(scenario=None)
    result = orch.run(case, AIOrchestrator.new_job(case.case_id))
    assert result.outcome == PipelineOutcome.SUCCESS
    assert result.findings is not None
    assert result.findings.source_kind == SourceKind.REAL
    assert result.findings.findings[0].finding_code == "TEST-NONMOCK-FINDING"


def test_mock_scenario_independence_from_router() -> None:
    router = ModelRouter()
    for scenario in MockScenario:
        d = router.route(_case(scenario=scenario))
        assert d.rule_id is None or not d.rule_id.startswith("scenario.")


def test_multi_model_findings_preservation() -> None:
    case = _case(scenario=MockScenario.CONFLICTING)
    a = MockBrainMriModel().analyze(case)
    b = MockBrainMriAltModel().analyze(case)
    merged = normalize_outputs([a, b])
    assert len(merged.findings) == 2
    assert {f.source_model for f in merged.findings} == {
        "mock-brain-mri-v1",
        "mock-brain-mri-alt-v1",
    }
    assert all(f.source_model_version == "0.1.0" for f in merged.findings)
    assert merged.findings[0].evidence_references or merged.findings[1].evidence_references


def test_generic_conflict_detection() -> None:
    findings = [
        Finding(
            finding_id="a",
            finding_code="CODE-A",
            description="A",
            anatomical_location="Brain / Olfactory Bulb Region",
            finding_status=FindingStatus.SUSPECTED,
            source_model="model-a",
            source_model_version="1",
        ),
        Finding(
            finding_id="b",
            finding_code="CODE-B",
            description="B",
            anatomical_location="brain / olfactory bulb region",
            finding_status=FindingStatus.UNCERTAIN,
            source_model="model-b",
            source_model_version="1",
        ),
    ]
    conflicts = detect_potential_conflicts(findings)
    assert len(conflicts) == 1
    assert set(conflicts[0].finding_ids) == {"a", "b"}
    assert findings[0].conflict_group_id == conflicts[0].conflict_id


def test_mixed_provenance_phase2a() -> None:
    mock = MockBrainMriModel().analyze(_case())
    real = _NonMockImagingAdapter().analyze(_case())
    merged = normalize_outputs([mock, real])
    assert merged.source_kind == SourceKind.MIXED
    assert set(merged.contributing_source_kinds) == {SourceKind.MOCK, SourceKind.REAL}
    assert len(merged.potential_conflicts) >= 1


def test_partial_adapter_failure() -> None:
    good = MockBrainMriModel()
    bad = _FailingAdapter()
    caps = [
        ModelCapability(
            model_id=good.model_id,
            modalities=frozenset({Modality.MR}),
            regions=frozenset({AnatomicalRegion.BRAIN}),
            priority=1,
        ),
        ModelCapability(
            model_id=bad.model_id,
            modalities=frozenset({Modality.MR}),
            regions=frozenset({AnatomicalRegion.BRAIN}),
            priority=2,
        ),
    ]
    orch = AIOrchestrator(
        router=ModelRouter(capabilities=caps),
        model_registry={good.model_id: good, bad.model_id: bad},
        llm_gateway=LLMGateway(MockLLMProvider()),
        validator=ReportValidator(),
    )
    case = _case(scenario=None)
    result = orch.run(case, AIOrchestrator.new_job(case.case_id))
    assert result.outcome == PipelineOutcome.PARTIAL
    assert result.findings is not None
    assert result.report is not None
    assert result.job.error_message
    assert "Deterministic non-mock adapter failure" in (result.job.error_message or "")


def test_llm_provider_substitution() -> None:
    case = _case()
    findings = MockBrainMriModel().analyze(case)
    gateway = LLMGateway(MockLLMProvider())
    mock_report = gateway.generate_draft(case, findings)
    assert mock_report.generation.provider_id == "mock-llm"

    gateway.set_provider(DeterministicStubLLMProvider())
    stub_report = gateway.generate_draft(case, findings)
    assert stub_report.generation.provider_id == "stub-llm"
    assert stub_report.generation.model_id == "deterministic-stub-report-v1"
    assert STUB_BANNER in stub_report.findings.text
    assert stub_report.report_id != mock_report.report_id


def test_mock_vision_error_is_imaging_adapter_error() -> None:
    assert issubclass(MockVisionError, ImagingAdapterError)
    with __import__("pytest").raises(ImagingAdapterError):
        MockBrainMriModel().analyze(_case(scenario=MockScenario.MODEL_FAILURE))


def test_end_to_end_conflicting_via_scenario_policy() -> None:
    container = AppContainer(repo=InMemoryCaseRepository())
    case = _case(scenario=MockScenario.CONFLICTING)
    result = container.orchestrator.run(case, AIOrchestrator.new_job(case.case_id))
    assert result.outcome == PipelineOutcome.SUCCESS
    assert len(result.findings.findings) == 2  # type: ignore[union-attr]
    assert result.findings.potential_conflicts  # type: ignore[union-attr]
    assert case.status == CaseLifecycleStatus.AWAITING_REVIEW


def test_default_capabilities_do_not_include_alt_brain() -> None:
    ids = {c.model_id for c in default_capabilities()}
    assert "mock-brain-mri-v1" in ids
    assert "mock-brain-mri-alt-v1" not in ids
