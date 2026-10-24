"""Offline evaluation helpers; these do not validate reports for clinical use."""

from app.evaluation.metrics import (
    AnatomicalFinding,
    BoundingBox,
    ClinicalClassificationMetrics,
    ConfusionMatrixStats,
    HallucinationPenaltyReport,
    MedicalHallucinationDetector,
    MetricEvaluationResult,
    RadiologyReportPayload,
    SpatialAndSymmetryEvaluator,
    TemplateAdherenceEvaluator,
)

__all__ = [
    "AnatomicalFinding",
    "BoundingBox",
    "ClinicalClassificationMetrics",
    "ConfusionMatrixStats",
    "HallucinationPenaltyReport",
    "MedicalHallucinationDetector",
    "MetricEvaluationResult",
    "RadiologyReportPayload",
    "SpatialAndSymmetryEvaluator",
    "TemplateAdherenceEvaluator",
]
