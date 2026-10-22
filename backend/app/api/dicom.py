from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import Response

from app.api.deps import get_dicom_service
from app.auth.deps import require_auth, require_capability
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
from app.services.dicom_service import DicomService

router = APIRouter(
    prefix="/api/v1/dicom",
    tags=["dicom"],
    dependencies=[Depends(require_auth), Depends(require_capability(CAP_DICOM))],
)

_MAX_FILES = 200
_MAX_FILE_BYTES = 25 * 1024 * 1024  # 25 MiB per file (metadata + small fixtures)
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
) -> DicomUploadResponse:
    if not files:
        return service.upload(
            files=[],
            patient_name=patient_name,
            species=species,
            breed=breed,
            clinical_history=clinical_history,
            referring_clinic=referring_clinic,
        )
    if len(files) > _MAX_FILES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Too many files (max {_MAX_FILES}).",
        )

    parsed_files: list[tuple[str, bytes]] = []
    for upload in files:
        data = await upload.read()
        if len(data) > _MAX_FILE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File '{upload.filename}' exceeds {_MAX_FILE_BYTES} bytes.",
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


@router.get("/ingestions/{ingest_id}", response_model=DicomIngestionRecord)
def get_ingestion(ingest_id: str, service: DicomService = Depends(get_dicom_service)) -> DicomIngestionRecord:
    return service.get_ingestion(ingest_id)


@router.post("/ingestions/{ingest_id}/confirm", response_model=CaseRecord)
def confirm_classification(
    ingest_id: str,
    payload: ConfirmClassificationRequest,
    service: DicomService = Depends(get_dicom_service),
) -> CaseRecord:
    return service.confirm(ingest_id, payload)
