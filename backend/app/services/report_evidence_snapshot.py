"""Freeze selected evidence overlays into an immutable approved-report package."""

from __future__ import annotations

from app.models.evidence_store import EvidenceArtifactStore
from app.schemas.case import CaseRecord
from app.schemas.findings import EVIDENCE_DISCLAIMER, EvidenceReference, StructuredFindings
from app.schemas.report import DraftReport, ReportEvidenceFigure


def collect_reportable_evidence(
    findings: StructuredFindings | None,
) -> list[tuple[str, EvidenceReference]]:
    """Return (finding_id, EvidenceReference) pairs eligible for PDF."""
    if findings is None:
        return []
    out: list[tuple[str, EvidenceReference]] = []
    for finding in findings.findings:
        for ev in finding.evidence_references:
            if not ev.include_in_report:
                continue
            if ev.review_status not in {"accepted", "edited"}:
                continue
            if not ev.overlay_ref:
                continue
            out.append((finding.finding_id, ev))
    return out


def freeze_evidence_into_report(
    case: CaseRecord,
    draft: DraftReport,
    *,
    store: EvidenceArtifactStore,
    findings: StructuredFindings | None = None,
) -> DraftReport:
    """Copy selected overlays into ``_report_evidence/{case}/v{N}/`` and set draft.evidence_figures.

    Prep/TTL cleanup must never delete these package paths.
    """
    sf = findings if findings is not None else case.structured_findings
    selected = collect_reportable_evidence(sf)
    figures: list[ReportEvidenceFigure] = []
    version = int(draft.version)
    for finding_id, ev in selected:
        try:
            art = store.copy_into_report_package(
                case_id=case.case_id,
                version=version,
                evidence_id=ev.evidence_id,
                source_relative=str(ev.overlay_ref),
                dest_filename="overlay.png",
            )
        except (FileNotFoundError, ValueError, OSError):
            continue
        caption = f"{finding_id}: {ev.description or 'AI-supported imaging evidence'}"
        figures.append(
            ReportEvidenceFigure(
                finding_id=finding_id,
                evidence_id=ev.evidence_id,
                origin=ev.origin,
                overlay_ref=art.relative_path,
                overlay_content_sha256=art.content_sha256,
                caption=caption.strip(),
                disclaimer=EVIDENCE_DISCLAIMER,
                sop_instance_uid=ev.sop_instance_uid,
                frame_index=ev.frame_index,
            )
        )
    draft.evidence_figures = figures
    return draft
