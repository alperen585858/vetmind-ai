"""Guarded, offline clinical metrics for expert-reviewed evaluation datasets.

This module does not validate an AI model, provide diagnoses, or decide whether
its findings may be used clinically. Missing clinical evidence never yields a
passing score. All result objects are aggregate-only.
"""

from .contracts import (
    BinaryObservation,
    EvaluationScope,
    LocalizationBox,
    LocalizationPair,
    ReviewProvenance,
)
from .classification import assess_binary_observations, assess_count_summary
from .localization import assess_localization

__all__ = [
    "BinaryObservation", "EvaluationScope", "LocalizationBox",
    "LocalizationPair", "ReviewProvenance", "assess_binary_observations",
    "assess_count_summary", "assess_localization",
]
