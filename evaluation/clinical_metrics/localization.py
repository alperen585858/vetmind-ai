"""Validated localization concordance for expert-paired 2D image boxes.

Only explicitly confirmed pairs on the same coordinate frame can be scored.
These IoU results are NOT a detection sensitivity, segmentation Dice score,
or proof of anatomical correctness.
"""
from __future__ import annotations

from statistics import fmean, median

from evaluation.metrics.geometry import Box2D, intersection_over_union

from .contracts import EvaluationScope, LocalizationPair
from .results import LocalizationReport


def _unavailable(
    scope: EvaluationScope, iou_threshold: float, blockers: list[str]
) -> LocalizationReport:
    return LocalizationReport(
        assessment_status="not_evaluated", blockers=tuple(dict.fromkeys(blockers)),
        evaluation_id=scope.evaluation_id, model_id=scope.model_id,
        model_version=scope.model_version, dataset_id=scope.provenance.dataset_id,
        target_code=scope.target_code, pair_count=0, iou_threshold=iou_threshold,
    )


def assess_localization(
    scope: EvaluationScope, pairs: list[LocalizationPair], *, iou_threshold: float = 0.5,
) -> LocalizationReport:
    from math import isfinite

    if not isinstance(scope, EvaluationScope):
        raise TypeError("EvaluationScope required")
    if not isfinite(iou_threshold) or not 0 < iou_threshold <= 1:
        raise ValueError("iou_threshold must be finite and in (0, 1]")
    if any(not isinstance(x, LocalizationPair) for x in pairs):
        raise TypeError("LocalizationPair items required")
    blockers = list(scope.blockers)
    if scope.unit_of_analysis != "region":
        blockers.append("localization_requires_region_units")
    if not pairs:
        blockers.append("no_verified_localization_pairs")
    identifiers = [p.pair_id for p in pairs]
    if len(identifiers) != len(set(identifiers)):
        blockers.append("duplicate_localization_pair")
    if any(not p.expert_confirmed_pairing for p in pairs):
        blockers.append("pairing_not_expert_confirmed")
    for p in pairs:
        a, b = p.reference, p.prediction
        if (a.frame_token != b.frame_token or a.image_width != b.image_width
                or a.image_height != b.image_height or a.coordinate_space != b.coordinate_space):
            blockers.append("coordinate_frame_mismatch")
            break
    if blockers:
        return _unavailable(scope, iou_threshold, blockers)

    overlaps: list[float] = []
    for item in pairs:
        a = item.reference
        b = item.prediction
        overlaps.append(intersection_over_union(
            Box2D(a.x_min, a.y_min, a.x_max, a.y_max),
            Box2D(b.x_min, b.y_min, b.x_max, b.y_max),
        ))
    return LocalizationReport(
        assessment_status="ready", evaluation_id=scope.evaluation_id,
        model_id=scope.model_id, model_version=scope.model_version,
        dataset_id=scope.provenance.dataset_id, target_code=scope.target_code,
        pair_count=len(overlaps), iou_threshold=iou_threshold,
        mean_iou=fmean(overlaps), median_iou=median(overlaps),
        threshold_met=sum(score >= iou_threshold for score in overlaps),
    )
