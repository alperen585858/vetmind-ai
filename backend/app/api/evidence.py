"""Evidence overlay download + veterinary review endpoints."""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict

from app.api.deps import get_case_service, get_container
from app.auth.deps import require_capability
from app.auth.principal import AuthPrincipal
from app.auth.rbac import CAP_CASE_READ, CAP_REVIEW
from app.schemas.findings import BoundingBoxEvidence, StructuredFindings
from app.services.case_service import CaseService
from app.services.evidence_review import EvidenceReviewError

router = APIRouter(prefix="/api/v1/cases", tags=["evidence"])


class EvidenceReviewBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["accept", "reject", "set_include", "edit"]
    include_in_report: Optional[bool] = None
    vet_note: Optional[str] = None
    bbox: Optional[BoundingBoxEvidence] = None


class ManualEvidenceBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    finding_id: str
    bbox: BoundingBoxEvidence
    sop_instance_uid: Optional[str] = None
    frame_index: Optional[int] = None
    description: str = "Radiologist manual mark"
    include_in_report: bool = True


@router.get("/{case_id}/evidence/{evidence_id}")
def get_evidence_overlay(
    case_id: str,
    evidence_id: str,
    request: Request,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> Response:
    """Serve working-store overlay PNG for an evidence_id on the case findings."""
    case = service.get_case(case_id, principal=principal)
    if case.structured_findings is None:
        raise HTTPException(status_code=404, detail="No findings on case.")
    overlay_ref = None
    for finding in case.structured_findings.findings:
        for ev in finding.evidence_references:
            if ev.evidence_id == evidence_id:
                overlay_ref = ev.overlay_ref
                break
        if overlay_ref:
            break
    if not overlay_ref:
        raise HTTPException(status_code=404, detail="Evidence overlay not found.")
    container = get_container(request)
    try:
        path = container.evidence_store.resolve(overlay_ref)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(content=path.read_bytes(), media_type="image/png")


@router.get("/{case_id}/reports/{version}/evidence/{evidence_id}")
def get_approved_evidence_overlay(
    case_id: str,
    version: int,
    evidence_id: str,
    request: Request,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> Response:
    """Serve immutable report-package overlay for an approved version."""
    case = service.get_case(case_id, principal=principal)
    draft = case.draft_report
    if draft is None or int(draft.version) != int(version):
        # Prefer version snapshot content when present
        snap = None
        for s in case.report_versions or []:
            if int(s.version) == int(version):
                snap = s
                break
        if snap is None:
            raise HTTPException(status_code=404, detail="Report version not found.")
        figures = snap.content.evidence_figures
    else:
        figures = draft.evidence_figures
    match = next((f for f in figures if f.evidence_id == evidence_id), None)
    if match is None:
        raise HTTPException(status_code=404, detail="Evidence not in report package.")
    container = get_container(request)
    try:
        path = container.evidence_store.resolve(match.overlay_ref)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(content=path.read_bytes(), media_type="image/png")


@router.post("/{case_id}/evidence/{evidence_id}/review", response_model=StructuredFindings)
def post_evidence_review(
    case_id: str,
    evidence_id: str,
    body: EvidenceReviewBody,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_REVIEW)),
) -> StructuredFindings:
    try:
        return service.review_case_evidence(
            case_id,
            evidence_id,
            action=body.action,
            principal=principal,
            include_in_report=body.include_in_report,
            vet_note=body.vet_note,
            bbox=body.bbox,
        )
    except EvidenceReviewError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/{case_id}/evidence", response_model=StructuredFindings)
def post_manual_evidence(
    case_id: str,
    body: ManualEvidenceBody,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_REVIEW)),
) -> StructuredFindings:
    try:
        return service.add_case_manual_evidence(
            case_id,
            finding_id=body.finding_id,
            principal=principal,
            bbox=body.bbox,
            sop_instance_uid=body.sop_instance_uid,
            frame_index=body.frame_index,
            description=body.description,
            include_in_report=body.include_in_report,
        )
    except EvidenceReviewError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
