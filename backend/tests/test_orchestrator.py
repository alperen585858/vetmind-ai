from app.container import AppContainer
from app.schemas.case import CaseRecord
from app.schemas.enums import (
    AnatomicalRegion,
    CaseLifecycleStatus,
    MockScenario,
    Modality,
    PipelineOutcome,
    Species,
)
from app.services.repository import InMemoryCaseRepository


def _run(scenario: MockScenario, **kwargs):
    container = AppContainer(repo=InMemoryCaseRepository())
    case = CaseRecord(
        case_id="case-1",
        patient_name="Pax",
        species=Species.CANINE,
        modality=kwargs.get("modality", Modality.MR),
        anatomical_region=kwargs.get("region", AnatomicalRegion.BRAIN),
        scenario=scenario,
    )
    job = container.orchestrator.new_job(case.case_id)
    return container.orchestrator.run(case, job), case


def test_brain_pipeline_success() -> None:
    result, case = _run(MockScenario.BRAIN_MRI_SUSPECTED)
    assert result.outcome == PipelineOutcome.SUCCESS
    assert result.findings is not None
    assert result.report is not None
    assert result.findings.findings[0].finding_code == "MOCK-BRAIN-MASS-EFFECT"
    assert case.status == CaseLifecycleStatus.AWAITING_REVIEW
    assert result.report.synthetic is True


def test_unsupported_case_outcome() -> None:
    result, case = _run(MockScenario.UNSUPPORTED)
    assert result.outcome == PipelineOutcome.UNSUPPORTED
    assert case.status == CaseLifecycleStatus.MANUAL_REVIEW
    assert result.findings is not None
    assert result.findings.execution_status.value == "unsupported"
    assert result.report is None
    assert case.draft_report is None


def test_model_failure_outcome() -> None:
    result, case = _run(MockScenario.MODEL_FAILURE)
    assert result.outcome == PipelineOutcome.FAILED
    assert result.job.status.value == "failed"
    assert case.status == CaseLifecycleStatus.FAILED
    assert result.findings is None


def test_conflicting_outputs_are_preserved() -> None:
    result, _case = _run(MockScenario.CONFLICTING)
    assert result.outcome == PipelineOutcome.SUCCESS
    codes = {f.finding_code for f in result.findings.findings}  # type: ignore[union-attr]
    assert "MOCK-BRAIN-MASS-EFFECT" in codes
    assert "MOCK-BRAIN-NO-MASS-EFFECT" in codes


def test_ct_brain_is_unsupported_without_registry_entry() -> None:
    result, case = _run(MockScenario.BRAIN_MRI_SUSPECTED, modality=Modality.CT)
    assert result.outcome == PipelineOutcome.UNSUPPORTED
    assert case.status == CaseLifecycleStatus.MANUAL_REVIEW
