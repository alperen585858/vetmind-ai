"""Safe entry to existing metrics; lack of expert labels yields no fabricated scores."""
from __future__ import annotations
from dataclasses import dataclass

@dataclass(frozen=True)
class MetricState:
    status: str
    reason: str

def metric_readiness(*, expert_verified: bool, case_count: int) -> MetricState:
    if case_count < 0:
        raise ValueError("case_count must be nonnegative")
    if not expert_verified:
        return MetricState("not_evaluated", "Expert-verified reference labels are unavailable")
    if case_count == 0:
        return MetricState("not_evaluated", "No labeled cases are available")
    return MetricState("ready", "Use existing backend/app/evaluation/metrics.py for calculation")

def project_metrics_engine() -> object:
    """Lazy use of the project's existing implementation; no duplicate metric formulas."""
    from app.evaluation.metrics import ClinicalClassificationMetrics
    return ClinicalClassificationMetrics()
