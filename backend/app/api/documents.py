from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.api.deps import get_document_service
from app.auth.deps import require_auth, require_capability
from app.auth.rbac import CAP_DOCUMENTS
from app.schemas.case import CaseRecord
from app.schemas.documents import (
    ConfirmDocumentRequest,
    DocumentIngestionRecord,
    DocumentUploadResponse,
)
from app.schemas.enums import AnatomicalRegion, Modality, Species
from app.services.document_service import DocumentService

router = APIRouter(
    prefix="/api/v1/documents",
    tags=["documents"],
    dependencies=[Depends(require_auth), Depends(require_capability(CAP_DOCUMENTS))],
)

_MAX_FILES = 20
_MAX_FILE_BYTES = 15 * 1024 * 1024


@router.post("/upload", response_model=DocumentUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_documents(
    files: list[UploadFile] = File(..., description="PDF / JPG / PNG / text files"),
    patient_name: str = Form(..., min_length=1, max_length=120),
    species: Species = Form(...),
    breed: str | None = Form(default=None),
    clinical_history: str | None = Form(default=None),
    referring_clinic: str | None = Form(default=None),
    modality_hint: Modality = Form(default=Modality.OTHER),
    anatomical_region_hint: AnatomicalRegion = Form(default=AnatomicalRegion.UNKNOWN),
    service: DocumentService = Depends(get_document_service),
) -> DocumentUploadResponse:
    if len(files) > _MAX_FILES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Too many files (max {_MAX_FILES}).",
        )
    parsed: list[tuple[str, bytes]] = []
    for upload in files:
        data = await upload.read()
        if len(data) > _MAX_FILE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File '{upload.filename}' exceeds {_MAX_FILE_BYTES} bytes.",
            )
        parsed.append((upload.filename or "unnamed.bin", data))
    return service.upload(
        files=parsed,
        patient_name=patient_name,
        species=species,
        breed=breed,
        clinical_history=clinical_history,
        referring_clinic=referring_clinic,
        modality_hint=modality_hint,
        anatomical_region_hint=anatomical_region_hint,
    )


@router.get("/ingestions/{ingest_id}", response_model=DocumentIngestionRecord)
def get_document_ingestion(
    ingest_id: str,
    service: DocumentService = Depends(get_document_service),
) -> DocumentIngestionRecord:
    return service.get_ingestion(ingest_id)


@router.post("/ingestions/{ingest_id}/confirm", response_model=CaseRecord)
def confirm_document_ingestion(
    ingest_id: str,
    payload: ConfirmDocumentRequest,
    service: DocumentService = Depends(get_document_service),
) -> CaseRecord:
    return service.confirm(ingest_id, payload)
