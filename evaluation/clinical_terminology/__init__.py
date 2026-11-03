"""Clinical-domain terminology infrastructure (Clinical Terminology).

Nothing in this package implies clinical validation, expert approval, or a
known 13-section reporting standard.
"""
from evaluation.clinical_terminology.catalog import TermCatalog, TermEntry, TermScope
from evaluation.clinical_terminology.resolver import CatalogResolver, TermResolution
from evaluation.clinical_terminology.laterality import LateralitySignal, detect_laterality
from evaluation.clinical_terminology.pairing import PairingResult, pair_findings

__all__ = [
    "TermCatalog", "TermEntry", "TermScope", "CatalogResolver", "TermResolution",
    "LateralitySignal", "detect_laterality", "PairingResult", "pair_findings",
]
