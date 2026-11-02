"""Offline DICOM metadata classification eval (confusion matrix, P/R/F1).

Scores ``classify_study`` against a synthetic gold set. Not clinical validation.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.dicom.classifier import classify_study
from app.evaluation.metrics import ClinicalClassificationMetrics, ConfusionMatrixStats
from app.schemas.dicom import DicomInstanceMeta, DicomSeriesMeta, DicomStudyMeta
from app.schemas.enums import AnatomicalRegion, Modality, Species

_METRICS = ClinicalClassificationMetrics()


class SeriesSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    modality: Optional[Modality] = None
    series_description: Optional[str] = None
    body_part_examined: Optional[str] = None


class StudySpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    study_description: Optional[str] = None
    patient_name_from_dicom: Optional[str] = None
    series: list[SeriesSpec] = Field(default_factory=list)


class ClassificationExpected(BaseModel):
    model_config = ConfigDict(extra="forbid")

    modality: Modality
    region: AnatomicalRegion
    # null / omitted → species not scored for this case
    species: Optional[Species] = None


class ClassificationEvalCase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str = ""
    note: str = ""
    study: StudySpec
    expected: ClassificationExpected


class ClassificationEvalSet(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = 1
    name: str = ""
    note: str = ""
    cases: list[ClassificationEvalCase]


@dataclass
class FieldPrediction:
    gold: str
    pred: str
    correct: bool


@dataclass
class CaseResult:
    case_id: str
    title: str
    modality: FieldPrediction
    region: FieldPrediction
    species: FieldPrediction | None
    needs_confirmation: bool
    disagreement: bool
    confidence: str
    classification_status: str

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "case_id": self.case_id,
            "title": self.title,
            "modality": asdict(self.modality),
            "region": asdict(self.region),
            "needs_confirmation": self.needs_confirmation,
            "disagreement": self.disagreement,
            "confidence": self.confidence,
            "classification_status": self.classification_status,
        }
        out["species"] = asdict(self.species) if self.species is not None else None
        return out


@dataclass
class FieldSummary:
    labels: list[str]
    matrix: list[list[int]]
    accuracy: float
    macro_f1: float
    per_class: dict[str, dict[str, float]]
    n: int

    def to_json(self) -> dict[str, Any]:
        return {
            "labels": self.labels,
            "matrix": self.matrix,
            "accuracy": self.accuracy,
            "macro_f1": self.macro_f1,
            "per_class": self.per_class,
            "n": self.n,
        }


@dataclass
class EvalSummary:
    modality: FieldSummary
    region: FieldSummary
    species: FieldSummary | None
    n_cases: int
    synthetic: bool = True
    clinical_validation: bool = False
    note: str = (
        "Synthetic metadata labels only. Confusion / precision / recall / F1 are for "
        "offline demo of classification metrics — not clinical validation."
    )

    def to_json(self) -> dict[str, Any]:
        return {
            "modality": self.modality.to_json(),
            "region": self.region.to_json(),
            "species": self.species.to_json() if self.species is not None else None,
            "n_cases": self.n_cases,
            "synthetic": self.synthetic,
            "clinical_validation": self.clinical_validation,
            "note": self.note,
        }


@dataclass
class RunResult:
    label: str
    classifier: str
    summary: EvalSummary
    cases: list[CaseResult] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        return {
            "label": self.label,
            "classifier": self.classifier,
            "summary": self.summary.to_json(),
            "cases": [c.to_json() for c in self.cases],
        }


def load_eval_set(path: Path | str) -> ClassificationEvalSet:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return ClassificationEvalSet.model_validate(data)


def build_study(case: ClassificationEvalCase) -> DicomStudyMeta:
    series: list[DicomSeriesMeta] = []
    for i, spec in enumerate(case.study.series or [SeriesSpec()]):
        series.append(
            DicomSeriesMeta(
                series_instance_uid=f"1.2.840.eval.{case.id}.s{i}",
                modality=spec.modality,
                series_description=spec.series_description,
                body_part_examined=spec.body_part_examined,
                instances=[
                    DicomInstanceMeta(
                        sop_instance_uid=f"1.2.840.eval.{case.id}.s{i}.i0",
                        filename=f"{case.id}_s{i}.dcm",
                        has_pixel_data=False,
                        pixel_data_analyzed=False,
                    )
                ],
            )
        )
    return DicomStudyMeta(
        study_instance_uid=f"1.2.840.eval.{case.id}",
        study_description=case.study.study_description,
        patient_name_from_dicom=case.study.patient_name_from_dicom,
        series=series,
    )


def build_ovr_stats(
    y_true: list[str],
    y_pred: list[str],
    positive_label: str,
) -> ConfusionMatrixStats:
    """One-vs-rest binary counts for ``positive_label``."""
    tp = fp = tn = fn = 0
    for gold, pred in zip(y_true, y_pred, strict=True):
        gold_pos = gold == positive_label
        pred_pos = pred == positive_label
        if gold_pos and pred_pos:
            tp += 1
        elif not gold_pos and pred_pos:
            fp += 1
        elif not gold_pos and not pred_pos:
            tn += 1
        else:
            fn += 1
    return ConfusionMatrixStats(
        true_positive=tp,
        false_positive=fp,
        true_negative=tn,
        false_negative=fn,
    )


def summarize_field(y_true: list[str], y_pred: list[str]) -> FieldSummary:
    if len(y_true) != len(y_pred):
        raise ValueError("y_true and y_pred must have the same length.")
    labels = sorted(set(y_true) | set(y_pred))
    index = {lab: i for i, lab in enumerate(labels)}
    n = len(labels)
    matrix = [[0 for _ in range(n)] for _ in range(n)]
    correct = 0
    for gold, pred in zip(y_true, y_pred, strict=True):
        matrix[index[gold]][index[pred]] += 1
        if gold == pred:
            correct += 1

    per_class: dict[str, dict[str, float]] = {}
    f1s: list[float] = []
    for lab in labels:
        stats = build_ovr_stats(y_true, y_pred, lab)
        result = _METRICS.evaluate_class_metrics(stats)
        per_class[lab] = {
            "precision": result.ppv,
            "recall": result.sensitivity,
            "f1": result.f1_score,
            "specificity": result.specificity,
            "support": float(stats.true_positive + stats.false_negative),
        }
        f1s.append(result.f1_score)

    accuracy = (correct / len(y_true)) if y_true else 0.0
    macro_f1 = (sum(f1s) / len(f1s)) if f1s else 0.0
    return FieldSummary(
        labels=labels,
        matrix=matrix,
        accuracy=accuracy,
        macro_f1=macro_f1,
        per_class=per_class,
        n=len(y_true),
    )


def run_eval(
    eval_set: ClassificationEvalSet,
    *,
    label: str = "metadata_rules_v1",
) -> RunResult:
    cases: list[CaseResult] = []
    modality_true: list[str] = []
    modality_pred: list[str] = []
    region_true: list[str] = []
    region_pred: list[str] = []
    species_true: list[str] = []
    species_pred: list[str] = []

    for case in eval_set.cases:
        study = build_study(case)
        suggestion = classify_study(study)

        pred_mod = suggestion.suggested_modality.value
        gold_mod = case.expected.modality.value
        pred_reg = suggestion.suggested_anatomical_region.value
        gold_reg = case.expected.region.value

        modality_true.append(gold_mod)
        modality_pred.append(pred_mod)
        region_true.append(gold_reg)
        region_pred.append(pred_reg)

        species_field: FieldPrediction | None = None
        if case.expected.species is not None:
            gold_sp = case.expected.species.value
            pred_sp = (
                suggestion.suggested_species.value
                if suggestion.suggested_species is not None
                else "__none__"
            )
            species_true.append(gold_sp)
            species_pred.append(pred_sp)
            species_field = FieldPrediction(
                gold=gold_sp,
                pred=pred_sp,
                correct=gold_sp == pred_sp,
            )

        cases.append(
            CaseResult(
                case_id=case.id,
                title=case.title,
                modality=FieldPrediction(
                    gold=gold_mod, pred=pred_mod, correct=gold_mod == pred_mod
                ),
                region=FieldPrediction(
                    gold=gold_reg, pred=pred_reg, correct=gold_reg == pred_reg
                ),
                species=species_field,
                needs_confirmation=suggestion.needs_confirmation,
                disagreement=suggestion.disagreement,
                confidence=suggestion.confidence.value,
                classification_status=suggestion.classification_status.value,
            )
        )

    species_summary = (
        summarize_field(species_true, species_pred) if species_true else None
    )
    summary = EvalSummary(
        modality=summarize_field(modality_true, modality_pred),
        region=summarize_field(region_true, region_pred),
        species=species_summary,
        n_cases=len(cases),
    )
    return RunResult(
        label=label,
        classifier="classify_study",
        summary=summary,
        cases=cases,
    )


def render_markdown(run: RunResult, eval_set: ClassificationEvalSet) -> str:
    lines: list[str] = [
        f"# Classification eval — {eval_set.name or 'set'}",
        "",
        f"_Synthetic / not clinical validation._ {eval_set.note}".strip(),
        "",
        f"- Classifier: `{run.classifier}` (`{run.label}`)",
        f"- Cases: {run.summary.n_cases}",
        f"- Clinical validation: `{run.summary.clinical_validation}`",
        "",
    ]

    def _field_block(name: str, field: FieldSummary) -> None:
        lines.append(f"## {name}")
        lines.append("")
        lines.append(
            f"- Accuracy: **{field.accuracy:.3f}** · Macro-F1: **{field.macro_f1:.3f}** · n={field.n}"
        )
        lines.append("")
        header = "| gold \\ pred | " + " | ".join(field.labels) + " |"
        sep = "|---|" + "|".join("---" for _ in field.labels) + "|"
        lines.append(header)
        lines.append(sep)
        for i, lab in enumerate(field.labels):
            row = "| " + lab + " | " + " | ".join(str(v) for v in field.matrix[i]) + " |"
            lines.append(row)
        lines.append("")
        lines.append("| class | precision | recall | F1 | support |")
        lines.append("|---|---:|---:|---:|---:|")
        for lab, m in field.per_class.items():
            lines.append(
                f"| {lab} | {m['precision']:.3f} | {m['recall']:.3f} | "
                f"{m['f1']:.3f} | {int(m['support'])} |"
            )
        lines.append("")

    _field_block("Modality", run.summary.modality)
    _field_block("Region", run.summary.region)
    if run.summary.species is not None:
        _field_block("Species (cases with gold species only)", run.summary.species)

    lines.append("## Cases")
    lines.append("")
    lines.append("| id | modality | region | species | confirm | disagree |")
    lines.append("|---|---|---|---|---|---|")
    for c in run.cases:
        mod = "✓" if c.modality.correct else f"{c.modality.gold}→{c.modality.pred}"
        reg = "✓" if c.region.correct else f"{c.region.gold}→{c.region.pred}"
        if c.species is None:
            sp = "—"
        elif c.species.correct:
            sp = "✓"
        else:
            sp = f"{c.species.gold}→{c.species.pred}"
        lines.append(
            f"| {c.case_id} | {mod} | {reg} | {sp} | "
            f"{'yes' if c.needs_confirmation else 'no'} | "
            f"{'yes' if c.disagreement else 'no'} |"
        )
    lines.append("")
    return "\n".join(lines)
