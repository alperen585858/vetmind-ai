"""Align metric runs with the existing VetMind evaluation manifest.

Agreement between two metadata contracts does not authenticate clinical data.
This is a guard against accidental model/dataset/version mixing only.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Literal

from evaluation.contracts import EvaluationManifest
from .contracts import EvaluationScope


@dataclass(frozen=True, slots=True)
class ManifestAlignment:
    status: Literal["aligned", "blocked"]
    issues: tuple[str, ...]
    clinical_validation: Literal["not_evaluated"] = "not_evaluated"


def check_manifest_alignment(manifest: EvaluationManifest, scope: EvaluationScope) -> ManifestAlignment:
    if not isinstance(manifest, EvaluationManifest) or not isinstance(scope, EvaluationScope):
        raise TypeError("EvaluationManifest and EvaluationScope required")
    problems: list[str] = []
    for attr, code in (
        ("evaluation_id", "evaluation_id_mismatch"),
        ("model_id", "model_id_mismatch"),
        ("model_version", "model_version_mismatch"),
    ):
        if getattr(manifest, attr) != getattr(scope, attr):
            problems.append(code)
    p = scope.provenance
    if manifest.dataset_id != p.dataset_id or manifest.dataset_version != p.dataset_version:
        problems.append("dataset_identity_mismatch")
    if manifest.reference_status != p.reference_status:
        problems.append("reference_review_status_mismatch")
    if manifest.task not in ("classification", "detection"):
        problems.append("unsupported_metric_task")
    return ManifestAlignment("blocked" if problems else "aligned", tuple(problems))
