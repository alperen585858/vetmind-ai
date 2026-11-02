"""Admin retention dry-run / apply (no auto-delete without explicit apply)."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends

from app.api.deps import get_container
from app.auth.deps import require_auth, require_capability
from app.auth.rbac import CAP_ADMIN
from app.container import AppContainer
from app.security.retention import (
    apply_case_retention,
    cleanup_temp_under_quarantine,
    cleanup_vision_artifacts,
    trim_audit_log,
)


def _vision_artifact_root(container: AppContainer) -> Path:
    if container.settings.vision_artifact_root:
        return Path(container.settings.vision_artifact_root)
    return container.quarantine.root / "_bridge_tmp"

router = APIRouter(
    prefix="/api/v1/admin/retention",
    tags=["admin"],
    dependencies=[Depends(require_auth)],
)


def _serialize_apply(summary) -> dict:
    return {
        "dry_run": summary.dry_run,
        "planned": [
            {
                "kind": i.kind,
                "target": i.target,
                "reason": i.reason,
                "blocked": i.blocked,
                "block_reason": i.block_reason,
            }
            for i in summary.planned
        ],
        "applied": list(summary.applied),
        "skipped_blocked": list(summary.skipped_blocked),
    }


@router.get("/plan")
def retention_plan_dry_run(
    container: AppContainer = Depends(get_container),
    _auth=Depends(require_capability(CAP_ADMIN)),
) -> dict:
    """Dry-run case retention using configured policy (never deletes)."""
    cases = container.repo.list_cases()
    summary = apply_case_retention(
        cases,
        container.retention_policy,
        quarantine=container.quarantine,
        dry_run=True,
    )
    temp = cleanup_temp_under_quarantine(
        container.quarantine,
        older_than_hours=container.retention_policy.temp_hours,
        dry_run=True,
    )
    art_days = container.retention_policy.artifacts_days or 0
    vision = (
        cleanup_vision_artifacts(
            _vision_artifact_root(container),
            older_than_days=art_days,
            dry_run=True,
        )
        if art_days
        else []
    )
    return {
        **_serialize_apply(summary),
        "temp_cleanup_would_remove": temp,
        "vision_artifacts_would_remove": vision,
        "policy": {
            "dicom_days": container.retention_policy.dicom_days,
            "reports_days": container.retention_policy.reports_days,
            "temp_hours": container.retention_policy.temp_hours,
            "artifacts_days": container.retention_policy.artifacts_days,
            "preserve_approved_reports": container.retention_policy.preserve_approved_reports,
        },
    }


@router.post("/apply")
def retention_apply(
    container: AppContainer = Depends(get_container),
    _auth=Depends(require_capability(CAP_ADMIN)),
) -> dict:
    """Apply non-blocked retention actions (respects approved/immutable holds)."""
    cases = container.repo.list_cases()
    summary = apply_case_retention(
        cases,
        container.retention_policy,
        quarantine=container.quarantine,
        dry_run=False,
    )
    temp_removed = cleanup_temp_under_quarantine(
        container.quarantine,
        older_than_hours=container.retention_policy.temp_hours,
    )
    art_days = container.retention_policy.artifacts_days or 0
    vision_removed = (
        cleanup_vision_artifacts(
            _vision_artifact_root(container),
            older_than_days=art_days,
            dry_run=False,
        )
        if art_days
        else []
    )
    logs_trimmed = trim_audit_log(
        container.settings.audit_log_path,
        keep_days=container.retention_policy.logs_days,
    )
    return {
        **_serialize_apply(summary),
        "temp_cleanup_removed": temp_removed,
        "vision_artifacts_removed": vision_removed,
        "audit_log_lines_removed": logs_trimmed,
    }
