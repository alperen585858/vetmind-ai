"""Plain-language owner note (issue #113)."""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_container
from app.auth.deps import AuthPrincipal, require_auth, require_capability
from app.auth.rbac import CAP_CASE_READ
from app.container import AppContainer
from app.llm.owner_summary import DISCLAIMER
from app.schemas.case import CaseRecord, OwnerSummary
from app.services.owner_summary_service import approved_version, is_stale
from app.services.pdf_report import build_owner_summary_pdf

router = APIRouter(prefix="/api/v1/cases", tags=["owner-summary"], dependencies=[Depends(require_auth)])


class OwnerSummaryState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: Optional[OwnerSummary] = None
    report_approved: bool
    approved_report_version: Optional[int] = None
    # The report was re-approved after the note was written: create it again.
    stale: bool = False
    disclaimer: str


class OwnerSummaryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    language: Optional[Literal["tr", "en"]] = None


class OwnerSummaryEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=6000)


def _state(case: CaseRecord) -> OwnerSummaryState:
    lang = case.owner_summary.language if case.owner_summary else "tr"
    version = approved_version(case)
    return OwnerSummaryState(
        summary=case.owner_summary,
        report_approved=version is not None,
        approved_report_version=version,
        stale=is_stale(case),
        disclaimer=DISCLAIMER[lang],
    )


@router.get("/{case_id}/owner-summary", response_model=OwnerSummaryState)
def get_owner_summary(
    case_id: str,
    container: AppContainer = Depends(get_container),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> OwnerSummaryState:
    return _state(container.owner_summaries.get(case_id, principal=principal))


@router.post("/{case_id}/owner-summary", response_model=OwnerSummaryState)
def create_owner_summary(
    case_id: str,
    payload: OwnerSummaryCreate | None = None,
    container: AppContainer = Depends(get_container),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> OwnerSummaryState:
    lang = payload.language if payload else None
    return _state(container.owner_summaries.generate(case_id, principal=principal, language=lang))


@router.put("/{case_id}/owner-summary", response_model=OwnerSummaryState)
def edit_owner_summary(
    case_id: str,
    payload: OwnerSummaryEdit,
    container: AppContainer = Depends(get_container),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> OwnerSummaryState:
    return _state(container.owner_summaries.edit(case_id, payload.text, principal=principal))


@router.post("/{case_id}/owner-summary/approve", response_model=OwnerSummaryState)
def approve_owner_summary(
    case_id: str,
    container: AppContainer = Depends(get_container),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> OwnerSummaryState:
    return _state(container.owner_summaries.approve(case_id, principal=principal))


@router.get("/{case_id}/owner-summary.pdf")
def owner_summary_pdf(
    case_id: str,
    container: AppContainer = Depends(get_container),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> Response:
    case, summary, disclaimer = container.owner_summaries.for_pdf(case_id, principal=principal)
    pdf = build_owner_summary_pdf(case, summary, disclaimer)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="sahip-bilgilendirme-{case.case_id}.pdf"'},
    )
