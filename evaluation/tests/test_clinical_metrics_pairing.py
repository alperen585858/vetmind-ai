from __future__ import annotations
import pytest
from evaluation.clinical_metrics.pairing_audit import inspect_pairing
from evaluation.clinical_terminology.pairing import PairingResult, FindingLink


def test_pairing_adapter_retains_no_clinical_scores():
    pairing=PairingResult(status="needs_review",matches=(FindingLink("ref","pred","c","a"),),
                          unmatched_reference_ids=("ref2",),unmatched_prediction_ids=("pred2",),
                          unresolved_reference_ids=("ref2",),unresolved_prediction_ids=())
    audit=inspect_pairing(pairing)
    assert audit.status=="requires_reference_review"
    assert audit.matched_count==1
    assert audit.unmatched_reference_count==1
    assert audit.clinical_metrics is None


def test_empty_pairing_not_evaluated():
    pairing=PairingResult(status="not_evaluated", matches=(),
                          unmatched_reference_ids=(),unmatched_prediction_ids=(),
                          unresolved_reference_ids=(),unresolved_prediction_ids=())
    assert inspect_pairing(pairing).status=="not_evaluated"


def test_pairing_wrong_type():
    with pytest.raises(TypeError):
        inspect_pairing(object())
