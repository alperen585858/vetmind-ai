from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_case_service, get_container
from app.auth.deps import AuthPrincipal, require_auth, require_capability
from app.auth.rbac import CAP_ANALYZE, CAP_CASE_READ, CAP_CASE_WRITE, CAP_DICOM, CAP_REVIEW
from app.schemas.case import (
    CaseAssignmentUpdate,
    CaseCreate,
    CaseMessageCreate,
    CaseMessageView,
    CaseRecord,
    CaseSummary,
    ClinicDashboardStats,
)
from app.schemas.model_input import ImagingModelInput
from app.security.audit import AuditOutcome
from app.services.case_service import CaseService

router = APIRouter(
    prefix="/api/v1/cases",
    tags=["cases"],
    dependencies=[Depends(require_auth)],
)


class CaseDicomFileInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    index: int
    filename: str
    size_bytes: int
    content_kind: str = "dicom"


class CaseDicomFileList(BaseModel):
    model_config = ConfigDict(extra="forbid")

    case_id: str
    ingest_id: str | None = None
    files: list[CaseDicomFileInfo] = Field(default_factory=list)
    note: str = "Display bytes from quarantine. Not a clinical PACS retrieval."


@router.post("", response_model=CaseRecord, status_code=status.HTTP_201_CREATED)
def create_case(
    payload: CaseCreate,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_WRITE)),
) -> CaseRecord:
    return service.create_case(payload, principal=principal)


@router.get("", response_model=list[CaseSummary])
def list_cases(
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> list[CaseSummary]:
    return service.list_cases(principal=principal)


@router.get("/worklist", response_model=list[CaseSummary])
def list_worklist(
    status: str | None = Query(default=None),
    modality: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    assigned_to: str | None = Query(default=None),
    q: str | None = Query(default=None),
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> list[CaseSummary]:
    """Radiologist worklist with search/filter (tenant-scoped)."""
    return service.list_worklist(
        principal=principal,
        status=status,
        modality=modality,
        priority=priority,
        assigned_to=assigned_to,
        q=q,
    )


@router.get("/dashboard", response_model=ClinicDashboardStats)
def clinic_dashboard(
    status: str | None = Query(default=None),
    q: str | None = Query(default=None),
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> ClinicDashboardStats:
    """Clinic dashboard counters (active / awaiting / urgent+STAT / completed)."""
    return service.clinic_dashboard(principal=principal, status=status, q=q)


@router.get("/{case_id}/messages", response_model=list[CaseMessageView])
def list_messages(
    case_id: str,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> list[CaseMessageView]:
    return service.list_messages(case_id, principal=principal)


@router.post(
    "/{case_id}/messages",
    response_model=CaseMessageView,
    status_code=status.HTTP_201_CREATED,
)
def post_message(
    case_id: str,
    payload: CaseMessageCreate,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_auth),
) -> CaseMessageView:
    """Vet, radiologist, or pet owner (own approved case) may post."""
    if not (
        principal.can(CAP_CASE_WRITE)
        or principal.can(CAP_REVIEW)
        or principal.role == "owner"
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Messaging not allowed for this role.")
    return service.post_message(case_id, payload, principal=principal)


@router.post("/{case_id}/messages/read", response_model=list[CaseMessageView])
def mark_messages_read(
    case_id: str,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> list[CaseMessageView]:
    return service.mark_messages_read(case_id, principal=principal)


@router.patch("/{case_id}/assignment", response_model=CaseRecord)
def update_assignment(
    case_id: str,
    payload: CaseAssignmentUpdate,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_auth),
) -> CaseRecord:
    """Vet (cases:write) or radiologist (review) may assign / set priority."""
    if not (principal.can(CAP_CASE_WRITE) or principal.can(CAP_REVIEW)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Assignment not allowed.")
    return service.update_assignment(case_id, payload, principal=principal)


@router.get("/{case_id}", response_model=CaseRecord)
def get_case(
    case_id: str,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> CaseRecord:
    return service.get_case(case_id, principal=principal)


@router.post("/{case_id}/model-input", response_model=ImagingModelInput)
def prepare_model_input(
    case_id: str,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_ANALYZE)),
) -> ImagingModelInput:
    """Build the versioned ImagingModelInput package Vision AI adapters consume."""
    return service.prepare_model_input(case_id, principal=principal)


@router.get("/{case_id}/model-input", response_model=ImagingModelInput)
def get_model_input(
    case_id: str,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> ImagingModelInput:
    case = service.get_case(case_id, principal=principal)
    if case.model_input is None:
        return service.prepare_model_input(case_id, principal=principal)
    return case.model_input


@router.get("/{case_id}/findings")
def get_findings(
    case_id: str,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
):
    return service.get_findings(case_id, principal=principal)


@router.get("/{case_id}/dicom/files", response_model=CaseDicomFileList)
def list_case_dicom_files(
    case_id: str,
    request: Request,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_DICOM)),
) -> CaseDicomFileList:
    """List quarantined DICOM instances for in-browser viewing (uploaded study, not synthetic fixtures)."""
    case = service.get_case(case_id, principal=principal)
    ingest_id = case.dicom_ingest_id
    if not ingest_id:
        return CaseDicomFileList(case_id=case_id, ingest_id=None, files=[])
    container = get_container(request)
    refs = container.quarantine.list_files(ingest_id)
    if container.audit is not None:
        container.audit.record(
            event_type="dicom.list",
            actor=principal.subject,
            resource=case_id,
            outcome=AuditOutcome.SUCCESS,
            clinic_id=principal.clinic_id,
        )
    return CaseDicomFileList(
        case_id=case_id,
        ingest_id=ingest_id,
        files=[
            CaseDicomFileInfo(
                index=i,
                filename=ref.original_filename,
                size_bytes=ref.size_bytes,
                content_kind=ref.content_kind,
            )
            for i, ref in enumerate(refs)
        ],
    )


@router.get("/{case_id}/dicom/files/{index}")
def download_case_dicom_file(
    case_id: str,
    index: int,
    request: Request,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_DICOM)),
) -> Response:
    """Download one quarantined DICOM instance for display decode in the case viewer."""
    case = service.get_case(case_id, principal=principal)
    ingest_id = case.dicom_ingest_id
    if not ingest_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case has no DICOM ingest.")
    container = get_container(request)
    refs = container.quarantine.list_files(ingest_id)
    if index < 0 or index >= len(refs):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DICOM file index out of range.")
    ref = refs[index]
    try:
        _name, data = container.quarantine.read_file(ref.relative_path, expected_sha256=ref.sha256 or None)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DICOM file not available.") from exc
    if container.audit is not None:
        container.audit.record(
            event_type="dicom.retrieve",
            actor=principal.subject,
            resource=f"{case_id}:{index}",
            outcome=AuditOutcome.SUCCESS,
            clinic_id=principal.clinic_id,
        )
    filename = ref.original_filename or ref.stored_filename or f"instance_{index}.dcm"
    return Response(
        content=data,
        media_type="application/dicom",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-VetMind-Case-Dicom-Count": str(len(refs)),
        },
    )
