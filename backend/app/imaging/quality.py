"""Non-destructive image quality checks for prep pipelines.

Checks never mutate quarantine bytes. Failures raise PrepValidationError.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from app.imaging.interfaces import PrepValidationError


def check_array_quality(
    tensor: np.ndarray,
    *,
    modality: str | None = None,
    min_depth: int | None = None,
    require_finite: bool = True,
) -> list[str]:
    """Return warning strings; raise on hard failures (empty / all-nan)."""
    warnings: list[str] = []
    if not isinstance(tensor, np.ndarray):
        raise PrepValidationError("quality_check: tensor must be ndarray")
    if tensor.size == 0:
        raise PrepValidationError("quality_check: empty tensor")
    if require_finite and not np.isfinite(tensor).all():
        bad = int(np.size(tensor) - np.isfinite(tensor).sum())
        raise PrepValidationError(f"quality_check: {bad} non-finite voxel(s)")
    if float(np.max(tensor)) == float(np.min(tensor)):
        warnings.append("quality_check: constant intensity image")
    if min_depth is not None and tensor.ndim >= 3 and int(tensor.shape[0]) < min_depth:
        raise PrepValidationError(
            f"quality_check: depth {tensor.shape[0]} < required min_depth={min_depth}"
        )
    mod = (modality or "").upper()
    if mod in {"MR", "CT"} and tensor.ndim == 3 and tensor.shape[0] < 2:
        raise PrepValidationError("quality_check: volume modality requires ≥2 slices")
    if mod == "XR" and tensor.ndim == 3 and tensor.shape[0] not in (1, 3):
        warnings.append(f"quality_check: unusual XR channel count {tensor.shape[0]}")
    return warnings


def spacing_warnings(pixel_spacing_mm: tuple[float, float] | None) -> list[str]:
    if pixel_spacing_mm is None:
        return ["quality_check: pixel spacing missing"]
    row, col = pixel_spacing_mm
    out: list[str] = []
    if row <= 0 or col <= 0:
        raise PrepValidationError("quality_check: non-positive pixel spacing")
    if abs(row - col) / max(row, col) > 0.25:
        out.append("quality_check: anisotropic in-plane spacing")
    return out


def summarize_quality_meta(
    *,
    warnings: list[str],
    tensor_shape: tuple[int, ...],
    contract_id: str,
) -> dict[str, Any]:
    return {
        "quality_warnings": list(warnings),
        "tensor_shape": "x".join(str(x) for x in tensor_shape),
        "contract_id": contract_id,
    }
