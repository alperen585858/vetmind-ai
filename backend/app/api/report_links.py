"""Public report view links (no login).

#84: opening the page does not use up the link. The page first checks the link
(``POST /report-link``, no report content), and the report itself is only returned when
the reader presses "Raporu görüntüle" (``POST /report-view``). E-mail link scanners load
pages but do not press buttons. The link works until it expires (72 h by default) or
the vet revokes it; every view is written to the audit log.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_container
from app.container import AppContainer
from app.http_errors import api_error
from app.schemas.enums import CaseLifecycleStatus, ReportStatus
from app.security.audit import AuditOutcome
from app.services.report_view_tokens import ReportViewRecord, ReportViewTokenError

router = APIRouter(prefix="/api/v1/public", tags=["public"])


class PublicReportView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    case_id: str
    patient_name: str
    report_version: int
    technique: str | None = None
    findings: str | None = None
    impression: str | None = None
    recommendations: str | None = None
    note: str = Field(
        default=(
            "Bu bağlantı süresi dolana veya veteriner iptal edene kadar geçerlidir. "
            "Klinik karar için veterinerinize danışın."
        )
    )


class PublicReportLinkStatus(BaseModel):
    """Link check without report content (safe for link scanners)."""

    model_config = ConfigDict(extra="forbid")

    valid: bool = True
    report_version: int
    expires_at: float


def _check_token(container: AppContainer, token: str) -> ReportViewRecord:
    try:
        return container.report_view_tokens.peek(token)
    except ReportViewTokenError as exc:
        code = {
            "expired": "report_link_expired",
            "used": "report_link_used",
            "revoked": "report_link_revoked",
            "invalid": "report_link_invalid",
        }.get(exc.reason, "report_link_invalid")
        raise HTTPException(
            status_code=status.HTTP_410_GONE if exc.reason in {"expired", "used", "revoked"} else status.HTTP_404_NOT_FOUND,
            detail=api_error(code, f"Report link is {exc.reason}."),
        ) from exc


class ReportLinkTokenRequest(BaseModel):
    """The link token travels in the body so it never lands in access logs (query strings do)."""

    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=10, max_length=200)


@router.post("/report-link", response_model=PublicReportLinkStatus)
def check_report_link(
    payload: ReportLinkTokenRequest,
    container: AppContainer = Depends(get_container),
) -> PublicReportLinkStatus:
    """Is the link still valid? Returns no report content and does not count as a view."""
    rec = _check_token(container, payload.token)
    return PublicReportLinkStatus(report_version=rec.report_version, expires_at=rec.expires_at)


@router.post("/report-view", response_model=PublicReportView)
def view_report_by_token(
    payload: ReportLinkTokenRequest,
    container: AppContainer = Depends(get_container),
) -> PublicReportView:
    """Return the approved report. Re-usable until expiry or revocation; every view is audited."""
    rec = _check_token(container, payload.token)

    case = container.repo.get_case(rec.case_id)
    if case is None or case.status != CaseLifecycleStatus.APPROVED:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=api_error("report_not_available", "Approved report not found."),
        )
    content = None
    version = rec.report_version
    draft = case.draft_report
    if draft is not None and draft.immutable and draft.status == ReportStatus.APPROVED and draft.version == rec.report_version:
        content = draft
        version = draft.version
    else:
        snaps = [v for v in case.report_versions if v.immutable and v.version == rec.report_version]
        if snaps:
            content = snaps[0].content
            version = snaps[0].version
        # Do not fall back to a different approved version — token promises a specific snapshot.
    if content is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=api_error("report_not_available", "Approved report snapshot not found."),
        )

    audit = getattr(container, "audit", None)
    if audit is not None:
        audit.record(
            event_type="report_link.view",
            actor="public-report-link",
            resource=case.case_id,
            outcome=AuditOutcome.SUCCESS,
            detail=f"v{version}",
            clinic_id=case.clinic_id,
        )
    return PublicReportView(
        case_id=case.case_id,
        patient_name=case.patient_name,
        report_version=version,
        technique=content.technique.text if content.technique else None,
        findings=content.findings.text if content.findings else None,
        impression=content.impression.text if content.impression else None,
        recommendations=content.recommendations.text if content.recommendations else None,
    )
