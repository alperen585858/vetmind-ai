"""Public single-use report view links (no login)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_container
from app.container import AppContainer
from app.http_errors import api_error
from app.schemas.enums import CaseLifecycleStatus, ReportStatus
from app.services.report_view_tokens import ReportViewTokenError

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
            "Bu bağlantı tek kullanımlıktır ve süre dolunca geçersiz olur. "
            "Klinik karar için veterinerinize danışın."
        )
    )


@router.get("/report-view", response_model=PublicReportView)
def view_report_by_token(
    token: str = Query(min_length=10, max_length=200),
    consume: bool = Query(default=True),
    container: AppContainer = Depends(get_container),
) -> PublicReportView:
    """Open an approved report via emailed magic link. Consumes the token by default."""
    try:
        if consume:
            rec = container.report_view_tokens.consume(token)
        else:
            rec = container.report_view_tokens.peek(token)
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
        elif draft is not None and draft.immutable and draft.status == ReportStatus.APPROVED:
            content = draft
            version = draft.version
    if content is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=api_error("report_not_available", "Approved report snapshot not found."),
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
