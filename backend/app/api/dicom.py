from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_container, get_dicom_service
from app.auth.deps import AuthPrincipal, require_auth, require_capability
from app.auth.rbac import CAP_DICOM
from app.dicom.fixtures import (
    brain_ct_study_files,
    brain_mri_study_files,
    cervical_mri_study_files,
    thorax_xr_study_files,
)
from app.schemas.case import CaseRecord
from app.schemas.dicom import ConfirmClassificationRequest, DicomIngestionRecord, DicomUploadResponse
from app.schemas.enums import Species
from app.security.audit import AuditOutcome
from app.services.dicom_service import DicomService

router = APIRouter(
    prefix="/api/v1/dicom",
    tags=["dicom"],
    dependencies=[Depends(require_auth), Depends(require_capability(CAP_DICOM))],
)

_MAX_FILES = 200
_MAX_FILE_BYTES = 25 * 1024 * 1024  # 25 MiB per file (metadata + small fixtures)
_MAX_TOTAL_BYTES = 100 * 1024 * 1024  # 100 MiB aggregate per upload
_MAX_VIEW_FIXTURES = 24
DemoFixtureKind = Literal["brain_mri", "cervical_mri", "brain_ct", "thorax_xr"]

# Process-local cache so sequential /fixtures/{kind}/{index} fetches share one synthetic study.
_fixture_view_cache: dict[tuple[str, int], list[tuple[str, bytes]]] = {}


def _demo_files(kind: DemoFixtureKind, instance_count: int | None = None) -> list[tuple[str, bytes]]:
    if kind == "brain_mri":
        return brain_mri_study_files(instance_count or 2)
    if kind == "cervical_mri":
        return cervical_mri_study_files(instance_count or 2)
    if kind == "brain_ct":
        return brain_ct_study_files(instance_count or 2)
    return thorax_xr_study_files(min(instance_count or 1, 1))


def _view_fixture_files(kind: DemoFixtureKind, count: int) -> list[tuple[str, bytes]]:
    n = 1 if kind == "thorax_xr" else max(1, min(count, _MAX_VIEW_FIXTURES))
    key = (kind, n)
    cached = _fixture_view_cache.get(key)
    if cached is None:
        cached = _demo_files(kind, n)
        _fixture_view_cache[key] = cached
    return cached


@router.post("/upload", response_model=DicomUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_dicom(
    files: list[UploadFile] = File(..., description="One or more DICOM files for a single study"),
    patient_name: str = Form(..., min_length=1, max_length=120),
    species: Species = Form(...),
    breed: str | None = Form(default=None),
    clinical_history: str | None = Form(default=None),
    referring_clinic: str | None = Form(default=None),
    service: DicomService = Depends(get_dicom_service),
    principal: AuthPrincipal = Depends(require_auth),
) -> DicomUploadResponse:
    if not files:
        return service.upload(
            files=[],
            patient_name=patient_name,
            species=species,
            breed=breed,
            clinical_history=clinical_history,
            referring_clinic=referring_clinic,
            principal=principal,
        )
    if len(files) > _MAX_FILES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Too many files (max {_MAX_FILES}).",
        )

    parsed_files: list[tuple[str, bytes]] = []
    total_bytes = 0
    for upload in files:
        data = await upload.read()
        if len(data) > _MAX_FILE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File '{upload.filename}' exceeds {_MAX_FILE_BYTES} bytes.",
            )
        total_bytes += len(data)
        if total_bytes > _MAX_TOTAL_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Total upload exceeds {_MAX_TOTAL_BYTES} bytes.",
            )
        name = upload.filename or "unnamed.dcm"
        parsed_files.append((name, data))

    return service.upload(
        files=parsed_files,
        patient_name=patient_name,
        species=species,
        breed=breed,
        clinical_history=clinical_history,
        referring_clinic=referring_clinic,
        principal=principal,
    )


