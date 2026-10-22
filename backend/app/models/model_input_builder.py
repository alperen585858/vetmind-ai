"""Build ImagingModelInput packages from Case + DICOM metadata for Vision adapters."""

from __future__ import annotations

from app.routing.capabilities import default_capabilities
from app.schemas.case import CaseRecord
from app.schemas.enums import ClassificationConfidence
from app.schemas.model_input import (
    ImagingModelInput,
    ModelInputFrameRef,
    ModelInputSeriesRef,
)


def build_imaging_model_input(case: CaseRecord) -> ImagingModelInput:
    """Create the AI-facing study package. Safe for mock: metadata_only=True."""
    warnings: list[str] = [
        "ImagingModelInput prepared for adapter consumption.",
        "pixel_analysis_authorized=false: mock/real adapters must not invent pixel diagnoses.",
    ]
    series_refs: list[ModelInputSeriesRef] = []
    total = 0

    if case.dicom_study is not None:
        for series in case.dicom_study.series:
            frames = [
                ModelInputFrameRef(
                    sop_instance_uid=inst.sop_instance_uid,
                    series_instance_uid=series.series_instance_uid,
                    instance_number=inst.instance_number,
                    filename=inst.filename,
                    has_pixel_data=inst.has_pixel_data,
                    pixel_tensor_ready=False,
                )
                for inst in series.instances
            ]
            total += len(frames)
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
            "(synthetic CaseCreate path)."
        )

    # Which mock/real models are plausible for this package (capability match).
    prepared: list[str] = []
    for cap in default_capabilities():
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
        pixel_analysis_authorized=False,
        prepared_for_models=prepared,
        warnings=warnings,
    )


def ensure_model_input(case: CaseRecord) -> ImagingModelInput:
    """Attach ImagingModelInput to the case if missing; return the package."""
    if case.model_input is None:
        case.model_input = build_imaging_model_input(case)
    return case.model_input
