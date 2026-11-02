"""Veterinary review of AI-proposed evidence marks."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from app.schemas.case import CaseRecord
from app.schemas.findings import (
    BoundingBoxEvidence,
    EVIDENCE_DISCLAIMER,
    EvidenceReference,
    StructuredFindings,
)

ReviewAction = Literal["accept", "reject", "set_include", "edit"]


class EvidenceReviewError(ValueError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


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
            bbox=bbox,
            origin="vet_manual",
            review_status="edited",
            include_in_report=True if include_in_report is None else include_in_report,
            reviewed_by=reviewer_id,
            reviewed_at=_now(),
            vet_note=vet_note,
            supersedes_evidence_id=ev.evidence_id,
            note=EVIDENCE_DISCLAIMER,
        )
        sf.findings[fi].evidence_references.append(manual)
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
    eid = f"{finding_id}-vet-{uuid4().hex[:8]}"
    target.evidence_references.append(
        EvidenceReference(
            evidence_id=eid,
            description=description,
            evidence_type="bbox",
            sop_instance_uid=sop_instance_uid,
            frame_index=frame_index,
            bbox=bbox,
            origin="vet_manual",
            review_status="accepted",
            include_in_report=include_in_report,
            reviewed_by=reviewer_id,
            reviewed_at=_now(),
            note=EVIDENCE_DISCLAIMER,
        )
    )
    case.structured_findings = sf
    return sf
