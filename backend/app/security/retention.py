"""Configurable retention policies for DICOM, temps, artifacts, reports, logs.

Does not auto-delete existing user data without an explicit apply call.
Immutable approved report history is preserved by default (reports_days=None).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

from app.schemas.case import CaseRecord
from app.schemas.enums import ReportStatus
from app.storage.quarantine import QuarantineStore


@dataclass(frozen=True)
class RetentionPolicy:
    dicom_days: int | None = None
    temp_hours: int = 24
    artifacts_days: int | None = None
    reports_days: int | None = None  # None = retain forever (preferred for approved)
    logs_days: int = 90
    preserve_approved_reports: bool = True


@dataclass(frozen=True)
class RetentionPlanItem:
    kind: str
    target: str
    reason: str
    blocked: bool = False
    block_reason: str | None = None


def _parse_ts(value: datetime | str | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


@dataclass(frozen=True)
class RetentionApplySummary:
    planned: list[RetentionPlanItem]
    applied: list[str]
    skipped_blocked: list[str]
    dry_run: bool


def plan_case_retention(cases: Iterable[CaseRecord], policy: RetentionPolicy, *, now: datetime | None = None) -> list[RetentionPlanItem]:
    """Dry-run retention decisions. Never mutates storage."""
    now = now or datetime.now(timezone.utc)
    items: list[RetentionPlanItem] = []
    for case in cases:
        created = _parse_ts(case.created_at) or now
        # DICOM quarantine
        if policy.dicom_days is not None and case.dicom_ingest_id:
            age = now - created
            if age > timedelta(days=policy.dicom_days):
                blocked = False
                reason = None
                if policy.preserve_approved_reports and case.draft_report is not None:
                    if case.draft_report.status == ReportStatus.APPROVED or case.draft_report.immutable:
                        blocked = True
                        reason = "Approved/immutable report history retained; DICOM purge deferred."
                items.append(
                    RetentionPlanItem(
                        kind="dicom_ingest",
                        target=case.dicom_ingest_id,
                        reason=f"Older than {policy.dicom_days} days",
                        blocked=blocked,
                        block_reason=reason,
                    )
                )
        # Report content — never auto-delete approved/immutable
        if policy.reports_days is not None and case.draft_report is not None:
            if policy.preserve_approved_reports and (
                case.draft_report.immutable or case.draft_report.status == ReportStatus.APPROVED
            ):
                items.append(
                    RetentionPlanItem(
                        kind="report",
                        target=case.case_id,
                        reason="Would exceed report retention",
                        blocked=True,
                        block_reason="Immutable approved report must be preserved.",
                    )
                )
            else:
                age = now - created
                if age > timedelta(days=policy.reports_days):
                    items.append(
                        RetentionPlanItem(
                            kind="report",
                            target=case.case_id,
                            reason=f"Draft older than {policy.reports_days} days",
                            blocked=False,
                        )
                    )
    return items


def apply_case_retention(
    cases: Iterable[CaseRecord],
    policy: RetentionPolicy,
    *,
    quarantine: QuarantineStore | None = None,
    dry_run: bool = True,
    now: datetime | None = None,
) -> RetentionApplySummary:
    """Execute (or simulate) retention actions from ``plan_case_retention``."""
    plan = plan_case_retention(cases, policy, now=now)
    applied: list[str] = []
    skipped: list[str] = []
    for item in plan:
        if item.blocked:
            skipped.append(f"{item.kind}:{item.target}")
            continue
        if dry_run:
            applied.append(f"would_delete:{item.kind}:{item.target}")
            continue
        if item.kind == "dicom_ingest" and quarantine is not None:
            quarantine.remove_ingest(item.target)
            applied.append(f"deleted:{item.kind}:{item.target}")
        elif item.kind == "report":
            # Draft report purge is repo-specific; admin apply only removes quarantine bytes here.
            applied.append(f"skipped_repo_mutation:{item.kind}:{item.target}")
    return RetentionApplySummary(
        planned=plan,
        applied=applied,
        skipped_blocked=skipped,
        dry_run=dry_run,
    )


def cleanup_temp_under_quarantine(
    store: QuarantineStore,
    *,
    older_than_hours: int,
    dry_run: bool = False,
) -> list[str]:
    """Remove (or list) ``.tmp-*`` directories under quarantine older than the threshold."""
    removed: list[str] = []
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max(0, older_than_hours))
    root = store.root
    if not root.is_dir():
        return removed
    for child in root.iterdir():
        if not child.is_dir() or not child.name.startswith(".tmp-"):
            continue
        mtime = datetime.fromtimestamp(child.stat().st_mtime, tz=timezone.utc)
        if mtime < cutoff:
            if dry_run:
                removed.append(child.name)
                continue
            try:
                store.cleanup_temp_dir(child)
                removed.append(child.name)
            except ValueError:
                continue
    return removed


def trim_audit_log(path: Path | None, *, keep_days: int) -> int:
    """Rewrite audit JSONL keeping events newer than keep_days. Returns removed count."""
    if path is None or not path.is_file() or keep_days < 1:
        return 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=keep_days)
    kept: list[str] = []
    removed = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            import json

            raw = json.loads(line)
            ts = _parse_ts(raw.get("timestamp"))
            if ts is not None and ts < cutoff:
                removed += 1
                continue
        except Exception:
            kept.append(line)
            continue
        kept.append(line)
    path.write_text("\n".join(kept) + ("\n" if kept else ""), encoding="utf-8")
    return removed
