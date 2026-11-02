"""Offline metrics helpers (not clinical claims)."""

from __future__ import annotations

from typing import Sequence


def binary_ece(probs: Sequence[float], labels: Sequence[int], *, n_bins: int = 10) -> float:
    """Expected calibration error for binary scores."""
    if len(probs) != len(labels) or not probs:
        return 0.0
    bins = [[] for _ in range(n_bins)]  # type: list[list[tuple[float, int]]]
    for p, y in zip(probs, labels):
        idx = min(n_bins - 1, int(float(p) * n_bins))
        bins[idx].append((float(p), int(y)))
    ece = 0.0
    n = len(probs)
    for bucket in bins:
        if not bucket:
            continue
        conf = sum(p for p, _ in bucket) / len(bucket)
        acc = sum(y for _, y in bucket) / len(bucket)
        ece += (len(bucket) / n) * abs(acc - conf)
    return float(ece)


def macro_f1(y_true: Sequence[Sequence[int]], y_pred: Sequence[Sequence[int]]) -> float:
    """Macro-F1 over multi-label indicator vectors."""
    if not y_true:
        return 0.0
    n_labels = len(y_true[0])
    f1s: list[float] = []
    for j in range(n_labels):
        tp = fp = fn = 0
        for yt, yp in zip(y_true, y_pred):
            t, p = int(yt[j]), int(yp[j])
            if t == 1 and p == 1:
                tp += 1
            elif t == 0 and p == 1:
                fp += 1
            elif t == 1 and p == 0:
                fn += 1
        prec = tp / (tp + fp) if (tp + fp) else 0.0
        rec = tp / (tp + fn) if (tp + fn) else 0.0
        f1s.append(0.0 if prec + rec == 0 else 2 * prec * rec / (prec + rec))
    return sum(f1s) / len(f1s)
