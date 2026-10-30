"""DICOM upload → quarantine → classification confirmation → Case bridge."""

from __future__ import annotations

from uuid import uuid4

from fastapi import HTTPException, status

from app.auth.principal import AuthPrincipal
from app.auth.tenancy import assert_case_access, can_access_owned
from app.dicom.ingest import ingest_dicom_files
from app.models.model_input_builder import build_imaging_model_input
from app.routing.capabilities import ModelCapability, default_capabilities
from app.schemas.case import CaseRecord
from app.schemas.dicom import (
    ConfirmClassificationRequest,
    DicomIngestionRecord,
    DicomUploadResponse,
    QuarantineObjectRef,
)
from app.schemas.enums import (
    AnatomicalRegion,
    CaseLifecycleStatus,
    Modality,
    Species,
)
from app.schemas.findings import StudyInfo
from app.feedback.store import FeedbackStore
from app.security.audit import AuditLogger, AuditOutcome
from app.services.repository import CaseRepository
from app.storage.malware_scan import MalwareScanner, assert_upload_clean
from app.storage.quarantine import QuarantineStore

# Regions the mock automated pipeline can route today.
_ROUTABLE_REGIONS = frozenset(
    {
        AnatomicalRegion.BRAIN,
        AnatomicalRegion.CERVICAL,
        AnatomicalRegion.THORAX,
    }
)
_ROUTABLE_MODALITIES = frozenset({Modality.MR, Modality.CT, Modality.XR})


