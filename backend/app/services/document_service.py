"""PDF / JPG / PNG / text upload → quarantine → multimodal stub case."""

from __future__ import annotations

from uuid import uuid4

from fastapi import HTTPException, status

from app.ingest.documents import extract_document_text
from app.ingest.filetype import detect_file_kind
from app.models.model_input_builder import build_imaging_model_input
from app.schemas.case import CaseRecord
from app.schemas.dicom import QuarantineObjectRef
from app.schemas.documents import (
    CaseDocumentContext,
    ConfirmDocumentRequest,
    DocumentIngestionRecord,
    DocumentUploadResponse,
    ExtractedDocument,
)
from app.schemas.enums import (
    AnatomicalRegion,
    CaseLifecycleStatus,
    FileContentKind,
    MockScenario,
    Modality,
    Species,
)
from app.schemas.findings import StudyInfo
from app.services.repository import CaseRepository
from app.storage.quarantine import QuarantineStore


class DocumentService:
    def __init__(self, repo: CaseRepository, quarantine: QuarantineStore) -> None:
        self._repo = repo
        self._quarantine = quarantine

    def upload(
        self,
        *,
        files: list[tuple[str, bytes]],
        patient_name: str,
        species: Species,
        breed: str | None = None,
        clinical_history: str | None = None,
        referring_clinic: str | None = None,
        modality_hint: Modality = Modality.OTHER,
        anatomical_region_hint: AnatomicalRegion = AnatomicalRegion.UNKNOWN,
    ) -> DocumentUploadResponse:
        if not files:
            ingest_id = f"doc-{uuid4().hex[:12]}"
            record = DocumentIngestionRecord(
                ingest_id=ingest_id,
                patient_name=patient_name.strip(),
                species=species,
                breed=breed,
                clinical_history=clinical_history,
                referring_clinic=referring_clinic,
                modality_hint=modality_hint,
                anatomical_region_hint=anatomical_region_hint,
                blocked=True,
                block_reason="No documents uploaded.",
            )
            self._repo.save_document_ingestion(record)
            return DocumentUploadResponse(
                ingest_id=ingest_id,
                blocked=True,
                block_reason=record.block_reason,
                documents=[],
                quarantined_file_count=0,
            )

        kinds = [detect_file_kind(name, data) for name, data in files]
        if any(k == FileContentKind.DICOM for k in kinds):
            raise HTTPException(
                status_code=422,
                detail="DICOM files must use /api/v1/dicom/upload. Document ingest accepts PDF/JPG/PNG/text.",
            )
        if all(k == FileContentKind.UNKNOWN for k in kinds):
            raise HTTPException(
                status_code=422,
                detail="Could not detect a supported document type (PDF, JPG, PNG, or text).",
            )

        ingest_id = f"doc-{uuid4().hex[:12]}"
        stored = self._quarantine.store_files(
            ingest_id,
            files,
            content_kinds=[k.value for k in kinds],
        )
        documents: list[ExtractedDocument] = []
        for (filename, data), kind, ref in zip(files, kinds, stored, strict=True):
            text, truncated = extract_document_text(kind, data, filename)
            documents.append(
                ExtractedDocument(
                    filename=filename,
                    content_kind=kind,
                    quarantine_relative_path=ref.relative_path,
                    extracted_text=text,
                    text_truncated=truncated,
                    char_count=len(text or ""),
                )
            )

        q_refs = [
            QuarantineObjectRef(
                original_filename=r.original_filename,
                stored_filename=r.stored_filename,
                relative_path=r.relative_path,
                size_bytes=r.size_bytes,
                sha256=r.sha256,
                content_kind=r.content_kind,
            )
            for r in stored
        ]
        quarantine_dir = str(self._quarantine.ingest_dir(ingest_id))
        record = DocumentIngestionRecord(
            ingest_id=ingest_id,
            patient_name=patient_name.strip(),
            species=species,
            breed=breed,
            clinical_history=clinical_history,
            referring_clinic=referring_clinic,
            modality_hint=modality_hint,
            anatomical_region_hint=anatomical_region_hint,
            documents=documents,
            quarantined_files=q_refs,
            quarantine_dir=quarantine_dir,
        )
        self._repo.save_document_ingestion(record)
        return DocumentUploadResponse(
            ingest_id=ingest_id,
            blocked=False,
            documents=documents,
            quarantine_dir=quarantine_dir,
            quarantined_file_count=len(q_refs),
        )

    def get_ingestion(self, ingest_id: str) -> DocumentIngestionRecord:
        record = self._repo.get_document_ingestion(ingest_id)
        if record is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document ingestion not found.")
        return record

    def confirm(self, ingest_id: str, payload: ConfirmDocumentRequest) -> CaseRecord:
        record = self.get_ingestion(ingest_id)
        if record.blocked:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=record.block_reason or "Blocked document ingestion cannot create a case.",
            )
        if record.accepted and record.case_id:
            existing = self._repo.get_case(record.case_id)
            if existing is not None:
                return existing
        if not record.documents:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No documents to confirm.")

        modality = payload.modality or record.modality_hint or Modality.OTHER
        region = payload.anatomical_region or record.anatomical_region_hint or AnatomicalRegion.UNKNOWN
        # Multimodal stub accepts OTHER/UNKNOWN; router matches mock-multimodal-vlm-v1.
        patient_name = (payload.patient_name or record.patient_name).strip()
        clinical_history = (
            payload.clinical_history if payload.clinical_history is not None else record.clinical_history
        )

        combined_parts = [
            f"--- {d.filename} ({d.content_kind.value}) ---\n{(d.extracted_text or '').strip()}"
            for d in record.documents
        ]
        combined = "\n\n".join(p for p in combined_parts if p.strip())
        preview = combined[:4000] + ("…[truncated]" if len(combined) > 4000 else "")

        doc_ctx = CaseDocumentContext(
            document_ingest_id=record.ingest_id,
            documents=record.documents,
            combined_text_preview=preview or None,
        )
        history_bits = [
            clinical_history or "Case created from document ingest (no imaging diagnosis).",
            f"Attached {len(record.documents)} document(s) in quarantine.",
        ]
        case = CaseRecord(
            case_id=f"case-{uuid4().hex[:12]}",
            patient_name=patient_name,
            species=record.species,
            breed=record.breed,
            modality=modality,
            anatomical_region=region,
            clinical_history=" ".join(history_bits),
            referring_clinic=record.referring_clinic,
            scenario=MockScenario.DOCUMENT_CONTEXT,
            study=StudyInfo(
                description="Document-context case (PDF/JPG/PNG/text). No DICOM study.",
                dicom_available=False,
                metadata_only=True,
            ),
            quarantine_dir=record.quarantine_dir,
            document_context=doc_ctx,
            classification_confirmed=True,
            status=CaseLifecycleStatus.CREATED,
        )
        case.model_input = build_imaging_model_input(case)
        saved = self._repo.save_case(case)
        record.accepted = True
        record.case_id = saved.case_id
        self._repo.save_document_ingestion(record)
        return saved
