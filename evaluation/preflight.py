"""Compositional Evaluation Core preflight with conservative clinical gate semantics.

This checks structural contracts, declared provenance and software compatibility.
It NEVER computes clinical model accuracy, sensitivity, specificity, IoU against
experts or 13-section report quality. Every clinical score is None.
"""
from __future__ import annotations

from collections import Counter
from typing import Literal, Sequence

from pydantic import BaseModel, ConfigDict, Field

from evaluation.adapters.compatibility import check_backend_contracts
from evaluation.audit_ledger import AuditChain, build_preflight_audit
from evaluation.configuration import EvaluationConfiguration
from evaluation.contracts import EvaluationManifest, EvaluationRecord
from evaluation.integrity import validate_inputs
from evaluation.traceability import TraceReceipt, create_receipt


class PreflightIssueSummary(BaseModel):
    """Fixed-code issue summary without individual case IDs or patient text."""
    model_config = ConfigDict(extra="forbid", frozen=True)
    code: str = Field(min_length=1)
    severity: Literal["error", "warning", "information"]
    occurrences: int = Field(ge=1)


class PreflightReport(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    preflight_version: Literal["1.0.0"] = "1.0.0"
    structural_status: Literal["checks_passed", "warnings", "blocked"]
    integrity_status: Literal["valid", "valid_with_warnings", "invalid"]
    backend_contract_status: Literal["unchecked", "compatible", "incompatible", "unavailable"]
    clinical_status: Literal["not_evaluated"] = "not_evaluated"
    clinical_metrics: None = None
    missing_clinical_inputs: tuple[
        Literal["expert_reference", "image_series", "official_report_template"], ...
    ]
    issues: tuple[PreflightIssueSummary, ...]
    trace: TraceReceipt
    audit: AuditChain

    @property
    def structural_ok(self) -> bool:
        return self.structural_status != "blocked"


def run_preflight(
    manifest: EvaluationManifest,
    records: Sequence[EvaluationRecord] = (),
    *,
    config: EvaluationConfiguration | None = None,
) -> PreflightReport:
    """Run deterministic, offline preflight on approved Pydantic contracts.

    `records` is used transiently for structural checks. Output intentionally
    includes only controlled issue codes and aggregate count, not case text.
    Case payloads should be retained only in access-controlled systems.
    """
    active = config or EvaluationConfiguration()
    integrity = validate_inputs(manifest, records, policy=active.integrity_policy())
    counts = Counter((issue.code, issue.severity.value) for issue in integrity.issues)
    problems = tuple(
        PreflightIssueSummary(code=code, severity=severity, occurrences=count)
        for (code, severity), count in sorted(counts.items())
    )
    backend_status: Literal["unchecked", "compatible", "incompatible", "unavailable"] = "unchecked"
    if active.check_backend_contracts:
        backend_checks = check_backend_contracts()
        statuses = {check.status for check in backend_checks}
        if "invalid" in statuses or "incompatible" in statuses:
            backend_status = "incompatible"
        elif "unavailable" in statuses:
            backend_status = "unavailable"
        else:
            backend_status = "compatible"
    if integrity.status == "invalid" or backend_status == "incompatible":
        structural_status: Literal["checks_passed", "warnings", "blocked"] = "blocked"
    elif integrity.status == "valid_with_warnings" or backend_status == "unavailable":
        structural_status = "warnings"
    else:
        structural_status = "checks_passed"
    # Even if a manifest declares an expert-verified dataset, no actual expert
    # labels have been checked by this framework. All clinical gates stay shut.
    missing: tuple[Literal["expert_reference", "image_series", "official_report_template"], ...] = (
        "expert_reference", "image_series", "official_report_template"
    )
    audit = build_preflight_audit(
        config_valid=True,
        manifest_valid=True,
        records_valid=integrity.valid,
        backend_checked=active.check_backend_contracts,
        backend_compatible=backend_status == "compatible" if active.check_backend_contracts else None,
        final_valid=structural_status != "blocked",
    )
    return PreflightReport(
        structural_status=structural_status,
        integrity_status=integrity.status,
        backend_contract_status=backend_status,
        missing_clinical_inputs=missing,
        issues=problems,
        trace=create_receipt(active, manifest, records),
        audit=audit,
    )
