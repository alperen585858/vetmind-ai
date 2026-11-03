"""Tests use empty, in-memory structural objects, never a clinical case dataset."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from evaluation.adapters.handoff import assess_pipeline_handoff, HandoffAssessment

BACKEND = Path(__file__).resolve().parents[2] / "backend"
if not BACKEND.is_dir():
    pytest.skip("VetMind backend not present for handoff tests", allow_module_level=True)
sys.path.insert(0, str(BACKEND))

from app.schemas.enums import (  # noqa: E402
    AnatomicalRegion, ExpertReviewStatus, Modality,
    ModelExecutionStatus, ReportStatus, SourceKind, Species,
)
from app.schemas.findings import StructuredFindings, Finding  # noqa: E402
from app.schemas.model_outputs import (  # noqa: E402
    BoundingBox2D, DetectionOutput, ModelTaskOutputs,
)
from app.schemas.report import (  # noqa: E402
    DraftReport, GenerationMetadata, ReportSection,
)


def make_vision(**overrides: object) -> ModelTaskOutputs:
    fields = dict(
        model_id="contract-test-model", model_version="0.0.0",
        case_id="contract-only", execution_status=ModelExecutionStatus.SUCCESS,
        source_kind=SourceKind.MOCK,
    )
    fields.update(overrides)
    return ModelTaskOutputs(**fields)


def make_findings(**overrides: object) -> StructuredFindings:
    fields = dict(
        case_id="contract-only", species=Species.CANINE, modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        source_model_id="contract-test-model", source_model_version="0.0.0",
        source_kind=SourceKind.MOCK, execution_status=ModelExecutionStatus.SUCCESS,
        no_findings_returned=True,
    )
    fields.update(overrides)
    return StructuredFindings(**fields)


def make_report(**overrides: object) -> DraftReport:
    empty = ReportSection(text="")
    fields = dict(
        case_id="contract-only", report_id="contract-test-report",
        generation=GenerationMetadata(
            provider_id="test-provider", model_id="test-llm", model_version="0.0.0"
        ),
        technique=empty, findings=empty, impression=empty,
        recommendations=empty,
    )
    fields.update(overrides)
    return DraftReport(**fields)


def codes(result: HandoffAssessment) -> set[str]:
    return {issue.code for issue in result.issues}


def test_no_stage_is_not_evaluated() -> None:
    result = assess_pipeline_handoff()
    assert result.status == "not_evaluated"
    assert result.stages_present == ()
    assert result.checks_executed == 0
    assert result.clinical_metrics is None


def test_one_stage_not_sufficient() -> None:
    result = assess_pipeline_handoff(vision=make_vision())
    assert result.status == "not_evaluated"
    assert result.checks_executed == 2


def test_two_consistent_stages() -> None:
    result = assess_pipeline_handoff(vision=make_vision(), findings=make_findings())
    assert result.status == "consistent"
    assert result.issues == ()
    assert result.clinical_status == "not_evaluated"


def test_three_stages_with_pending_report() -> None:
    result = assess_pipeline_handoff(
        vision=make_vision(), findings=make_findings(), report=make_report()
    )
    assert result.status == "consistent"
    assert "report.not_expert_approved" in codes(result)
    assert result.official_report_template_status == "not_evaluated"


@pytest.mark.parametrize("wrong_stage", ["vision", "findings", "report"])
def test_wrong_case_is_blocked_and_case_id_is_not_exported(wrong_stage: str) -> None:
    v, f, r = make_vision(), make_findings(), make_report()
    if wrong_stage == "vision":
        v = make_vision(case_id="secret-patient-identifier")
    elif wrong_stage == "findings":
        f = make_findings(case_id="secret-patient-identifier")
    else:
        r = make_report(case_id="secret-patient-identifier")
    result = assess_pipeline_handoff(vision=v, findings=f, report=r)
    assert result.status == "blocked"
    assert "case.mismatch" in codes(result)
    assert "secret-patient-identifier" not in result.model_dump_json()


@pytest.mark.parametrize("stage", ["vision", "findings", "report"])
def test_unknown_schema_version_blocks(stage: str) -> None:
    v, f, r = make_vision(), make_findings(), make_report()
    if stage == "vision":
        v = make_vision(schema_version="9.0.0")
    elif stage == "findings":
        f = make_findings(schema_version="9.0.0")
    else:
        r = make_report(schema_version="9.0.0")
    result = assess_pipeline_handoff(vision=v, findings=f, report=r)
    assert result.status == "blocked"
    assert "schema.unsupported" in codes(result)


def test_unlinked_model_failure_does_not_block_aggregated_success() -> None:
    """A failed adapter cannot invalidate an unrelated model's successful output."""
    result = assess_pipeline_handoff(
        vision=make_vision(model_id="a-different-model", execution_status=ModelExecutionStatus.FAILED),
        findings=make_findings(source_model_id="aggregate", contributing_model_ids=["another-model"]),
    )
    assert result.status == "consistent"
    assert "vision.unlinked_model" in codes(result)
    assert "execution.contradiction" not in codes(result)


