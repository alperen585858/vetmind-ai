"""Offline DICOM classification eval — confusion matrix / P/R/F1 (synthetic)."""

from __future__ import annotations

from pathlib import Path

from app.evaluation.classification_eval import (
    build_ovr_stats,
    load_eval_set,
    render_markdown,
    run_eval,
    summarize_field,
)

SET_PATH = Path(__file__).resolve().parents[1] / "eval" / "classification_eval_set.json"


def test_load_seed_set() -> None:
    eval_set = load_eval_set(SET_PATH)
    assert eval_set.version == 1
    assert len(eval_set.cases) >= 12
    ids = {c.id for c in eval_set.cases}
    assert "brain-mri-canine" in ids
    assert "hybrid-disagreement" in ids


def test_brain_mri_canine_correct() -> None:
    eval_set = load_eval_set(SET_PATH)
    eval_set.cases = [c for c in eval_set.cases if c.id == "brain-mri-canine"]
    run = run_eval(eval_set)
    assert len(run.cases) == 1
    case = run.cases[0]
    assert case.modality.correct
    assert case.region.correct
    assert case.species is not None and case.species.correct
    assert run.summary.modality.accuracy == 1.0
    assert run.summary.region.accuracy == 1.0


def test_hybrid_disagreement_needs_confirmation_or_region_miss() -> None:
    eval_set = load_eval_set(SET_PATH)
    eval_set.cases = [c for c in eval_set.cases if c.id == "hybrid-disagreement"]
    run = run_eval(eval_set)
    case = run.cases[0]
    assert case.needs_confirmation or case.disagreement or not case.region.correct
    # Gold region is BRAIN (study intent); classifier often predicts UNKNOWN.
    assert case.region.gold == "BRAIN"


def test_summarize_known_counts() -> None:
    y_true = ["A", "A", "B", "B"]
    y_pred = ["A", "B", "B", "B"]
    summary = summarize_field(y_true, y_pred)
    assert summary.labels == ["A", "B"]
    assert summary.matrix == [[1, 1], [0, 2]]
    assert summary.accuracy == 0.75
    assert summary.per_class["A"]["precision"] == 1.0
    assert summary.per_class["A"]["recall"] == 0.5
    assert abs(summary.per_class["A"]["f1"] - (2 / 3)) < 1e-9
    assert summary.per_class["B"]["precision"] == 2 / 3
    assert summary.per_class["B"]["recall"] == 1.0


def test_build_ovr_stats() -> None:
    stats = build_ovr_stats(["A", "A", "B"], ["A", "B", "B"], "A")
    assert stats.true_positive == 1
    assert stats.false_negative == 1
    assert stats.false_positive == 0
    assert stats.true_negative == 1


def test_full_run_json_shape() -> None:
    eval_set = load_eval_set(SET_PATH)
    run = run_eval(eval_set)
    payload = run.to_json()
    assert "summary" in payload
    assert "modality" in payload["summary"]
    assert "accuracy" in payload["summary"]["modality"]
    assert payload["summary"]["synthetic"] is True
    assert payload["summary"]["clinical_validation"] is False
    assert run.summary.n_cases == len(eval_set.cases)
    md = render_markdown(run, eval_set)
    assert "Macro-F1" in md
    assert "brain-mri-canine" in md
