"""Non-clinical data integrity checks for evaluation manifests and records.

No PII-bearing case objects are written to logs or included in issue messages.
The results establish only that incoming metadata is internally consistent.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from enum import Enum
from typing import Iterable, Literal, Sequence

from pydantic import BaseModel, ConfigDict, Field

from evaluation.contracts import EvaluationManifest, EvaluationRecord
from evaluation.versioning import check_contract


class IssueSeverity(str, Enum):
    ERROR = "error"
    WARNING = "warning"
    INFORMATION = "information"


class ValidationIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")
    severity: IssueSeverity
    code: str = Field(min_length=1)
    path: str = Field(min_length=1)
    message: str = Field(min_length=1)


class IntegrityReport(BaseModel):
    """Input readiness. Not a clinical performance or safety certificate."""

    model_config = ConfigDict(extra="forbid")
    status: Literal["valid", "valid_with_warnings", "invalid"]
    record_count: int = Field(ge=0)
    issues: list[ValidationIssue] = Field(default_factory=list)
    clinical_metrics: None = None

    @property
    def valid(self) -> bool:
        return self.status != "invalid"


@dataclass(frozen=True)
class IntegrityPolicy:
    require_cases_for_batch: bool = False
    require_complete_execution: bool = False
    require_kranium_neuro_scope: bool = False
    max_records: int = 100_000

    def __post_init__(self) -> None:
        if type(self.max_records) is not int or self.max_records < 1:
            raise ValueError("max_records must be a positive integer")


def _issue(
    severity: IssueSeverity, code: str, path: str, message: str
) -> ValidationIssue:
    return ValidationIssue(severity=severity, code=code, path=path, message=message)


def validate_inputs(
    manifest: EvaluationManifest,
    records: Sequence[EvaluationRecord],
    *,
    policy: IntegrityPolicy | None = None,
) -> IntegrityReport:
    """Validate provenance, uniqueness, version compatibility and scope.

    Records are assumed to have already passed their Pydantic structural
    validation. A successful result does *not* establish expert verification.
    No TNs, absent findings, clinical metrics or patient-level inferences are
    derived here. Empty records are allowed unless policy explicitly forbids.
    """
    current_policy = policy or IntegrityPolicy()
    issues: list[ValidationIssue] = []

    if len(records) > current_policy.max_records:
        issues.append(_issue(IssueSeverity.ERROR, "batch.limit", "records",
                             "Record limit exceeded"))
    if not records:
        issues.append(_issue(
            IssueSeverity.ERROR if current_policy.require_cases_for_batch
            else IssueSeverity.INFORMATION,
            "batch.empty", "records", "No evaluation records supplied",
        ))

    check = check_contract("evaluation_manifest", manifest.schema_version)
    if not check.supported:
        issues.append(_issue(IssueSeverity.ERROR, "schema.manifest_unsupported",
                             "manifest.schema_version", "Manifest version is unsupported"))

    case_counts = Counter(record.case_id for record in records)
    for index, record in enumerate(records):
        prefix = f"records[{index}]"
        if case_counts[record.case_id] > 1:
            issues.append(_issue(IssueSeverity.ERROR, "record.duplicate_case_id",
                                 f"{prefix}.case_id", "Duplicate case ID in batch"))
        if not check_contract("evaluation_record", record.schema_version).supported:
            issues.append(_issue(IssueSeverity.ERROR, "schema.record_unsupported",
                                 f"{prefix}.schema_version", "Record schema version is unsupported"))
        if record.expert_verified and manifest.reference_status != "expert_verified":
            issues.append(_issue(IssueSeverity.ERROR, "reference.manifest_mismatch",
                                 f"{prefix}.expert_verified",
                                 "Record claims expert verification but manifest does not"))
        if manifest.reference_status == "expert_verified" and not record.expert_verified:
            issues.append(_issue(IssueSeverity.WARNING, "reference.record_unverified",
                                 f"{prefix}.expert_verified",
                                 "Manifest declares verified references, but record is unverified"))
        if record.expert_verified and record.source_kind == "mixed":
            issues.append(_issue(IssueSeverity.WARNING, "reference.mixed_provenance",
                                 f"{prefix}.source_kind",
                                 "Mixed provenance requires additional audit"))
        if record.source_kind == "mock":
            issues.append(_issue(IssueSeverity.INFORMATION, "source.mock",
                                 f"{prefix}.source_kind",
                                 "Mock source must not be reported as clinical evidence"))
        if record.execution_status in {"failed", "unsupported"} and record.findings:
            issues.append(_issue(IssueSeverity.ERROR, "record.failed_has_findings",
                                 f"{prefix}.findings",
                                 "Failed/unsupported execution cannot be scored as completed findings"))
        if current_policy.require_complete_execution and record.execution_status != "success":
            issues.append(_issue(IssueSeverity.ERROR, "execution.incomplete",
                                 f"{prefix}.execution_status",
                                 "Policy requires successful execution"))
        if record.anatomical_region in {"THORAX", "OTHER", "UNKNOWN"}:
            severity = (IssueSeverity.ERROR if current_policy.require_kranium_neuro_scope
                        else IssueSeverity.WARNING)
            issues.append(_issue(severity, "scope.outside_priority",
                                 f"{prefix}.anatomical_region",
                                 "Case is not confirmed as cranial/neurologic priority scope"))
        if record.source_kind == "manual" and manifest.model_id != "unassigned":
            issues.append(_issue(IssueSeverity.WARNING, "source.manual_model",
                                 f"{prefix}.source_kind",
                                 "Manual output should be attributed separately from AI output"))
        for j, finding in enumerate(record.findings):
            if finding.confidence is None:
                issues.append(_issue(IssueSeverity.INFORMATION,
                                     "finding.confidence_unavailable",
                                     f"{prefix}.findings[{j}].confidence",
                                     "Missing model confidence cannot be replaced with a default"))
    if any(item.severity is IssueSeverity.ERROR for item in issues):
        status = "invalid"
    elif any(item.severity is IssueSeverity.WARNING for item in issues):
        status = "valid_with_warnings"
    else:
        status = "valid"
    return IntegrityReport(status=status, record_count=len(records), issues=issues)


def validate_records_stream(
    manifest: EvaluationManifest,
    records: Iterable[EvaluationRecord],
    *,
    policy: IntegrityPolicy | None = None,
) -> IntegrityReport:
    """Bound an input iterable before materialization; no unbounded streaming."""
    active = policy or IntegrityPolicy()
    collected: list[EvaluationRecord] = []
    for record in records:
        if len(collected) >= active.max_records:
            return IntegrityReport(status="invalid", record_count=len(collected), issues=[
                _issue(IssueSeverity.ERROR, "batch.limit", "records",
                       "Record limit exceeded")
            ])
        collected.append(record)
    return validate_inputs(manifest, collected, policy=active)
