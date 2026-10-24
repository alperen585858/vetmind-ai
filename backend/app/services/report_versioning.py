"""Append-only report version snapshots. Approved versions are immutable."""

from __future__ import annotations

from datetime import datetime, timezone

from app.schemas.case import CaseRecord
from app.schemas.enums import ExpertReviewStatus, ReportStatus, SourceKind
from app.schemas.report import DraftReport, ReportVersionSnapshot, ReportVersionSummary


def _now() -> datetime:
    return datetime.now(timezone.utc)


def next_version_number(case: CaseRecord) -> int:
    """Next version from persisted history only (not the in-flight draft being replaced)."""
    versions = [v.version for v in case.report_versions]
    return (max(versions) if versions else 0) + 1


def _provenance(draft: DraftReport) -> tuple[SourceKind, str, str, bool]:
    gen = draft.generation
    return gen.source_kind, gen.model_id, gen.model_version, bool(draft.synthetic)


def snapshot_from_draft(
    case: CaseRecord,
    draft: DraftReport,
    *,
    author_or_source: str,
    revision_notes: str | None = None,
    immutable: bool | None = None,
) -> ReportVersionSnapshot:
    sk, mid, mver, synthetic = _provenance(draft)
    content = draft.model_copy(deep=True)
    frozen = bool(immutable if immutable is not None else content.immutable)
    content.immutable = frozen
    now = _now()
    return ReportVersionSnapshot(
        version=int(content.version),
        report_id=content.report_id,
        case_id=case.case_id,
        created_at=content.created_at or now,
        updated_at=content.updated_at or now,
        author_or_source=author_or_source,
        status=content.status,
        expert_review_status=content.expert_review_status,
        immutable=frozen,
        revision_notes=revision_notes or content.revision_notes,
        reviewed_by=content.reviewed_by,
        source_kind=sk,
        model_id=mid,
        model_version=mver,
        synthetic=synthetic,
        content=content,
    )


def upsert_version_snapshot(case: CaseRecord, snap: ReportVersionSnapshot) -> None:
    """Replace same version number if still mutable; never replace immutable approved."""
    for idx, existing in enumerate(case.report_versions):
        if existing.version != snap.version:
            continue
        if existing.immutable:
            raise ValueError(
                f"Report version {existing.version} is immutable and cannot be overwritten."
            )
        case.report_versions[idx] = snap
        return
    case.report_versions.append(snap)
    case.report_versions.sort(key=lambda v: v.version)


def get_version(case: CaseRecord, version: int) -> ReportVersionSnapshot | None:
    for snap in case.report_versions:
        if snap.version == version:
            return snap
    if case.draft_report is not None and int(case.draft_report.version) == version:
        return snapshot_from_draft(
            case,
            case.draft_report,
            author_or_source=case.draft_report.reviewed_by
            or case.draft_report.generation.model_id,
        )
    return None


def list_version_summaries(case: CaseRecord) -> list[ReportVersionSummary]:
    # Prefer explicit history; include current draft if missing from list.
    by_v = {s.version: s for s in case.report_versions}
    if case.draft_report is not None and case.draft_report.version not in by_v:
        by_v[case.draft_report.version] = snapshot_from_draft(
            case,
            case.draft_report,
            author_or_source=case.draft_report.reviewed_by
            or case.draft_report.generation.model_id,
        )
    current = case.current_report_version
    if current is None and case.draft_report is not None:
        current = case.draft_report.version
    out: list[ReportVersionSummary] = []
    for v in sorted(by_v):
        s = by_v[v]
        out.append(
            ReportVersionSummary(
                version=s.version,
                report_id=s.report_id,
                case_id=s.case_id,
                created_at=s.created_at,
                updated_at=s.updated_at,
                author_or_source=s.author_or_source,
                status=s.status,
                expert_review_status=s.expert_review_status,
                immutable=s.immutable,
                revision_notes=s.revision_notes,
                reviewed_by=s.reviewed_by,
                source_kind=s.source_kind,
                model_id=s.model_id,
                model_version=s.model_version,
                synthetic=s.synthetic,
                is_current=current is not None and s.version == current,
            )
        )
    return out


