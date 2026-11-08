"""Training export manifest metadata (P1.9)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


def build_export_manifest(
    *,
    dataset_version: str,
    policy: str,
    row_count: int,
    source_case_ids: list[str],
    split_salt: str,
    split_counts: dict[str, int] | None = None,
    created_by: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    export_id = f"exp-{uuid4().hex[:12]}"
    body: dict[str, Any] = {
        "export_id": export_id,
        "dataset_version": dataset_version,
        "policy": policy,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": created_by,
        "row_count": row_count,
        "source_case_ids": sorted(set(source_case_ids)),
        "split_salt": split_salt,
        "split_counts": split_counts or {},
        "phi_policy": "patient_id_synthetic_or_hash_only; no PatientName",
    }
    if extra:
        body.update(extra)
    return body
