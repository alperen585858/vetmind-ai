"""Build ImagingModelInput packages from Case + DICOM metadata for Vision adapters."""

from __future__ import annotations

from app.models.interfaces import ImagingAdapterError
from app.models.pixel_authorization import summarize_pixel_authorization
from app.routing.capabilities import ModelCapability, default_capabilities
from app.schemas.case import CaseRecord
from app.schemas.enums import ClassificationConfidence
from app.schemas.model_input import (
    ImagingModelInput,
    ModelInputFrameRef,
    ModelInputSeriesRef,
)


def build_imaging_model_input(
    case: CaseRecord,
    *,
    capabilities: list[ModelCapability] | None = None,
) -> ImagingModelInput:
    """Create the AI-facing study package. Safe for mock: metadata_only=True.

    Does not mutate ``case``. Orchestrator/services attach the result when persisting.
    Pixel authorization is evaluated separately from any pixel loading (none here).
    """
    caps = list(capabilities if capabilities is not None else default_capabilities())
    warnings: list[str] = [
        "ImagingModelInput prepared for adapter consumption.",
        "pixel_analysis_authorized reflects policy only; pixels are not loaded in this package.",
    ]
    series_refs: list[ModelInputSeriesRef] = []
    total = 0
    quarantined = 0

    if case.dicom_study is not None:
        for series in case.dicom_study.series:
            frames = [
                ModelInputFrameRef(
                    sop_instance_uid=inst.sop_instance_uid,
                    series_instance_uid=series.series_instance_uid,
                    instance_number=inst.instance_number,
                    filename=inst.filename,
                    rows=inst.rows,
                    columns=inst.columns,
                    has_pixel_data=inst.has_pixel_data,
                    pixel_tensor_ready=False,
                    quarantine_relative_path=inst.quarantine_relative_path,
                    transfer_syntax_uid=inst.transfer_syntax_uid,
                    pixel_spacing=inst.pixel_spacing,
                    slice_thickness=inst.slice_thickness,
                    image_orientation_patient=inst.image_orientation_patient,
                    image_position_patient=inst.image_position_patient,
                )
                for inst in series.instances
            ]
            total += len(frames)
            quarantined += sum(1 for f in frames if f.quarantine_relative_path)
            series_refs.append(
                ModelInputSeriesRef(
                    series_instance_uid=series.series_instance_uid,
                    modality=series.modality,
                    series_description=series.series_description,
                    body_part_examined=series.body_part_examined,
                    frame_count=len(frames),
                    frames=frames,
                )
            )
    else:
        warnings.append(
            "No dicom_study on case; model input is modality/region routing stub only "
            "(synthetic CaseCreate or document path)."
        )

    if case.quarantine_dir:
        warnings.append("Quarantine directory attached (path omitted from authorization summary).")
    if case.document_context is not None:
        warnings.append(
            f"Document context attached ({len(case.document_context.documents)} file(s)); "
            "multimodal stub may use extracted text only."
        )

    prepared: list[str] = []
    for cap in caps:
        if not cap.enabled:
            continue
        if case.modality not in cap.modalities:
            continue
        if case.anatomical_region not in cap.regions:
            continue
        if cap.species is not None and case.species not in cap.species:
            continue
        prepared.append(cap.model_id)

    confidence: ClassificationConfidence | None = None
    if case.study.classification_confidence:
        try:
            confidence = ClassificationConfidence(case.study.classification_confidence)
        except ValueError:
            confidence = None

    auth_summary = summarize_pixel_authorization(
        case, model_ids=prepared, capabilities=caps
    )
    warnings.append(
        "pixel_authorization="
        f"{'authorized' if auth_summary.authorized else 'denied'} "
        f"codes={list(auth_summary.reason_codes)}"
    )
    if auth_summary.authorized:
        warnings.append(
            "Policy authorized pixel analysis for a capable model; "
            "no pixel tensors are attached and no decoding is performed in this phase."
        )

    return ImagingModelInput(
        case_id=case.case_id,
        study_instance_uid=case.study.study_instance_uid or (
            case.dicom_study.study_instance_uid if case.dicom_study else None
        ),
        species=case.species,
        modality=case.modality,
        anatomical_region=case.anatomical_region,
        classification_confidence=confidence,
        clinical_history=case.clinical_history,
        series=series_refs,
        total_instances=total,
        metadata_only=True,
        pixel_analysis_authorized=auth_summary.authorized,
        pixel_authorization=auth_summary,
        quarantine_dir=case.quarantine_dir,
        quarantined_instance_count=quarantined,
        prepared_for_models=prepared,
        warnings=warnings,
    )


def require_model_input(case: CaseRecord) -> ImagingModelInput:
    """Read-only accessor for adapters. Never mutates the case.

    Orchestrator must attach ``case.model_input`` before invoking adapters.
    """
    if case.model_input is None:
        raise ImagingAdapterError(
            "ImagingModelInput missing on case; orchestrator must prepare model input "
            "before adapters run."
        )
    return case.model_input


def ensure_model_input(case: CaseRecord) -> ImagingModelInput:
    """Return model input without mutating the case.

    Prefer ``require_model_input`` inside adapters. Orchestrator/services should call
    ``build_imaging_model_input`` and assign the result themselves.
    """
    if case.model_input is not None:
        return case.model_input
    return build_imaging_model_input(case)