def attach_pipeline_draft(case: CaseRecord, draft: DraftReport) -> DraftReport:
    """Assign version metadata for a newly generated pipeline draft and snapshot it."""
    now = _now()
    if not case.report_versions:
        # First draft for this case (orchestrator may already have assigned draft_report).
        draft.version = 1
    else:
        # Subsequent pipeline outputs always allocate a new version number.
        draft.version = next_version_number(case)

    draft.created_at = now
    draft.updated_at = now
    draft.immutable = False
    draft.reviewed_by = None
    draft.revision_notes = "Pipeline draft generated"
    if not draft.ai_sections:
        draft.ai_sections = {
            k: getattr(draft, k).text for k in ("technique", "findings", "impression", "recommendations")
        }
    if draft.expert_review_status == ExpertReviewStatus.APPROVED:
        draft.expert_review_status = ExpertReviewStatus.PENDING

    author = f"{draft.generation.provider_id}:{draft.generation.model_id}"
    snap = snapshot_from_draft(
        case,
        draft,
        author_or_source=author,
        revision_notes=draft.revision_notes,
        immutable=False,
    )
    upsert_version_snapshot(case, snap)
    case.draft_report = draft
    case.current_report_version = draft.version
    return draft


def freeze_approved(case: CaseRecord, draft: DraftReport, *, reviewer_id: str, notes: str | None) -> DraftReport:
    now = _now()
    draft.status = ReportStatus.APPROVED
    draft.expert_review_status = ExpertReviewStatus.APPROVED
    draft.immutable = True
    draft.reviewed_by = reviewer_id
    draft.updated_at = now
    draft.revision_notes = notes
    # clinically_validated stays False — expert approve ≠ clinical certification
    draft.clinically_validated = False
    snap = snapshot_from_draft(
        case,
        draft,
        author_or_source=reviewer_id,
        revision_notes=notes,
        immutable=True,
    )
    # Approved freeze: allow replacing mutable snapshot of same version only.
    upsert_version_snapshot(case, snap)
    case.draft_report = draft
    case.current_report_version = draft.version
    case.status  # noqa: B018 — caller sets case.status
    return draft


def apply_reject_or_revision(
    case: CaseRecord,
    draft: DraftReport,
    *,
    reviewer_id: str,
    notes: str | None,
    reject: bool,
) -> DraftReport:
    """Snapshot transition. If previous was approved/immutable, open a new mutable version."""
    now = _now()
    if draft.immutable:
        # Fork a new working version from the immutable content + applied edits already on draft copy.
        forked = draft.model_copy(deep=True)
        forked.version = next_version_number(case)
        forked.report_id = f"{draft.report_id}-v{forked.version}"
        forked.immutable = False
        forked.created_at = now
        draft = forked

    if reject:
        draft.status = ReportStatus.REJECTED
        draft.expert_review_status = ExpertReviewStatus.REJECTED
    else:
        draft.status = ReportStatus.REVISION_REQUESTED
        draft.expert_review_status = ExpertReviewStatus.REVISION_REQUESTED

    draft.reviewed_by = reviewer_id
    draft.updated_at = now
    draft.revision_notes = notes
    draft.immutable = False

    snap = snapshot_from_draft(
        case,
        draft,
        author_or_source=reviewer_id,
        revision_notes=notes,
        immutable=False,
    )
    upsert_version_snapshot(case, snap)
    case.draft_report = draft
    case.current_report_version = draft.version
    return draft


def assert_mutable_for_edit(draft: DraftReport) -> None:
    if draft.immutable or draft.status == ReportStatus.APPROVED:
        raise PermissionError("Cannot edit an immutable approved report version.")
