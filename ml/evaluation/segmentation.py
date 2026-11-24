"""Segmentation metrics (offline, not clinical claims)."""

from __future__ import annotations

import math
from typing import Iterable, Mapping, Sequence

import numpy as np


def dice_per_class(pred: np.ndarray, target: np.ndarray, num_classes: int) -> list[float]:
    """Dice for each foreground class 1..num_classes-1.

    A class absent from both prediction and target gives NaN (it is skipped
    when averaging) instead of a misleading perfect 1.0.
    """
    if pred.shape != target.shape:
        raise ValueError(f"Shape mismatch: {pred.shape} vs {target.shape}")
    scores: list[float] = []
    for c in range(1, num_classes):
        p = pred == c
        t = target == c
        denom = int(p.sum()) + int(t.sum())
        scores.append(float("nan") if denom == 0 else 2.0 * int((p & t).sum()) / denom)
    return scores


def summarize(values: Iterable[float]) -> dict[str, float | int]:
    """Mean / std / count over non-NaN values."""
    v = [x for x in values if not math.isnan(x)]
    if not v:
        return {"mean": float("nan"), "std": float("nan"), "n": 0}
    arr = np.asarray(v, dtype=np.float64)
    return {"mean": float(arr.mean()), "std": float(arr.std()), "n": len(v)}


def mean_foreground_dice(rows: Sequence[Mapping[str, float]], class_names: Sequence[str]) -> float:
    """Average of per-class mean Dice (macro over classes)."""
    means = [summarize(r[c] for r in rows)["mean"] for c in class_names]
    means = [m for m in means if not math.isnan(m)]
    return float(np.mean(means)) if means else float("nan")
