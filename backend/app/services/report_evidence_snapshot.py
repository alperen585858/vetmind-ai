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
            # Selected for the report but the overlay is gone: say so instead of a silent drop.
            draft.validation_warnings = [
                *draft.validation_warnings,
                f"Evidence {ev.evidence_id} was selected for the report but its overlay image is "
                "missing; the figure is not in the approved report.",
            ]
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


def append_evidence_figures(
    case: CaseRecord,
    draft: DraftReport,
    *,
    store: EvidenceArtifactStore,
    evidence_ids: list[str],
    findings: StructuredFindings | None = None,
) -> DraftReport:
    """Append selected overlays into an already-approved report package (additive only).

    Existing figures are kept. Missing overlays are skipped with a validation warning.
    Callers must mark evidence accepted + include_in_report and ensure overlay_ref first.
    """
    sf = findings if findings is not None else case.structured_findings
    if sf is None:
        return draft
    wanted = {eid.strip() for eid in evidence_ids if eid and str(eid).strip()}
    if not wanted:
        return draft

    existing_ids = {f.evidence_id for f in (draft.evidence_figures or [])}
    version = int(draft.version)
    figures = list(draft.evidence_figures or [])

    for finding in sf.findings:
        for ev in finding.evidence_references:
            if ev.evidence_id not in wanted:
                continue
            if ev.evidence_id in existing_ids:
                continue
            if not ev.overlay_ref:
                draft.validation_warnings = [
                    *draft.validation_warnings,
                    f"Evidence {ev.evidence_id} has no overlay image; skipped.",
                ]
                continue
            try:
                art = store.copy_into_report_package(
                    case_id=case.case_id,
                    version=version,
                    evidence_id=ev.evidence_id,
                    source_relative=str(ev.overlay_ref),
                    dest_filename="overlay.png",
                )
            except (FileNotFoundError, ValueError, OSError):
                draft.validation_warnings = [
                    *draft.validation_warnings,
                    f"Evidence {ev.evidence_id} overlay missing on disk; skipped.",
                ]
                continue
            caption = f"{finding.finding_id}: {ev.description or 'AI-supported imaging evidence'}"
            figures.append(
                ReportEvidenceFigure(
                    finding_id=finding.finding_id,
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
            existing_ids.add(ev.evidence_id)

    draft.evidence_figures = figures
    return draft