class DicomService:
    def __init__(
        self,
        repo: CaseRepository,
        quarantine: QuarantineStore,
        *,
        capabilities: list[ModelCapability] | None = None,
        tenant_isolation: bool = False,
        audit: AuditLogger | None = None,
        malware_scanner: MalwareScanner | None = None,
        feedback: FeedbackStore | None = None,
    ) -> None:
        self._repo = repo
        self._quarantine = quarantine
        self._feedback = feedback
        # Live router capabilities when provided (includes optional remote Vision id).
        self._capabilities = list(capabilities) if capabilities is not None else list(default_capabilities())
        self._tenant_isolation = tenant_isolation
        self._audit = audit
        self._malware_scanner = malware_scanner

    def upload(
        self,
        *,
        files: list[tuple[str, bytes]],
        patient_name: str,
        species: Species,
        breed: str | None = None,
        clinical_history: str | None = None,
        referring_clinic: str | None = None,
        principal: AuthPrincipal | None = None,
    ) -> DicomUploadResponse:
        if self._malware_scanner is not None:
            for name, data in files:
                try:
                    assert_upload_clean(self._malware_scanner, data, filename=name)
                except PermissionError as exc:
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail=str(exc),
                    ) from exc
        ingest_id = f"dicom-{uuid4().hex[:12]}"
        owner = principal.subject if principal and principal.via != "disabled" else None
        clinic = principal.clinic_id if principal and principal.via != "disabled" else None
        stored = self._quarantine.store_files(
            ingest_id,
            files,
            content_kinds=["dicom"] * len(files),
            owner_subject=owner,
            clinic_id=clinic,
        )
        result = ingest_dicom_files(files)

        # Attach quarantine paths onto instance metadata when SOP/filename match order.
        if result.study is not None and stored:
            by_name = {ref.original_filename: ref for ref in stored}
            for series in result.study.series:
                for inst in series.instances:
                    ref = by_name.get(inst.filename or "")
                    if ref is not None:
                        inst.quarantine_relative_path = ref.relative_path

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
        quarantine_dir = str(self._quarantine.ingest_dir(ingest_id)) if stored else None

        record = DicomIngestionRecord(
            ingest_id=ingest_id,
            patient_name=patient_name.strip(),
            species=species,
            breed=breed,
            clinical_history=clinical_history,
            referring_clinic=referring_clinic,
            owner_subject=owner,
            clinic_id=clinic,
            study=result.study,
            issues=result.issues,
            classification=result.classification,
            blocked=result.blocked,
            block_reason=result.block_reason,
            quarantine_dir=quarantine_dir,
            quarantined_files=q_refs,
        )
        self._repo.save_ingestion(record)
        if self._audit is not None and principal is not None:
            self._audit.record(
                event_type="dicom.upload",
                actor=principal.subject,
                resource=ingest_id,
                outcome=AuditOutcome.SUCCESS,
                clinic_id=clinic,
                detail=f"files={len(files)}",
            )
        return DicomUploadResponse(
            ingest_id=ingest_id,
            blocked=result.blocked,
            block_reason=result.block_reason,
            issues=result.issues,
            study=result.study,
            classification=result.classification,
            quarantine_dir=quarantine_dir,
            quarantined_file_count=len(q_refs),
        )

    def get_ingestion(
        self, ingest_id: str, *, principal: AuthPrincipal | None = None
    ) -> DicomIngestionRecord:
        record = self._repo.get_ingestion(ingest_id)
        if record is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DICOM ingestion not found.")
        if principal is not None and not can_access_owned(
            principal, record, isolation=self._tenant_isolation
        ):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DICOM ingestion not found.")
        return record

    def confirm(
        self,
        ingest_id: str,
        payload: ConfirmClassificationRequest,
        *,
        principal: AuthPrincipal | None = None,
    ) -> CaseRecord:
        # Pet owners may quarantine-upload only; clinical case binding requires vet (or demo/service).
        if (
            principal is not None
            and principal.via == "jwt"
            and principal.role == "owner"
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Pet owners attach DICOM to imaging submissions; "
                    "a veterinarian must verify and open the clinical case."
                ),
            )
        record = self.get_ingestion(ingest_id, principal=principal)
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
                if principal is not None:
                    assert_case_access(principal, existing, isolation=self._tenant_isolation)
                return existing

        classification = record.classification
        override = False
        if payload.accept_suggestion:
            modality = classification.suggested_modality
            region = classification.suggested_anatomical_region
            confidence_value = classification.confidence.value
            status_value = classification.classification_status.value
            rationale = list(classification.rationale)
        else:
            if payload.modality is None or payload.anatomical_region is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="When accept_suggestion is false, modality and anatomical_region are required.",
                )
            modality = payload.modality
            region = payload.anatomical_region
            override = True
            confidence_value = "unknown"
            status_value = "ambiguous"
            rationale = list(classification.rationale) + [
                (
                    f"Manual classification override: modality={modality.value}, "
                    f"region={region.value} (suggestion was "
                    f"{classification.suggested_modality.value}/"
                    f"{classification.suggested_anatomical_region.value})."
                )
            ]

        if modality not in _ROUTABLE_MODALITIES:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Confirmed modality is unsupported for the mock imaging pipeline (use MR/CT/XR).",
            )
        if region not in _ROUTABLE_REGIONS:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Confirmed anatomical region must be BRAIN, CERVICAL, or THORAX for automated routing. "
                    "Use manual synthetic CaseCreate if you need OTHER/UNKNOWN demos."
                ),
            )
        if modality == Modality.XR and region != AnatomicalRegion.THORAX:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="XR mock pipeline currently routes THORAX only.",
            )
        if modality in {Modality.MR, Modality.CT} and region == AnatomicalRegion.THORAX:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="MR/CT mock pipeline currently routes BRAIN or CERVICAL (not THORAX).",
            )

        patient_name = (payload.patient_name or record.patient_name).strip()
        clinical_history = payload.clinical_history if payload.clinical_history is not None else record.clinical_history
        study = record.study

        case = CaseRecord(
            case_id=f"case-{uuid4().hex[:12]}",
            patient_name=patient_name,
            species=record.species,
            breed=record.breed,
            modality=modality,
            anatomical_region=region,
            clinical_history=clinical_history or None,
            referring_clinic=record.referring_clinic,
            owner_subject=record.owner_subject
            or (principal.subject if principal and principal.via != "disabled" else None),
            clinic_id=record.clinic_id
            or (principal.clinic_id if principal and principal.via != "disabled" else None),
            study=StudyInfo(
                study_id=study.study_instance_uid,
                study_instance_uid=study.study_instance_uid,
                description=study.study_description,
                accession=study.accession_number,
                dicom_available=True,
                series_count=study.series_count,
                instance_count=study.instance_count,
                metadata_only=True,
                classification_confidence=confidence_value,
                classification_status=status_value,
                classification_override=override,
                classification_rationale=rationale,
            ),
            dicom_study=study,
            dicom_ingest_id=record.ingest_id,
            quarantine_dir=record.quarantine_dir,
            classification_confirmed=True,
            imaging_source_permission_verified=bool(payload.imaging_source_permission_verified),
            imaging_analysis_consent_verified=bool(payload.imaging_analysis_consent_verified),
            status=CaseLifecycleStatus.CREATED,
        )
        # F4: use live capability list so prepared_for_models includes remote Vision when registered.
        case.model_input = build_imaging_model_input(case, capabilities=self._capabilities)
        saved = self._repo.save_case(case)
        record.accepted = True
        record.case_id = saved.case_id
        self._repo.save_ingestion(record)
        if (
            self._feedback is not None
            and override
            and (
                modality != classification.suggested_modality
                or region != classification.suggested_anatomical_region
            )
        ):
            actor = (
                principal.subject
                if principal and principal.via != "disabled"
                else "demo-anonymous"
            )
            clinic = (
                principal.clinic_id
                if principal and principal.via != "disabled"
                else record.clinic_id
            )
            self._feedback.record_classification_correction(
                ingest_id=record.ingest_id,
                case_id=saved.case_id,
                actor=actor,
                clinic_id=clinic,
                suggested_modality=classification.suggested_modality.value,
                suggested_anatomical_region=classification.suggested_anatomical_region.value,
                confirmed_modality=modality.value,
                confirmed_anatomical_region=region.value,
            )
        return saved
