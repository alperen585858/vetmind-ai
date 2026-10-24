from dataclasses import dataclass, field

from app.llm.grounding import check_grounding
from app.schemas.enums import ModelExecutionStatus, ReportStatus, SourceKind
from app.schemas.findings import FINDINGS_SCHEMA_VERSION, StructuredFindings
from app.schemas.report import REPORT_SCHEMA_VERSION, DraftReport


@dataclass
class ValidationResult:
    ok: bool
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def add_warning(self, message: str) -> None:
        self.warnings.append(message)

    def add_error(self, message: str) -> None:
        self.errors.append(message)
        self.ok = False


class ReportValidator:
    """Structural checks only. Passing validation is not clinical accuracy."""

    def validate(self, report: DraftReport, findings: StructuredFindings | None) -> ValidationResult:
        result = ValidationResult(ok=True)
        result.add_warning(
            "Structural validation does not prove clinical accuracy. Expert review is required."
        )

        if report.schema_version != REPORT_SCHEMA_VERSION:
            result.add_warning(f"Unexpected report schema_version={report.schema_version}.")
        if not report.report_id or not report.case_id:
            result.add_error("report_id and case_id are required.")
        if findings and report.case_id != findings.case_id:
            result.add_error("Draft report case_id does not match structured findings case_id.")

        for name in ("technique", "findings", "impression", "recommendations"):
            section = getattr(report, name)
            if not section.text or not section.text.strip():
                result.add_error(f"Report section '{name}' is empty.")

        if report.generation.source_kind in {SourceKind.MOCK, SourceKind.MIXED} or report.synthetic:
            result.add_warning("Report source is MOCK / MIXED / synthetic and is not clinically validated.")
        if report.clinically_validated:
            result.add_error("clinically_validated must be false until a real validated model exists.")

        known_ids = {f.finding_id for f in findings.findings} if findings else set()
        cited = set(
            report.findings.cited_finding_ids
            + report.impression.cited_finding_ids
            + report.technique.cited_finding_ids
            + report.recommendations.cited_finding_ids
        )
        unknown = sorted(cited - known_ids)
        if unknown:
            result.add_error(f"Invalid finding references: {', '.join(unknown)}.")

        for warning in check_grounding(report):
            result.add_warning(warning)

        if findings:
            if findings.schema_version != FINDINGS_SCHEMA_VERSION:
                result.add_warning(f"Unexpected findings schema_version={findings.schema_version}.")
            if findings.source_kind == SourceKind.MOCK:
                result.add_warning("Structured findings originated from a MOCK imaging adapter.")
            if findings.source_kind == SourceKind.MIXED:
                result.add_warning(
                    "Structured findings have MIXED provenance; inspect contributing_source_kinds."
                )
            if findings.no_findings_returned and findings.findings:
                result.add_error("Contradictory status: no_findings_returned is true but findings list is not empty.")
            if findings.absences_not_confirmed is False:
                result.add_warning(
                    "absences_not_confirmed is false; Phase 1 policy is to never confirm absence from missing items."
                )
            if (
                findings.execution_status == ModelExecutionStatus.FAILED
                and report.status not in {ReportStatus.VALIDATION_FAILED, ReportStatus.DRAFT}
            ):
                result.add_error("Contradictory status: imaging failed but report status is not a draft/failure state.")
            if findings.execution_status == ModelExecutionStatus.FAILED and findings.findings:
                result.add_warning("Failed execution unexpectedly includes findings; treat as unreliable.")

        if result.errors:
            report.status = ReportStatus.VALIDATION_FAILED
        elif report.status not in {
            ReportStatus.APPROVED,
            ReportStatus.REJECTED,
            ReportStatus.REVISION_REQUESTED,
        }:
            # Promote draft / recover from prior validation_failed after successful revalidation.
            # Callers must not overwrite VALIDATION_FAILED when result.ok is False.
            report.status = ReportStatus.AWAITING_REVIEW

        report.validation_warnings = list(dict.fromkeys(result.warnings + result.errors))
        return result