@router.post("/demo/{kind}", response_model=DicomUploadResponse, status_code=status.HTTP_201_CREATED)
def upload_demo_fixture(
    kind: DemoFixtureKind,
    patient_name: str = Form(..., min_length=1, max_length=120),
    species: Species = Form(...),
    breed: str | None = Form(default=None),
    clinical_history: str | None = Form(default=None),
    referring_clinic: str | None = Form(default=None),
    service: DicomService = Depends(get_dicom_service),
    principal: AuthPrincipal = Depends(require_auth),
) -> DicomUploadResponse:
    """Ingest synthetic DICOM fixtures (no real PHI). Same response shape as /upload."""
    files = _demo_files(kind)
    return service.upload(
        files=files,
        patient_name=patient_name,
        species=species,
        breed=breed,
        clinical_history=clinical_history
        or f"Demo DICOM metadata ingest ({kind}). Synthetic only — not clinical imagery.",
        referring_clinic=referring_clinic,
        principal=principal,
    )


@router.get("/fixtures/{kind}/{index}")
def download_demo_fixture(
    kind: DemoFixtureKind,
    index: int,
    count: int = Query(
        default=12,
        ge=1,
        le=_MAX_VIEW_FIXTURES,
        description="Synthetic study size for client-side viewing (cached per process).",
    ),
) -> Response:
    """Download a synthetic DICOM instance for client-side viewing (not diagnosis)."""
    files = _view_fixture_files(kind, count)
    if index < 0 or index >= len(files):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fixture index out of range.")
    name, data = files[index]
    return Response(
        content=data,
        media_type="application/dicom",
        headers={
            "Content-Disposition": f'attachment; filename="{name}"',
            "X-VetMind-Fixture-Count": str(len(files)),
        },
    )


class IngestDicomFileInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    index: int
    filename: str
    size_bytes: int
    content_kind: str = "dicom"


class IngestDicomFileList(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ingest_id: str
    files: list[IngestDicomFileInfo] = Field(default_factory=list)
    note: str = "Owner/clinic display bytes from quarantine. Not a clinical PACS retrieval."


@router.get("/ingestions/{ingest_id}", response_model=DicomIngestionRecord)
def get_ingestion(
    ingest_id: str,
    service: DicomService = Depends(get_dicom_service),
    principal: AuthPrincipal = Depends(require_auth),
) -> DicomIngestionRecord:
    return service.get_ingestion(ingest_id, principal=principal)


@router.get("/ingestions/{ingest_id}/files", response_model=IngestDicomFileList)
def list_ingestion_dicom_files(
    ingest_id: str,
    request: Request,
    service: DicomService = Depends(get_dicom_service),
    principal: AuthPrincipal = Depends(require_auth),
) -> IngestDicomFileList:
    """List quarantined files for an ingest the principal can access (incl. pet owners)."""
    service.get_ingestion(ingest_id, principal=principal)
    container = get_container(request)
    refs = container.quarantine.list_files(ingest_id)
    if container.audit is not None:
        container.audit.record(
            event_type="dicom.list",
            actor=principal.subject,
            resource=ingest_id,
            outcome=AuditOutcome.SUCCESS,
            clinic_id=principal.clinic_id,
        )
    return IngestDicomFileList(
        ingest_id=ingest_id,
        files=[
            IngestDicomFileInfo(
                index=i,
                filename=ref.original_filename,
                size_bytes=ref.size_bytes,
                content_kind=ref.content_kind,
            )
            for i, ref in enumerate(refs)
        ],
    )


@router.get("/ingestions/{ingest_id}/files/{index}")
def download_ingestion_dicom_file(
    ingest_id: str,
    index: int,
    request: Request,
    service: DicomService = Depends(get_dicom_service),
    principal: AuthPrincipal = Depends(require_auth),
) -> Response:
    """Download one quarantined instance for owner/clinic in-browser preview."""
    service.get_ingestion(ingest_id, principal=principal)
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
            resource=f"{ingest_id}:{index}",
            outcome=AuditOutcome.SUCCESS,
            clinic_id=principal.clinic_id,
        )
    filename = ref.original_filename or ref.stored_filename or f"instance_{index}.dcm"
    return Response(
        content=data,
        media_type="application/dicom",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-VetMind-Ingest-Dicom-Count": str(len(refs)),
        },
    )


@router.post("/ingestions/{ingest_id}/confirm", response_model=CaseRecord)
def confirm_classification(
    ingest_id: str,
    payload: ConfirmClassificationRequest,
    service: DicomService = Depends(get_dicom_service),
    principal: AuthPrincipal = Depends(require_auth),
) -> CaseRecord:
    return service.confirm(ingest_id, payload, principal=principal)
