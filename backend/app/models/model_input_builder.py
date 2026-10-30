"""Build ImagingModelInput packages from Case + DICOM metadata for Vision adapters."""

from __future__ import annotations

from app.imaging.pixel_ops import parse_image_position
from app.imaging.profiles import profile_for_modality
from app.imaging.series_selection import select_series_for_modality
from app.models.dicom_study_merge import linked_dicom_ingest_ids
from app.models.interfaces import ImagingAdapterError
from app.models.pixel_authorization import summarize_pixel_authorization
from app.routing.capabilities import ModelCapability, default_capabilities
from app.routing.model_router import list_routable_model_ids
from app.schemas.case import CaseRecord
from app.schemas.enums import ClassificationConfidence, Modality
from app.schemas.model_input import (
    ImagingModelInput,
    ModelInputFrameRef,
    ModelInputSelectionSummary,
    ModelInputSeriesRef,
)


def build_imaging_model_input(
    case: CaseRecord,
    *,
    capabilities: list[ModelCapability] | None = None,
    preferred_series_uids: list[str] | None = None,
    pixel_analysis_opt_in: bool = False,
) -> ImagingModelInput:
    """Create the AI-facing study package. Safe for mock: metadata_only=True.

    Uses Phase 19 multi-ingest study metadata on ``case.dicom_study`` (after merge)
    and selects XR 2D / MRI·CT 3D series via spatial tags when present.
    Does not mutate ``case``. Pixel authorization is policy-only (no decode).
    """
    caps = list(capabilities if capabilities is not None else default_capabilities())
    warnings: list[str] = [
        "ImagingModelInput prepared for adapter consumption.",
        "pixel_analysis_authorized reflects policy only; pixels are not loaded in this package.",
    ]
    series_refs: list[ModelInputSeriesRef] = []
    total = 0
    quarantined = 0
    ingest_ids = linked_dicom_ingest_ids(case)

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
                    ingest_id=inst.ingest_id or case.dicom_ingest_id,
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
        if len(ingest_ids) > 1:
            warnings.append(
                f"Multi-ingest DICOM package: {len(ingest_ids)} linked ingest(s) "
                f"merged into study metadata for AI selection."
            )
    else:
        warnings.append(
            "No dicom_study on case; model input is modality/region routing stub only "
            "(synthetic CaseCreate or document path)."
        )

    selection = select_series_for_modality(
        series_refs,
        case.modality,
        preferred_series_uids=preferred_series_uids,
    )
    selected_set = set(selection.series_instance_uids)
    if selected_set:
        series_refs = [
            s.model_copy(update={"selected_for_model": s.series_instance_uid in selected_set})
            for s in series_refs
        ]
    spatial_n = sum(1 for f in selection.frames if parse_image_position(f.image_position_patient))
    warnings.append(selection.reason)

    profile_hint = selection.profile_hint
    try:
        if case.modality in {Modality.MR, Modality.CT, Modality.XR}:
            contract = profile_for_modality(
                case.modality,
                model_id="__profile_probe__",
                regions=frozenset({case.anatomical_region}),
                species=frozenset({case.species}),
            )
            warnings.append(f"preprocessing_profile={contract.contract_id}")
            profile_hint = selection.profile_hint
    except Exception:  # noqa: BLE001 — other modalities have no profile
        pass

    # Align with ModelRouter: anatomy + input compatibility + availability filters.
    prepared = list_routable_model_ids(
        case, caps, pixel_analysis_opt_in=pixel_analysis_opt_in
    )

    confidence: ClassificationConfidence | None = None
    if case.study.classification_confidence:
        try:
            confidence = ClassificationConfidence(case.study.classification_confidence)
        except ValueError:
            confidence = None

    auth_summary = summarize_pixel_authorization(
        case,
        model_ids=prepared,
        capabilities=caps,
        pixel_analysis_opt_in=pixel_analysis_opt_in,
    )
    warnings.append(
        "pixel_authorization="
        f"{'authorized' if auth_summary.authorized else 'denied'} "
        f"codes={list(auth_summary.reason_codes)}"
    )
    if auth_summary.authorized:
        if pixel_analysis_opt_in:
            warnings.append(
                "Policy authorized pixel analysis; decode runs only on explicit pixel contracts."
            )
        else:
            warnings.append(
                "Policy authorized pixel analysis for a capable model; "
                "no pixel tensors are attached and no decoding is performed in this phase."
            )

    sel_summary = ModelInputSelectionSummary(
        mode=selection.mode,
        profile_hint=profile_hint,
        series_instance_uids=list(selection.series_instance_uids),
        selected_instance_count=len(selection.frames),
        spatial_instance_count=spatial_n,
        linked_ingest_ids=ingest_ids,
        reason=selection.reason,
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
        selection=sel_summary,
        preprocessing_profile_hint=profile_hint,
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