def test_partial_status_difference_is_warning() -> None:
    result = assess_pipeline_handoff(
        vision=make_vision(execution_status=ModelExecutionStatus.PARTIAL),
        findings=make_findings(execution_status=ModelExecutionStatus.SUCCESS),
    )
    assert result.status == "warnings"
    assert "execution.different_status" in codes(result)


def test_failed_vision_success_findings_is_error() -> None:
    result = assess_pipeline_handoff(
        vision=make_vision(execution_status=ModelExecutionStatus.FAILED),
        findings=make_findings(execution_status=ModelExecutionStatus.SUCCESS),
    )
    assert result.status == "blocked"
    assert "execution.contradiction" in codes(result)


def test_mixed_source_is_not_an_error() -> None:
    result = assess_pipeline_handoff(
        vision=make_vision(source_kind=SourceKind.MOCK),
        findings=make_findings(source_kind=SourceKind.MIXED),
    )
    assert result.status == "consistent"
    assert "provenance.different_source_kind" not in codes(result)


def test_different_nonmixed_source_warns() -> None:
    result = assess_pipeline_handoff(
        vision=make_vision(source_kind=SourceKind.REAL),
        findings=make_findings(source_kind=SourceKind.MOCK),
    )
    assert result.status == "warnings"
    assert "provenance.different_source_kind" in codes(result)


def test_fixed_detection_box_warns_even_without_images() -> None:
    result = assess_pipeline_handoff(
        vision=make_vision(detection=DetectionOutput(
            computed_from_input=False,
            boxes=[BoundingBox2D(x_min=0, y_min=0, x_max=1, y_max=1)]
        )),
        findings=make_findings(),
    )
    assert "vision.fixed_detection_boxes" in codes(result)
    assert result.clinical_metrics is None


def test_findings_empty_flag_conflict() -> None:
    sample = Finding(
        finding_id="f1", finding_code="test_code", description="nonclinical",
        anatomical_location="test_location", finding_status="uncertain",
        source_model="test_model",
    )
    result = assess_pipeline_handoff(
        vision=make_vision(),
        findings=make_findings(findings=[sample], no_findings_returned=True),
    )
    assert result.status == "blocked"
    assert "findings.empty_flag_conflict" in codes(result)


def test_missing_no_findings_flag_is_information_not_negative_label() -> None:
    result = assess_pipeline_handoff(
        vision=make_vision(), findings=make_findings(no_findings_returned=False)
    )
    assert result.status == "consistent"
    assert "findings.empty_flag_missing" in codes(result)


def test_report_approved_without_expert_approval_is_blocked() -> None:
    result = assess_pipeline_handoff(
        findings=make_findings(), report=make_report(status=ReportStatus.APPROVED)
    )
    assert result.status == "blocked"
    assert "report.approval_contradiction" in codes(result)


def test_report_approved_but_mutable_warns() -> None:
    result = assess_pipeline_handoff(
        findings=make_findings(),
        report=make_report(
            status=ReportStatus.APPROVED,
            expert_review_status=ExpertReviewStatus.APPROVED,
            immutable=False,
        ),
    )
    assert result.status == "warnings"
    assert "report.approved_but_mutable" in codes(result)


def test_report_synthetic_flag_disagreement_warns() -> None:
    result = assess_pipeline_handoff(
        findings=make_findings(), report=make_report(synthetic=False)
    )
    assert result.status == "warnings"
    assert "report.synthetic_flag_disagreement" in codes(result)


def test_reject_unrecognized_input_without_echo() -> None:
    with pytest.raises(TypeError, match="must be an instantiated VetMind"):
        assess_pipeline_handoff(report={"case_id": "secret"})  # type: ignore[arg-type]


def test_output_schema_denies_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        HandoffAssessment(status="consistent", stages_present=(), checks_executed=0, secret="abc")


def test_no_13_section_claim() -> None:
    result = assess_pipeline_handoff(findings=make_findings(), report=make_report())
    assert result.official_report_template_status == "not_evaluated"
    assert result.clinical_metrics is None
    assert "case_id" not in result.model_dump_json()
