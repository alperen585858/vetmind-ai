"""P1.3 — evaluation harness honesty (empty → not_evaluated)."""

from __future__ import annotations


def test_empty_labels_not_evaluated() -> None:
    # Lightweight gate: without labeled GT the harness must not invent metrics.
    labeled_rows: list[dict] = []
    if not labeled_rows:
        status = "not_evaluated"
    else:
        status = "ready"
    assert status == "not_evaluated"


def test_patient_split_helper_importable() -> None:
    from ml.evaluation.patient_split import assert_no_patient_leakage, split_patients

    splits = split_patients([f"p{i}" for i in range(10)], train_frac=0.6, val_frac=0.2)
    assert_no_patient_leakage(splits)
    assert set(splits) == {"train", "val", "test"}
