"""Document ingest contracts (PDF / JPG / PNG / text) — context for LLM, not diagnosis."""

from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.dicom import QuarantineObjectRef
from app.schemas.enums import AnatomicalRegion, FileContentKind, Modality, Species

DOCUMENT_SCHEMA_VERSION = "1.0.0"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ExtractedDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str
    content_kind: FileContentKind
    quarantine_relative_path: str
    extracted_text: Optional[str] = None
    text_truncated: bool = False
    char_count: int = 0
    note: str = "Extracted text is for draft-report context only. Not a clinical finding."


class DocumentIngestionRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ingest_id: str
    created_at: datetime = Field(default_factory=utcnow)
    schema_version: str = DOCUMENT_SCHEMA_VERSION
    patient_name: str
    species: Species
    breed: Optional[str] = None
    clinical_history: Optional[str] = None
    referring_clinic: Optional[str] = None
    modality_hint: Modality = Modality.OTHER
    anatomical_region_hint: AnatomicalRegion = AnatomicalRegion.UNKNOWN
    documents: list[ExtractedDocument] = Field(default_factory=list)
    quarantined_files: list[QuarantineObjectRef] = Field(default_factory=list)
    quarantine_dir: Optional[str] = None
    accepted: bool = False
    case_id: Optional[str] = None
    blocked: bool = False
    block_reason: Optional[str] = None
    # Tenancy (Phase 7): mirror DICOM ingest ownership for isolation / IDOR prevention.
    owner_subject: Optional[str] = None
    clinic_id: Optional[str] = None


class DocumentUploadResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ingest_id: str
    blocked: bool
    block_reason: Optional[str] = None
    documents: list[ExtractedDocument]
    quarantine_dir: Optional[str] = None
    quarantined_file_count: int = 0
    note: str = (
        "Document ingest: files quarantined; text extracted when possible. "
        "No vision diagnosis. Confirm to create a case routed to the multimodal stub."
    )


class ConfirmDocumentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    patient_name: Optional[str] = None
    clinical_history: Optional[str] = None
    modality: Optional[Modality] = None
    anatomical_region: Optional[AnatomicalRegion] = None


class CaseDocumentContext(BaseModel):
    """Attached to CaseRecord for LLM / multimodal stub consumption."""

    model_config = ConfigDict(extra="forbid")

    document_ingest_id: str
    documents: list[ExtractedDocument] = Field(default_factory=list)
    combined_text_preview: Optional[str] = None
    note: str = "Document context only. Does not constitute imaging findings."
    # Phase 18: additional ingests merged onto an existing case (no new case).
    additional_ingest_ids: list[str] = Field(default_factory=list)
