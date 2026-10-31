from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_case_service, get_container
from app.auth.deps import AuthPrincipal, require_auth, require_capability
from app.auth.rbac import CAP_ADMIN, CAP_ANALYZE, CAP_CASE_READ, CAP_CASE_WRITE, CAP_DICOM, CAP_REVIEW
from app.schemas.case import (
    CaseAssignmentUpdate,
    CaseCreate,
    CaseMessageCreate,
    CaseMessageView,
    CaseRecord,
    CaseSummary,
    ClinicDashboardStats,
)
from app.schemas.workflow import (
    CaseDocumentAttach,
    CaseNoteCreate,
    InfoRequestCreate,
    InfoRequestReply,
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
    # Phase 19: multi-ingest — global index spans primary + attachment DICOM ingests.
    ingest_id: str | None = None
    ingest_file_index: int | None = None


class CaseDicomFileList(BaseModel):
    model_config = ConfigDict(extra="forbid")

    case_id: str
    ingest_id: str | None = None
    ingest_ids: list[str] = Field(default_factory=list)
    files: list[CaseDicomFileInfo] = Field(default_factory=list)
    note: str = "Display bytes from quarantine. Not a clinical PACS retrieval."


def _case_dicom_ingest_ids(case) -> list[str]:
    """Primary dicom_ingest_id plus all authorized DICOM attachment_refs (deduped, stable order)."""
    ordered: list[str] = []
    seen: set[str] = set()
    if getattr(case, "dicom_ingest_id", None):
        ordered.append(case.dicom_ingest_id)
        seen.add(case.dicom_ingest_id)
    for att in getattr(case, "attachment_refs", None) or []:
        if getattr(att, "kind", None) == "dicom" and att.ingest_id and att.ingest_id not in seen:
            ordered.append(att.ingest_id)
            seen.add(att.ingest_id)
    return ordered


def _flatten_case_dicom_files(container, case) -> list[tuple[str, int, object]]:
    """Return list of (ingest_id, local_index, quarantine_ref) for every linked DICOM ingest."""
    flat: list[tuple[str, int, object]] = []
    for ingest_id in _case_dicom_ingest_ids(case):
        refs = container.quarantine.list_files(ingest_id)
        for local_i, ref in enumerate(refs):
            flat.append((ingest_id, local_i, ref))
    return flat


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


@router.post("/{case_id}/clinical-notes", response_model=CaseRecord)
def append_clinical_note(
    case_id: str,
    payload: CaseNoteCreate,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_auth),
) -> CaseRecord:
    if not (principal.can(CAP_CASE_WRITE) or principal.can(CAP_REVIEW)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")
    return service.append_clinical_note(case_id, payload, principal=principal)


@router.post("/{case_id}/internal-notes", response_model=CaseRecord)
def append_internal_note(
    case_id: str,
    payload: CaseNoteCreate,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_REVIEW)),
) -> CaseRecord:
    return service.append_internal_note(case_id, payload, principal=principal)


@router.post("/{case_id}/info-requests", response_model=CaseRecord, status_code=status.HTTP_201_CREATED)
def create_case_info_request(
    case_id: str,
    payload: InfoRequestCreate,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_auth),
) -> CaseRecord:
    if not (principal.can(CAP_CASE_WRITE) or principal.can(CAP_REVIEW)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")
    return service.create_info_request(case_id, payload, principal=principal)


@router.post("/{case_id}/info-requests/{request_id}/reply", response_model=CaseRecord)
def reply_case_info_request(
    case_id: str,
    request_id: str,
    payload: InfoRequestReply,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_auth),
) -> CaseRecord:
    if not (principal.can(CAP_CASE_WRITE) or principal.can(CAP_REVIEW) or principal.role == "owner"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")
    return service.reply_info_request(case_id, request_id, payload, principal=principal)


@router.post("/{case_id}/info-requests/{request_id}/close", response_model=CaseRecord)
def close_case_info_request(
    case_id: str,
    request_id: str,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_auth),
) -> CaseRecord:
    if not (principal.can(CAP_CASE_WRITE) or principal.can(CAP_REVIEW)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")
    return service.close_info_request(case_id, request_id, principal=principal)


@router.post("/{case_id}/documents", response_model=CaseRecord)
def attach_case_document(
    case_id: str,
    payload: CaseDocumentAttach,
    request: Request,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_auth),
) -> CaseRecord:
    """Attach quarantined document ingest to existing case — never creates a duplicate case."""
    if not (principal.can(CAP_CASE_WRITE) or principal.can(CAP_REVIEW)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")
    container = get_container(request)
    return service.attach_document_ingest(
        case_id, payload, principal=principal, documents_svc=container.documents
    )


@router.get("/{case_id}", response_model=CaseRecord)
def get_case(
    case_id: str,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> CaseRecord:
    return service.get_case(case_id, principal=principal)


@router.delete("/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_case(
    case_id: str,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_auth),
) -> None:
    """Delete a case/report from the store (confirmation is UI-side)."""
    # Owners have cases:read only; staff need write/review/admin — service enforces ownership.
    if not (
        principal.can(CAP_CASE_WRITE)
        or principal.can(CAP_REVIEW)
        or principal.can(CAP_ADMIN)
        or principal.role in {"owner", "clinic_owner", "demo", "service"}
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to delete cases.")
    service.delete_case(case_id, principal=principal)


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
    """List all authorized quarantined DICOM instances (primary + DICOM attachment_refs)."""
    case = service.get_case(case_id, principal=principal)
    ingest_ids = _case_dicom_ingest_ids(case)
    if not ingest_ids:
        return CaseDicomFileList(case_id=case_id, ingest_id=None, ingest_ids=[], files=[])
    container = get_container(request)
    flat = _flatten_case_dicom_files(container, case)
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
        ingest_id=ingest_ids[0],
        ingest_ids=ingest_ids,
        files=[
            CaseDicomFileInfo(
                index=i,
                filename=ref.original_filename,
                size_bytes=ref.size_bytes,
                content_kind=ref.content_kind,
                ingest_id=ingest_id,
                ingest_file_index=local_i,
            )
            for i, (ingest_id, local_i, ref) in enumerate(flat)
        ],
        note=(
            "Display bytes from quarantine across all linked DICOM ingests. "
            "Not a clinical PACS retrieval."
        ),
    )


@router.get("/{case_id}/dicom/files/{index}")
def download_case_dicom_file(
    case_id: str,
    index: int,
    request: Request,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_DICOM)),
) -> Response:
    """Download one quarantined DICOM instance (global index across linked ingests)."""
    case = service.get_case(case_id, principal=principal)
    container = get_container(request)
    flat = _flatten_case_dicom_files(container, case)
    if not flat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case has no DICOM ingest.")
    if index < 0 or index >= len(flat):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DICOM file index out of range.")
    ingest_id, _local_i, ref = flat[index]
    try:
        _name, data = container.quarantine.read_file(ref.relative_path, expected_sha256=ref.sha256 or None)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DICOM file not available.") from exc
    if container.audit is not None:
        container.audit.record(
            event_type="dicom.retrieve",
            actor=principal.subject,
            resource=f"{case_id}:{index}:{ingest_id}",
            outcome=AuditOutcome.SUCCESS,
            clinic_id=principal.clinic_id,
        )
    filename = ref.original_filename or ref.stored_filename or f"instance_{index}.dcm"
    return Response(
        content=data,
        media_type="application/dicom",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-VetMind-Case-Dicom-Count": str(len(flat)),
            "X-VetMind-Dicom-Ingest-Id": ingest_id,
        },
    )
