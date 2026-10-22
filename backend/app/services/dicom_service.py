"""DICOM upload → classification confirmation → Case bridge."""

from __future__ import annotations

from uuid import uuid4

from fastapi import HTTPException, status

from app.dicom.ingest import ingest_dicom_files
from app.models.model_input_builder import build_imaging_model_input
from app.schemas.case import CaseRecord
from app.schemas.dicom import (
    ConfirmClassificationRequest,
    DicomIngestionRecord,
    DicomUploadResponse,
)
from app.schemas.enums import (
    AnatomicalRegion,
    CaseLifecycleStatus,
    Modality,
    Species,
)
from app.schemas.findings import StudyInfo
from app.services.repository import CaseRepository


class DicomService:
    def __init__(self, repo: CaseRepository) -> None:
        self._repo = repo

    def upload(
        self,
        *,
        files: list[tuple[str, bytes]],
        patient_name: str,
        species: Species,
        breed: str | None = None,
        clinical_history: str | None = None,
        referring_clinic: str | None = None,
    ) -> DicomUploadResponse:
        result = ingest_dicom_files(files)
        ingest_id = f"dicom-{uuid4().hex[:12]}"
        record = DicomIngestionRecord(
            ingest_id=ingest_id,
            patient_name=patient_name.strip(),
            species=species,
            breed=breed,
            clinical_history=clinical_history,
            referring_clinic=referring_clinic,
            study=result.study,
            issues=result.issues,
            classification=result.classification,
            blocked=result.blocked,
            block_reason=result.block_reason,
        )
        self._repo.save_ingestion(record)
        return DicomUploadResponse(
            ingest_id=ingest_id,
            blocked=result.blocked,
            block_reason=result.block_reason,
            issues=result.issues,
            study=result.study,
            classification=result.classification,
        )

    def get_ingestion(self, ingest_id: str) -> DicomIngestionRecord:
        record = self._repo.get_ingestion(ingest_id)
        if record is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DICOM ingestion not found.")
        return record

    def confirm(self, ingest_id: str, payload: ConfirmClassificationRequest) -> CaseRecord:
        record = self.get_ingestion(ingest_id)
        if record.blocked:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=record.block_reason or "Blocked DICOM ingestion cannot create a case.",
            )
        if record.study is None or record.classification is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ingestion has no validated study/classification to confirm.",
            )
        if record.accepted and record.case_id:
            existing = self._repo.get_case(record.case_id)
            if existing is not None:
                return existing

        if payload.accept_suggestion:
            modality = record.classification.suggested_modality
            region = record.classification.suggested_anatomical_region
        else:
            if payload.modality is None or payload.anatomical_region is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="When accept_suggestion is false, modality and anatomical_region are required.",
                )
            modality = payload.modality
            region = payload.anatomical_region

        if modality == Modality.OTHER:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Confirmed modality OTHER is unsupported for the mock imaging pipeline.",
            )
        if region in {AnatomicalRegion.OTHER, AnatomicalRegion.UNKNOWN}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Confirmed anatomical region must be BRAIN or CERVICAL for automated routing. "
                    "Use manual synthetic CaseCreate if you need OTHER/UNKNOWN demos."
                ),
            )

        patient_name = (payload.patient_name or record.patient_name).strip()
        clinical_history = payload.clinical_history if payload.clinical_history is not None else record.clinical_history
        study = record.study
        classification = record.classification

        case = CaseRecord(
            case_id=f"case-{uuid4().hex[:12]}",
            patient_name=patient_name,
            species=record.species,
            breed=record.breed,
            modality=modality,
            anatomical_region=region,
            clinical_history=clinical_history
            or "Case created from DICOM metadata ingest. No pixel-based diagnosis performed.",
            referring_clinic=record.referring_clinic,
            study=StudyInfo(
                study_id=study.study_instance_uid,
                study_instance_uid=study.study_instance_uid,
                description=study.study_description,
                accession=study.accession_number,
                dicom_available=True,
                series_count=study.series_count,
                instance_count=study.instance_count,
                metadata_only=True,
                classification_confidence=classification.confidence.value,
            ),
            dicom_study=study,
            dicom_ingest_id=record.ingest_id,
            classification_confirmed=True,
            status=CaseLifecycleStatus.CREATED,
        )
        case.model_input = build_imaging_model_input(case)
        saved = self._repo.save_case(case)
        record.accepted = True
        record.case_id = saved.case_id
        self._repo.save_ingestion(record)
        return saved
