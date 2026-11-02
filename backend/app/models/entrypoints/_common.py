"""Shared helpers for Vision entrypoints (no torch import at module level)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from app.models.entrypoint import InferenceRequest, PreparedTensorBundle
from app.models.errors import InferenceFailedError, ModelUnavailableError
from app.schemas.enums import FindingStatus, ModelExecutionStatus, SourceKind
from app.schemas.model_outputs import (
    ClassificationLabel,
    ClassificationOutput,
    ModelTaskOutputs,
)


def load_prepared_array(prepared: PreparedTensorBundle | None) -> np.ndarray:
    """Load float32 array from in-memory tensor or ``.npy`` artifact path."""
    if prepared is None:
        raise InferenceFailedError("Inference requires PreparedTensorBundle (pixels).")
    if prepared.tensor is not None:
        arr = np.asarray(prepared.tensor)
        if arr.size == 0:
            raise InferenceFailedError("Prepared tensor is empty.")
        return arr.astype(np.float32, copy=False)
    if prepared.artifact_path:
        path = Path(prepared.artifact_path)
        if not path.is_file():
            raise InferenceFailedError(f"Prepared artifact missing: {path}")
        if path.suffix == ".npy" or path.name.endswith(".npy"):
            arr = np.load(str(path))
            return np.asarray(arr).astype(np.float32, copy=False)
        raise InferenceFailedError(
            f"Unsupported prep artifact type for inference: {path.name}"
        )
    raise InferenceFailedError(
        "PreparedTensorBundle has neither in-memory tensor nor .npy artifact."
    )


def empty_outputs(
    request: InferenceRequest,
    *,
    warnings: list[str],
    status: ModelExecutionStatus = ModelExecutionStatus.UNSUPPORTED,
    meta: dict[str, str] | None = None,
) -> ModelTaskOutputs:
    return ModelTaskOutputs(
        model_id=request.model_id,
        model_version=request.model_version,
        case_id=request.case_id,
        execution_status=status,
        source_kind=SourceKind.REAL,
        warnings=list(warnings),
        processing_metadata={
            "calibrated": "false",
            "clinically_validated": "false",
            **(meta or {}),
        },
    )


def scores_to_classification(
    *,
    label_names: list[str],
    scores: list[float],
    threshold: float = 0.5,
) -> ClassificationOutput:
    labels: list[ClassificationLabel] = []
    for name, score in zip(label_names, scores):
        status = (
            FindingStatus.SUSPECTED
            if score >= threshold
            else FindingStatus.UNCERTAIN
        )
        labels.append(
            ClassificationLabel(
                label=name,
                score=float(max(0.0, min(1.0, score))),
                finding_status=status,
            )
        )
    # Prefer labels above threshold; if none, keep empty (no invented findings).
    kept = [lab for lab in labels if (lab.score or 0.0) >= threshold]
    top = None
    if kept:
        top = max(kept, key=lambda lab: lab.score or 0.0).label
    elif labels:
        # Still expose top raw label only as UNCERTAIN below threshold → omit from kept
        top = None
    return ClassificationOutput(labels=kept, top_label=top)


def checkpoint_label_names(payload: Any, default: list[str]) -> list[str]:
    if isinstance(payload, dict):
        names = payload.get("label_names")
        if isinstance(names, (list, tuple)) and names:
            return [str(n) for n in names]
        n = payload.get("num_classes")
        if isinstance(n, int) and n > 0:
            return [f"CLASS_{i}" for i in range(n)]
    return list(default)


def require_torch():
    try:
        import torch  # type: ignore[import-not-found]

        return torch
    except Exception as exc:  # noqa: BLE001
        raise ModelUnavailableError(
            "PyTorch unavailable. Install backend/requirements-vision.txt "
            f"({type(exc).__name__})."
        ) from exc
