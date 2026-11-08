"""P1.9 — verified-only training export API (admin/expert)."""

from __future__ import annotations

import json
from dataclasses import asdict
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_container
from app.auth.deps import require_capability
from app.auth.principal import AuthPrincipal
from app.auth.rbac import CAP_TRAINING_VERIFY
from app.container import AppContainer
from app.ml.export_manifest import build_export_manifest
from app.ml.training_export import (
    VerificationFilter,
    export_jsonl,
    iter_export_rows,
    patient_split_rows,
)

router = APIRouter(prefix="/api/v1/training", tags=["training"])


class TrainingExportBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dataset_version: str = Field(min_length=1, max_length=64)
    policy: Literal["verified_only", "accepted_or_verified", "all"] = "verified_only"
    case_ids: Optional[list[str]] = Field(default=None, max_length=500)
    max_cases: int = Field(default=200, ge=1, le=2000)
    include_splits: bool = True
    split_salt: str = Field(default="vetmind-ml", min_length=1, max_length=64)
    train_frac: float = Field(default=0.7, gt=0.0, lt=1.0)
    val_frac: float = Field(default=0.15, ge=0.0, lt=1.0)


@router.post("/export")
def post_training_export(
    body: TrainingExportBody,
    request: Request,
    principal: AuthPrincipal = Depends(require_capability(CAP_TRAINING_VERIFY)),
    container: AppContainer = Depends(get_container),
) -> dict:
    """Export verified annotations as JSONL + manifest. No PatientName in rows."""
    repo = container.repo
    if body.case_ids:
        cases = []
        for cid in body.case_ids[: body.max_cases]:
            row = repo.get_case(cid)
            if row is not None:
                cases.append(row)
    else:
        cases = list(repo.list_cases())[: body.max_cases]

    policy: VerificationFilter = body.policy  # type: ignore[assignment]
    try:
        rows = iter_export_rows(cases, dataset_version=body.dataset_version, policy=policy)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    # PHI scrub assert — never ship patient_name keys
    for row in rows:
        blob = json.dumps(asdict(row))
        if "patient_name" in blob.lower():
            raise HTTPException(status_code=500, detail="PHI scrub failed: patient_name leaked")
        if row.patient_id and not (
            row.patient_id.startswith("anon-")
            or row.patient_id.startswith("synth")
            or "-" in row.patient_id  # synthetic ids from anonymize
        ):
            # Still allow synthetic clinic ids; block obvious free-text names with spaces
            if " " in row.patient_id:
                raise HTTPException(status_code=500, detail="PHI scrub failed: name-like patient_id")

    split_counts: dict[str, int] = {}
    splits_payload: dict[str, list[dict]] | None = None
    if body.include_splits and rows:
        try:
            splits = patient_split_rows(
                rows,
                train_frac=body.train_frac,
                val_frac=body.val_frac,
                salt=body.split_salt,
            )
        except AssertionError as exc:
            raise HTTPException(status_code=400, detail=f"Patient split failed: {exc}") from exc
        splits_payload = {k: [asdict(r) for r in v] for k, v in splits.items()}
        split_counts = {k: len(v) for k, v in splits.items()}

    jsonl = export_jsonl(cases, dataset_version=body.dataset_version, policy=policy)
    manifest = build_export_manifest(
        dataset_version=body.dataset_version,
        policy=policy,
        row_count=len(rows),
        source_case_ids=[c.case_id for c in cases],
        split_salt=body.split_salt,
        split_counts=split_counts,
        created_by=principal.subject,
        extra={"request_path": str(request.url.path)},
    )

    try:
        container.audit.record(
            event_type="training.export",
            actor=principal.subject,
            resource=manifest["export_id"],
            detail=f"rows={len(rows)} policy={policy}",
        )
    except Exception:
        pass

    return {
        "manifest": manifest,
        "jsonl": jsonl,
        "rows": [asdict(r) for r in rows],
        "splits": splits_payload,
    }
