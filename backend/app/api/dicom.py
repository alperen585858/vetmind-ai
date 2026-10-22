from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response

from app.api.deps import get_dicom_service
from app.dicom.fixtures import brain_mri_study_files, cervical_mri_study_files
from app.schemas.case import CaseRecord
from app.schemas.dicom import ConfirmClassificationRequest, DicomIngestionRecord, DicomUploadResponse
from app.schemas.enums import Species
from app.services.dicom_service import DicomService

router = APIRouter(prefix="/api/v1/dicom", tags=["dicom"])

_MAX_FILES = 200
_MAX_FILE_BYTES = 25 * 1024 * 1024  # 25 MiB per file (metadata + small fixtures)
DemoFixtureKind = Literal["brain_mri", "cervical_mri"]


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
    files = brain_mri_study_files(2) if kind == "brain_mri" else cervical_mri_study_files(2)
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
def download_demo_fixture(kind: DemoFixtureKind, index: int) -> Response:
    """Download a synthetic DICOM instance for client-side viewing (not diagnosis)."""
    files = brain_mri_study_files(2) if kind == "brain_mri" else cervical_mri_study_files(2)
    if index < 0 or index >= len(files):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fixture index out of range.")
    name, data = files[index]
    return Response(
        content=data,
        media_type="application/dicom",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
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
