"""Owner summary workflow (issue #113): generate from the approved report, edit, approve, PDF."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.auth.principal import AuthPrincipal
from app.http_errors import api_error
from app.llm.interfaces import LLMProviderError
from app.llm.owner_summary import DISCLAIMER, _approved, generate_owner_summary
from app.schemas.case import CaseRecord, OwnerSummary
from app.security.audit import AuditOutcome

# Who may create, edit and approve the note (radiologists read it).
WRITE_ROLES = frozenset({"vet", "admin", "demo", "service"})


def _now() -> datetime:
    return datetime.now(timezone.utc)


def approved_version(case: CaseRecord) -> int | None:
    snap = _approved(case)
    return snap.version if snap else None


def is_stale(case: CaseRecord) -> bool:
    """The report was re-approved after the note was written."""
    s = case.owner_summary
    return bool(s and approved_version(case) is not None and approved_version(case) != s.report_version)


class OwnerSummaryService:
    def __init__(self, cases, *, settings, audit) -> None:
        self._cases = cases  # CaseService facade (get_case with access checks, repo, lock)
        self._settings = settings
        self._audit = audit

    # --- helpers ------------------------------------------------------------------------

    @staticmethod
    def _assert_can_write(principal: AuthPrincipal | None) -> None:
        if principal is None or principal.via == "disabled" or principal.role in WRITE_ROLES:
            return
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=api_error("owner_summary_forbidden", "Only the referring vet or an admin can change the owner note."),
        )

    def _record(self, event: str, principal: AuthPrincipal | None, case_id: str, detail: str | None = None) -> None:
        self._audit.record(
            event_type=event,
            actor=principal.subject if principal else "system",
            resource=f"/api/v1/cases/{case_id}/owner-summary",
            outcome=AuditOutcome.SUCCESS,
            detail=detail,
            clinic_id=principal.clinic_id if principal else None,
        )

    def _save(self, case: CaseRecord, summary: OwnerSummary | None) -> CaseRecord:
        with self._cases._lock:  # noqa: SLF001 — same lock as every other case write
            latest = self._cases._repo.get_case(case.case_id)  # noqa: SLF001
            latest.owner_summary = summary
            latest.updated_at = _now()
            return self._cases._repo.save_case(latest)  # noqa: SLF001

    @staticmethod
    def _require_summary(case: CaseRecord) -> OwnerSummary:
        if case.owner_summary is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=api_error("owner_summary_missing", "No owner note yet. Create one first."),
            )
        return case.owner_summary

    # --- workflow -------------------------------------------------------------------------

    def get(self, case_id: str, *, principal: AuthPrincipal | None) -> CaseRecord:
        return self._cases.get_case(case_id, principal=principal)

    def generate(self, case_id: str, *, principal: AuthPrincipal | None, language: str | None = None) -> CaseRecord:
        self._assert_can_write(principal)
        case = self._cases.get_case(case_id, principal=principal)
        version = approved_version(case)
        if version is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=api_error("owner_summary_needs_approved_report", "The report must be approved before writing the owner note."),
            )
        lang = language or self._cases._resolve_report_language(case, principal=principal)  # noqa: SLF001
        try:
            result = generate_owner_summary(case, self._settings, language=lang)
        except LLMProviderError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=api_error("owner_summary_llm_failed", f"The AI could not write the note ({exc.kind.value}). Try again."),
            ) from exc
        summary = OwnerSummary(
            text=result.text,
            language="en" if lang == "en" else "tr",
            source=result.source,  # type: ignore[arg-type]
            provider=result.provider,
            report_version=version,
            generated_by=principal.subject if principal else "system",
            warnings=result.warnings,
        )
        saved = self._save(case, summary)
        self._record("owner_summary.generate", principal, case_id, detail=f"{result.source}:{result.provider}")
        return saved

    def edit(self, case_id: str, text: str, *, principal: AuthPrincipal | None) -> CaseRecord:
        self._assert_can_write(principal)
        case = self._cases.get_case(case_id, principal=principal)
        current = self._require_summary(case)
        clean = text.strip()
        if not clean:
            raise HTTPException(status_code=422, detail=api_error("owner_summary_empty", "The note cannot be empty."))
        from app.llm.owner_summary import unsafe_reasons

        # An edit after approval needs a new approval (the printed text must be what was approved).
        updated = current.model_copy(
            update={
                "text": clean,
                "edited": True,
                "status": "draft",
                "approved_by": None,
                "approved_at": None,
                "warnings": unsafe_reasons(clean),
            }
        )
        saved = self._save(case, updated)
        self._record("owner_summary.edit", principal, case_id)
        return saved

    def approve(self, case_id: str, *, principal: AuthPrincipal | None) -> CaseRecord:
        self._assert_can_write(principal)
        case = self._cases.get_case(case_id, principal=principal)
        current = self._require_summary(case)
        if is_stale(case):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=api_error("owner_summary_stale", "The report changed after this note was written. Create it again."),
            )
        updated = current.model_copy(
            update={"status": "approved", "approved_by": principal.subject if principal else "demo", "approved_at": _now()}
        )
        saved = self._save(case, updated)
        self._record("owner_summary.approve", principal, case_id)
        return saved

    def for_pdf(self, case_id: str, *, principal: AuthPrincipal | None) -> tuple[CaseRecord, OwnerSummary, str]:
        case = self._cases.get_case(case_id, principal=principal)
        summary = self._require_summary(case)
        if summary.status != "approved" or is_stale(case):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=api_error("owner_summary_not_approved", "Approve the current owner note before printing it."),
            )
        self._record("owner_summary.pdf", principal, case_id)
        return case, summary, DISCLAIMER[summary.language]
