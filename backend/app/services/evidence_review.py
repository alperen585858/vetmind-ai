"""Veterinary review of AI-proposed evidence marks."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from app.imaging.geometry import map_bbox_inverse, steps_from_dicts, verify_bbox_roundtrip
from app.schemas.case import CaseRecord
from app.schemas.findings import (
    BoundingBoxEvidence,
    EVIDENCE_DISCLAIMER,
    EvidenceReference,
    StructuredFindings,
)

ReviewAction = Literal["accept", "reject", "set_include", "edit", "verify", "unverify"]


class EvidenceReviewError(ValueError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def validate_persistable_bbox(bbox: BoundingBoxEvidence) -> BoundingBoxEvidence:
    """Refuse untrusted coords. Native OK; model_input only with invertible chain."""
    if bbox.x_max <= bbox.x_min or bbox.y_max <= bbox.y_min:
        raise EvidenceReviewError("bbox max must be greater than min")
    space = (bbox.coordinate_space or "pixel_2d_native").lower()
    if space in {"pixel_2d_native", "pixel_2d"}:
        if bbox.transform_chain:
            # Optional chain on native must still invert (viewer display provenance).
            steps = steps_from_dicts(bbox.transform_chain)
            if not verify_bbox_roundtrip(
                bbox.x_min, bbox.y_min, bbox.x_max, bbox.y_max, steps
            ):
                raise EvidenceReviewError("bbox transform_chain failed round-trip verify")
        return bbox.model_copy(
            update={"coordinate_space": "pixel_2d_native", "transform_chain": list(bbox.transform_chain or [])}
        )
    if space == "model_input":
        chain = list(bbox.transform_chain or [])
        if not chain:
            raise EvidenceReviewError("model_input bbox requires transform_chain")
        steps = steps_from_dicts(chain)
        if not verify_bbox_roundtrip(bbox.x_min, bbox.y_min, bbox.x_max, bbox.y_max, steps):
            raise EvidenceReviewError("bbox transform_chain failed round-trip verify")
        nx0, ny0, nx1, ny1 = map_bbox_inverse(
            bbox.x_min, bbox.y_min, bbox.x_max, bbox.y_max, steps
        )
        return BoundingBoxEvidence(
            x_min=float(nx0),
            y_min=float(ny0),
            x_max=float(nx1),
            y_max=float(ny1),
            coordinate_space="pixel_2d_native",
            transform_chain=[],
        )
    raise EvidenceReviewError(f"bbox coordinate_space {space!r} is not persistable")


def _bump_annotation_version(prev: str | None) -> str:
    try:
        return str(int(prev or "1") + 1)
    except ValueError:
        return "2"


def _find_evidence(
    findings: StructuredFindings, evidence_id: str
) -> tuple[int, int, EvidenceReference]:
    for fi, finding in enumerate(findings.findings):
        for ei, ev in enumerate(finding.evidence_references):
            if ev.evidence_id == evidence_id:
                return fi, ei, ev
    raise EvidenceReviewError(f"Evidence {evidence_id!r} not found on case findings.")


def review_evidence(
    case: CaseRecord,
    evidence_id: str,
    *,
    action: ReviewAction,
    reviewer_id: str,
    include_in_report: bool | None = None,
    vet_note: str | None = None,
    bbox: BoundingBoxEvidence | None = None,
) -> StructuredFindings:
    """Mutate case.structured_findings according to expert action; return updated findings."""
    if case.structured_findings is None:
        raise EvidenceReviewError("Case has no structured findings.")
    sf = case.structured_findings.model_copy(deep=True)
    fi, ei, ev = _find_evidence(sf, evidence_id)

    if action == "accept":
        updated = ev.model_copy(
            update={
                "review_status": "accepted",
                "include_in_report": True if include_in_report is None else include_in_report,
                "reviewed_by": reviewer_id,
                "reviewed_at": _now(),
                "vet_note": vet_note if vet_note is not None else ev.vet_note,
            }
        )
        sf.findings[fi].evidence_references[ei] = updated
    elif action == "reject":
        updated = ev.model_copy(
            update={
                "review_status": "rejected",
                "include_in_report": False,
                "reviewed_by": reviewer_id,
                "reviewed_at": _now(),
                "vet_note": vet_note if vet_note is not None else ev.vet_note,
            }
        )
        sf.findings[fi].evidence_references[ei] = updated
    elif action == "set_include":
        if include_in_report is None:
            raise EvidenceReviewError("include_in_report required for set_include")
        if ev.review_status not in {"accepted", "edited"} and include_in_report:
            raise EvidenceReviewError(
                "Only accepted/edited evidence can be included in the report."
            )
        sf.findings[fi].evidence_references[ei] = ev.model_copy(
            update={
                "include_in_report": include_in_report,
                "reviewed_by": reviewer_id,
                "reviewed_at": _now(),
            }
        )
    elif action == "edit":
        if bbox is None:
            raise EvidenceReviewError("bbox required for edit action")
        native_bbox = validate_persistable_bbox(bbox)
        # Keep AI original as rejected/superseded; append vet_manual accepted mark.
        original = ev.model_copy(
            update={
                "review_status": "rejected",
                "include_in_report": False,
                "reviewed_by": reviewer_id,
                "reviewed_at": _now(),
                "vet_note": vet_note or "Superseded by veterinary edit.",
            }
        )
        sf.findings[fi].evidence_references[ei] = original
        new_id = f"{sf.findings[fi].finding_id}-vet-{uuid4().hex[:8]}"
        manual = EvidenceReference(
            evidence_id=new_id,
            description=vet_note or "Radiologist-adjusted localization",
            evidence_type="bbox",
            study_instance_uid=ev.study_instance_uid,
            series_instance_uid=ev.series_instance_uid,
            sop_instance_uid=ev.sop_instance_uid,
            frame_index=ev.frame_index,
            instance_number=ev.instance_number,
            image_orientation_patient=ev.image_orientation_patient,
            image_position_patient=ev.image_position_patient,
            pixel_spacing_mm=ev.pixel_spacing_mm,
            bbox=native_bbox,
            origin="vet_manual",
            review_status="edited",
            include_in_report=True if include_in_report is None else include_in_report,
            reviewed_by=reviewer_id,
            reviewed_at=_now(),
            vet_note=vet_note,
            supersedes_evidence_id=ev.evidence_id,
            annotation_version=_bump_annotation_version(ev.annotation_version),
            note=EVIDENCE_DISCLAIMER,
        )
        sf.findings[fi].evidence_references.append(manual)
    elif action == "verify":
        # Expert verification for training export — independent of acceptance.
        sf.findings[fi].evidence_references[ei] = ev.model_copy(
            update={
                "expert_verification_status": "verified",
                "expert_verified_by": reviewer_id,
                "expert_verified_at": _now(),
                "vet_note": vet_note if vet_note is not None else ev.vet_note,
            }
        )
    elif action == "unverify":
        sf.findings[fi].evidence_references[ei] = ev.model_copy(
            update={
                "expert_verification_status": "unverified",
                "expert_verified_by": reviewer_id,
                "expert_verified_at": _now(),
                "vet_note": vet_note if vet_note is not None else ev.vet_note,
            }
        )
    else:
        raise EvidenceReviewError(f"Unknown action {action!r}")

    case.structured_findings = sf
    return sf


def add_manual_evidence(
    case: CaseRecord,
    *,
    finding_id: str,
    reviewer_id: str,
    bbox: BoundingBoxEvidence,
    sop_instance_uid: str | None = None,
    frame_index: int | None = None,
    description: str = "Radiologist manual mark",
    include_in_report: bool = True,
) -> StructuredFindings:
    if case.structured_findings is None:
        raise EvidenceReviewError("Case has no structured findings.")
    sf = case.structured_findings.model_copy(deep=True)
    target = None
    for finding in sf.findings:
        if finding.finding_id == finding_id:
            target = finding
            break
    if target is None:
        raise EvidenceReviewError(f"Finding {finding_id!r} not found.")
    native_bbox = validate_persistable_bbox(bbox)
    eid = f"{finding_id}-vet-{uuid4().hex[:8]}"
    target.evidence_references.append(
        EvidenceReference(
            evidence_id=eid,
            description=description,
            evidence_type="bbox",
            sop_instance_uid=sop_instance_uid,
            frame_index=frame_index,
            bbox=native_bbox,
            origin="vet_manual",
            review_status="accepted",
            include_in_report=include_in_report,
            reviewed_by=reviewer_id,
            reviewed_at=_now(),
            annotation_version="1",
            note=EVIDENCE_DISCLAIMER,
        )
    )
    case.structured_findings = sf
    return sf
