"""Map ModelTaskOutputs → StructuredFindings for the existing review pipeline."""

from __future__ import annotations

from collections.abc import Sequence

from app.schemas.case import CaseRecord
from app.schemas.enums import FindingStatus, ModelExecutionStatus, SourceKind
from app.schemas.findings import BoundingBoxEvidence, EvidenceReference, Finding, StructuredFindings
from app.schemas.model_outputs import ModelTaskOutputs


def map_task_outputs_to_findings(
    case: CaseRecord,
    outputs: ModelTaskOutputs,
) -> StructuredFindings:
    """Deterministic mapping. Does not invent confidence or clinical certainty."""
    findings: list[Finding] = []
    warnings = list(outputs.warnings)
    warnings.append("Mapped from ModelTaskOutputs integration contract.")
    if outputs.source_kind == SourceKind.REAL:
        warnings.append("source_kind=real does not imply clinical validation.")
    if outputs.source_kind == SourceKind.MOCK:
        warnings.append("SYNTHETIC / MOCK task outputs — not medical interpretation.")

    synthetic = outputs.source_kind != SourceKind.REAL

    if outputs.classification:
        for i, lab in enumerate(outputs.classification.labels):
            findings.append(
                Finding(
                    finding_id=f"{case.case_id}-cls-{i + 1}",
                    finding_code=f"CLS:{lab.label}",
                    description=f"Classification label: {lab.label}",
                    anatomical_location=case.anatomical_region.value,
                    finding_status=lab.finding_status,
                    source_model=outputs.model_id,
                    source_model_version=outputs.model_version,
                    requires_review=True,
                    synthetic=synthetic,
                    model_confidence=lab.score,
                    uncertainty_note="Classification head output; expert review required.",
                )
            )

    if outputs.detection:
        fixed_boxes = not outputs.detection.computed_from_input
        if fixed_boxes and outputs.detection.boxes:
            warnings.append(
                "Detection boxes are fixed values from model metadata, not predicted from this study; "
                "labelled SYNTHETIC."
            )
        for i, box in enumerate(outputs.detection.boxes):
            label = box.label or "detection"
            findings.append(
                Finding(
                    finding_id=f"{case.case_id}-det-{i + 1}",
                    finding_code=f"DET:{label}",
                    description=(
                        f"Detection '{label}' box="
                        f"({box.x_min:.1f},{box.y_min:.1f})-({box.x_max:.1f},{box.y_max:.1f})"
                    ),
                    anatomical_location=case.anatomical_region.value,
                    finding_status=FindingStatus.SUSPECTED,
                    source_model=outputs.model_id,
                    source_model_version=outputs.model_version,
                    requires_review=True,
                    synthetic=synthetic or fixed_boxes,
                    model_confidence=box.score,
                    evidence_references=[
                        EvidenceReference(
                            evidence_id=f"{case.case_id}-det-{i + 1}-ev",
                            description="Detection bounding box evidence",
                            evidence_type="bbox",
                            sop_instance_uid=box.sop_instance_uid,
                            frame_index=box.frame_index,
                            bbox=BoundingBoxEvidence(
                                x_min=box.x_min,
                                y_min=box.y_min,
                                x_max=box.x_max,
                                y_max=box.y_max,
                                coordinate_space=(
                                    "model_input"
                                    if outputs.detection.coordinate_space == "model_input"
                                    else "pixel_2d_native"
                                ),
                            ),
                            origin="ai_proposed",
                            review_status="pending",
                            include_in_report=False,
                            note=(
                                "SYNTHETIC fixed box from model metadata — not localized on this study."
                                if fixed_boxes
                                else "AI-proposed localization. Supportive evidence only — "
                                "veterinary radiologist review required."
                            ),
                        )
                    ],
                    uncertainty_note=(
                        "Fixed box from model metadata, not computed from this study."
                        if fixed_boxes
                        else "Detection head output; expert review required."
                    ),
                )
            )

    if outputs.segmentation:
        for i, region in enumerate(outputs.segmentation.regions):
            findings.append(
                Finding(
                    finding_id=f"{case.case_id}-seg-{i + 1}",
                    finding_code=f"SEG:{region.label}",
                    description=f"Segmentation region: {region.label} ({region.region_id})",
                    anatomical_location=case.anatomical_region.value,
                    finding_status=FindingStatus.POSSIBLE,
                    source_model=outputs.model_id,
                    source_model_version=outputs.model_version,
                    requires_review=True,
                    synthetic=synthetic,
                    model_confidence=region.score,
                    evidence_references=[
                        EvidenceReference(
                            evidence_id=f"{case.case_id}-seg-{i + 1}-ev",
                            description="Segmentation mask reference",
                            evidence_type="segmentation_mask",
                            sop_instance_uid=region.sop_instance_uid,
                            frame_index=region.frame_index,
                            mask_ref=region.mask_ref,
                            mask_encoding=region.mask_encoding,
                            origin="ai_proposed",
                            review_status="pending",
                            include_in_report=False,
                            note=(
                                f"mask_encoding={region.mask_encoding or 'none'}. "
                                "AI-proposed; veterinary review required before report inclusion."
                            ),
                        )
                    ],
                    uncertainty_note="Segmentation head output; expert review required.",
                )
            )

    if outputs.measurements:
        for i, m in enumerate(outputs.measurements.measurements):
            findings.append(
                Finding(
                    finding_id=f"{case.case_id}-meas-{i + 1}",
                    finding_code=f"MEAS:{m.name}",
                    description=f"Measurement {m.name}={m.value} {m.unit}",
                    anatomical_location=m.anatomical_location or case.anatomical_region.value,
                    finding_status=FindingStatus.UNCERTAIN,
                    source_model=outputs.model_id,
                    source_model_version=outputs.model_version,
                    requires_review=True,
                    synthetic=synthetic,
                    evidence_references=[
                        EvidenceReference(
                            evidence_id=f"{case.case_id}-meas-{i + 1}-ev",
                            description=m.note,
                            sop_instance_uid=m.sop_instance_uid,
                        )
                    ],
                    uncertainty_note="Measurement requires expert verification.",
                )
            )

    status = outputs.execution_status
    if status == ModelExecutionStatus.FAILED:
        findings = []
        warnings.append("execution_status=failed; findings cleared (not fabricated).")

    return StructuredFindings(
        case_id=case.case_id,
        study=case.study,
        species=case.species,
        modality=case.modality,
        anatomical_region=case.anatomical_region,
        source_model_id=outputs.model_id,
        source_model_version=outputs.model_version,
        source_kind=outputs.source_kind,
        execution_status=status,
        findings=findings,
        warnings=warnings,
        review_required=True,
        no_findings_returned=len(findings) == 0,
        absences_not_confirmed=True,
        contributing_model_ids=[outputs.model_id],
        contributing_source_kinds=[outputs.source_kind],
        processing_metadata={
            **outputs.processing_metadata,
            "mapped_from": "model_task_outputs/1.0.0",
        },
    )


def attach_spatial_chain(findings: StructuredFindings, chain: Sequence[dict]) -> StructuredFindings:
    """Give model-space boxes the prep transforms they need to be drawn on the native slice.

    Boxes that already carry a chain, or are already native, are left alone.
    """
    if not chain:
        return findings
    for finding in findings.findings:
        for ev in finding.evidence_references:
            bbox = getattr(ev, "bbox", None)
            if bbox is not None and bbox.coordinate_space == "model_input" and not bbox.transform_chain:
                ev.bbox = bbox.model_copy(update={"transform_chain": [dict(step) for step in chain]})
    return findings
