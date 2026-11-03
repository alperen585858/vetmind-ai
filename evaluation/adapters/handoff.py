"""Read-only consistency checks for VetMind's Vision -> Findings -> Report handoff.

This module validates engineering invariants only, without reading pixel data,
creating synthetic cases, or making clinical accuracy claims. The response never
contains identifiers, report text, model warnings, or other clinical payloads.

The checks are deliberately conservative. A missing stage is not an error and
missing findings must never be interpreted as a confirmed negative diagnosis.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field

from evaluation.versioning import check_contract

if TYPE_CHECKING:
    from app.schemas.findings import StructuredFindings
    from app.schemas.model_outputs import ModelTaskOutputs
    from app.schemas.report import DraftReport

Stage = Literal["vision", "findings", "report"]
Severity = Literal["error", "warning", "information"]
HandoffStatus = Literal["not_evaluated", "consistent", "warnings", "blocked"]

# Fixed codes only: never include case IDs, text or raw validator exceptions.
IssueCode = Literal[
    "schema.unsupported",
    "case.mismatch",
    "execution.contradiction",
    "execution.different_status",
    "provenance.different_source_kind",
    "vision.fixed_detection_boxes",
    "vision.unlinked_model",
    "findings.empty_flag_conflict",
    "findings.empty_flag_missing",
    "report.approval_contradiction",
    "report.approved_but_mutable",
    "report.synthetic_flag_disagreement",
    "report.section_missing",
    "report.not_expert_approved",
]


class HandoffIssue(BaseModel):
    """Safe, predefined issue code without any clinical or identifying values."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    code: IssueCode
    severity: Severity
    stage: Stage


class HandoffAssessment(BaseModel):
    """Structural consistency only; no clinical or report-template scores."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    schema_version: Literal["1.0.0"] = "1.0.0"
    status: HandoffStatus
    stages_present: tuple[Stage, ...]
    checks_executed: int = Field(ge=0)
    issues: tuple[HandoffIssue, ...] = ()
    clinical_status: Literal["not_evaluated"] = "not_evaluated"
    clinical_metrics: None = None
    official_report_template_status: Literal["not_evaluated"] = "not_evaluated"


def _validate_stage(value: BaseModel | None, model_name: str, stage: Stage) -> None:
    """Reject arbitrary objects without echoing their possibly sensitive repr."""
    if value is None:
        return
    if not isinstance(value, BaseModel) or type(value).__name__ != model_name:
        raise TypeError(f"{stage} must be an instantiated VetMind {model_name} model")


def _enum_value(value: object) -> str:
    """Convert only defined enum/string values; no arbitrary log formatting."""
    raw = getattr(value, "value", value)
    if not isinstance(raw, str):
        raise TypeError("expected a string-valued enum")
    return raw


def assess_pipeline_handoff(
    *,
    vision: ModelTaskOutputs | None = None,
    findings: StructuredFindings | None = None,
    report: DraftReport | None = None,
) -> HandoffAssessment:
    """Check *available* pipeline stages without modifying or persisting inputs.

    No stages: not_evaluated. One stage: not_evaluated unless a structural
    contradiction is found. Two or three stages: compare the shared case link,
    supported schema versions and selected invariants. A passing assessment
    means structural consistency, NOT clinical validity, complete AI execution,
    or conformance with the future 13-section template.
    """
    _validate_stage(vision, "ModelTaskOutputs", "vision")
    _validate_stage(findings, "StructuredFindings", "findings")
    _validate_stage(report, "DraftReport", "report")

    present: tuple[Stage, ...] = tuple(
        name for name, value in (
            ("vision", vision), ("findings", findings), ("report", report)
        ) if value is not None
    )  # type: ignore[assignment]
    issues: list[HandoffIssue] = []
    checks = 0

    def record(code: IssueCode, severity: Severity, stage: Stage) -> None:
        issues.append(HandoffIssue(code=code, severity=severity, stage=stage))

    # Schema checks are performed even if only one stage exists.
    for stage, object_, contract in (
        ("vision", vision, "model_outputs"),
        ("findings", findings, "structured_findings"),
        ("report", report, "draft_report"),
    ):
        if object_ is not None:
            checks += 1
            if not check_contract(contract, object_.schema_version).supported:
                record("schema.unsupported", "error", stage)  # type: ignore[arg-type]

    # Compare all present case IDs, without exporting their actual values.
    if len(present) >= 2:
        checks += 1
        case_ids = [
            item.case_id for item in (vision, findings, report) if item is not None
        ]
        if len(set(case_ids)) != 1:
            record("case.mismatch", "error", "findings")

    if vision is not None:
        checks += 1
        if vision.detection is not None and not vision.detection.computed_from_input:
            record("vision.fixed_detection_boxes", "warning", "vision")

    if findings is not None:
        checks += 1
        if findings.findings and findings.no_findings_returned:
            record("findings.empty_flag_conflict", "error", "findings")
        elif not findings.findings and not findings.no_findings_returned:
            # Unknown/unreported != negative finding.
            record("findings.empty_flag_missing", "information", "findings")

    if vision is not None and findings is not None:
        # Multi-model aggregation is expected in VetMind. An unrelated Vision
        # adapter may fail while other contributing models succeed, so do NOT
        # compare their execution outcomes unless they share model lineage.
        checks += 1
        linked = (vision.model_id == findings.source_model_id
                  or vision.model_id in findings.contributing_model_ids)
        if not linked:
            record("vision.unlinked_model", "information", "vision")
        else:
            checks += 1
            vision_status = _enum_value(vision.execution_status)
            findings_status = _enum_value(findings.execution_status)
            if vision_status in ("failed", "unsupported") and findings_status == "success":
                record("execution.contradiction", "error", "findings")
            elif vision_status != findings_status:
                # Multi-model normalization can yield partial vs successful outcomes.
                record("execution.different_status", "warning", "findings")
            checks += 1
            vision_kind = _enum_value(vision.source_kind)
            findings_kind = _enum_value(findings.source_kind)
            if vision_kind != findings_kind and "mixed" not in (vision_kind, findings_kind):
                # Aggregators can change source kind; flag for review, not a hard failure.
                record("provenance.different_source_kind", "warning", "findings")

    if report is not None:
        checks += 1
        report_status = _enum_value(report.status)
        approval_status = _enum_value(report.expert_review_status)
        if report_status == "approved" and approval_status != "approved":
            record("report.approval_contradiction", "error", "report")
        elif report_status == "approved" and not report.immutable:
            record("report.approved_but_mutable", "warning", "report")
        if report_status != "approved":
            record("report.not_expert_approved", "information", "report")
        checks += 1
        if report.synthetic != report.generation.synthetic:
            record("report.synthetic_flag_disagreement", "warning", "report")
        checks += 1
        for section_name in ("technique", "findings", "impression", "recommendations"):
            section = getattr(report, section_name)
            if section is None or not isinstance(section.text, str):
                record("report.section_missing", "error", "report")
        # These are the four existing DraftReport fields, NOT a 13-item rubric.

    if any(item.severity == "error" for item in issues):
        status: HandoffStatus = "blocked"
    elif len(present) < 2:
        status = "not_evaluated"
    elif any(item.severity == "warning" for item in issues):
        status = "warnings"
    else:
        status = "consistent"

    return HandoffAssessment(
        status=status, stages_present=present, checks_executed=checks,
        issues=tuple(issues),
    )
