"""Spine segmentation pipeline: numpy-only parts (labels, splits, metrics, orientation)."""

from __future__ import annotations

import math

import numpy as np
import pytest

from ml.evaluation.segmentation import dice_per_class, mean_foreground_dice
from ml.training.spine_seg.labels import build_splits, parse_series_name, to_classes


def test_to_classes_maps_spider_values():
    raw = np.array([0, 1, 25, 26, 100, 101, 125, 201, 225, 226])
    assert to_classes(raw).tolist() == [0, 1, 1, 0, 2, 1, 1, 3, 3, 0]


def test_parse_series_name():
    assert parse_series_name("12_t2_SPACE") == ("12", "t2_SPACE")
    assert parse_series_name("3_t1") == ("3", "t1")
    with pytest.raises(ValueError):
        parse_series_name("3_flair")


def _rows(n_train: int, n_val: int):
    rows = []
    for p in range(1, n_train + n_val + 1):
        subset = "training" if p <= n_train else "validation"
        rows += [{"new_file_name": f"{p}_t1", "subset": subset}, {"new_file_name": f"{p}_t2", "subset": subset}]
    return rows


def test_official_validation_becomes_test_and_patients_never_leak():
    splits = build_splits(_rows(60, 10), val_frac=0.2)
    assert {parse_series_name(n)[0] for n in splits["test"]} == {str(p) for p in range(61, 71)}
    owner = {}
    for split, names in splits.items():
        for n in names:
            assert owner.setdefault(parse_series_name(n)[0], split) == split
    assert splits["val"] and splits["train"]


def test_split_is_deterministic_and_filters_sequences():
    a = build_splits(_rows(30, 5), sequences=["t2"])
    assert a == build_splits(_rows(30, 5), sequences=["t2"])
    assert all(n.endswith("_t2") for names in a.values() for n in names)


def test_dice_per_class_and_empty_classes():
    target = np.array([[1, 1, 0], [3, 0, 0]])
    pred = np.array([[1, 0, 0], [3, 0, 0]])
    d = dice_per_class(pred, target, 4)
    assert d[0] == pytest.approx(2 / 3)
    assert math.isnan(d[1])  # class 2 absent from both
    assert d[2] == 1.0
    rows = [{"a": 0.5, "b": float("nan")}, {"a": 1.0, "b": float("nan")}]
    assert mean_foreground_dice(rows, ["a", "b"]) == pytest.approx(0.75)


def test_sagittal_stack_orientation():
    from ml.training.spine_seg.prepare_spider import to_sagittal_stack

    arr = np.zeros((5, 4, 3))  # (z=S, y=P, x=L)
    arr[4, 0, 2] = 1  # most superior, most anterior, leftmost
    stack = to_sagittal_stack(arr)
    assert stack.shape == (3, 5, 4)
    assert stack[2, 0, 0] == 1  # superior is the top row, anterior the left column
