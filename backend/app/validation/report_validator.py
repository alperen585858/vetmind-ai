from dataclasses import dataclass, field

from app.llm.grounding import check_grounding
from app.schemas.enums import ModelExecutionStatus, ReportStatus, SourceKind
from app.schemas.findings import FINDINGS_SCHEMA_VERSION, StructuredFindings
from app.schemas.report import REPORT_SCHEMA_VERSION, DraftReport


_SECTION_TR = {
    "technique": "Teknik",
    "findings": "Bulgular",
    "impression": "Değerlendirme",
    "recommendations": "Öneriler",
}


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
            "Yapısal doğrulama klinik doğruluğu kanıtlamaz. Uzman incelemesi gereklidir."
        )

        if report.schema_version != REPORT_SCHEMA_VERSION:
            result.add_warning(f"Beklenmeyen rapor şema sürümü: {report.schema_version}.")
        if not report.report_id or not report.case_id:
            result.add_error("report_id ve case_id zorunludur.")
        if findings and report.case_id != findings.case_id:
            result.add_error("Taslak raporun case_id değeri yapılandırılmış bulgularınkiyle eşleşmiyor.")

        for name in ("technique", "findings", "impression", "recommendations"):
            section = getattr(report, name)
            if not section.text or not section.text.strip():
                result.add_error(f"Rapor bölümü boş: {_SECTION_TR.get(name, name)}.")

        if report.clinically_validated:
            result.add_error("Gerçek ve doğrulanmış bir model olana kadar clinically_validated false olmalıdır.")

        known_ids = {f.finding_id for f in findings.findings} if findings else set()
        cited = set(
            report.findings.cited_finding_ids
            + report.impression.cited_finding_ids
            + report.technique.cited_finding_ids
            + report.recommendations.cited_finding_ids
        )
        unknown = sorted(cited - known_ids)
        if unknown:
            result.add_error(f"Geçersiz bulgu atıfları: {', '.join(unknown)}.")

        for warning in check_grounding(report):
            result.add_warning(warning)

        if findings:
            if findings.schema_version != FINDINGS_SCHEMA_VERSION:
                result.add_warning(f"Beklenmeyen bulgu şema sürümü: {findings.schema_version}.")
            if findings.source_kind == SourceKind.MOCK:
                result.add_warning("Yapılandırılmış bulgular demo (mock) bir görüntü modelinden geldi.")
            if findings.source_kind == SourceKind.MIXED:
                result.add_warning(
                    "Yapılandırılmış bulgular karma kaynaklıdır; katkı veren kaynakları inceleyin."
                )
            if findings.no_findings_returned and findings.findings:
                result.add_error("Çelişkili durum: bulgu dönmedi olarak işaretli ama bulgu listesi boş değil.")
            if findings.absences_not_confirmed is False:
                result.add_warning(
                    "absences_not_confirmed false; politika gereği eksik bulgudan hastalık yokluğu çıkarılmaz."
                )
            if (
                findings.execution_status == ModelExecutionStatus.FAILED
                and report.status not in {ReportStatus.VALIDATION_FAILED, ReportStatus.DRAFT}
            ):
                result.add_error("Çelişkili durum: görüntü analizi başarısız ama rapor durumu taslak/hata değil.")
            if findings.execution_status == ModelExecutionStatus.FAILED and findings.findings:
                result.add_warning("Başarısız analiz beklenmedik şekilde bulgu içeriyor; güvenilmez kabul edin.")

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
