"""Tamper-evidence tests for software preflight events only."""
import pytest
from pydantic import ValidationError

from evaluation.audit_ledger import (
    AuditAction, AuditOutcome, AuditChain, AuditEntry, build_preflight_audit,
)


def test_empty_chain_has_genesis_hash():
    chain = AuditChain()
    assert chain.head_sha256 == "0" * 64
    assert not chain.entries


def test_append_is_immutable():
    original = AuditChain()
    modified = original.append(AuditAction.PREFLIGHT_STARTED, AuditOutcome.PASSED)
    assert not original.entries
    assert len(modified.entries) == 1
    assert modified.head_sha256 != original.head_sha256


def test_append_multiple_preserves_links():
    result = AuditChain().append(AuditAction.PREFLIGHT_STARTED, AuditOutcome.PASSED)
    result = result.append(AuditAction.CONFIGURATION_CHECKED, AuditOutcome.PASSED)
    assert len(result.entries) == 2
    assert result.entries[1].previous_sha256 == result.entries[0].entry_sha256
    assert result.entries[1].sequence == 2


def test_append_same_events_is_deterministic():
    def produce():
        return AuditChain().append(AuditAction.PREFLIGHT_STARTED, AuditOutcome.PASSED)
    assert produce() == produce()


def test_round_trip_preserves_checksum():
    chain = AuditChain().append(AuditAction.PREFLIGHT_STARTED, AuditOutcome.PASSED)
    assert AuditChain.model_validate_json(chain.model_dump_json()) == chain


def test_tampering_with_action_breaks_checksum():
    chain = AuditChain().append(AuditAction.PREFLIGHT_STARTED, AuditOutcome.PASSED)
    entry = chain.entries[0].model_dump()
    entry["action"] = AuditAction.PREFLIGHT_FINISHED.value
    with pytest.raises(ValidationError):
        AuditEntry.model_validate(entry)


def test_tampering_with_outcome_breaks_checksum():
    chain = AuditChain().append(AuditAction.PREFLIGHT_STARTED, AuditOutcome.PASSED)
    entry = chain.entries[0].model_dump()
    entry["outcome"] = AuditOutcome.FAILED.value
    with pytest.raises(ValidationError):
        AuditEntry.model_validate(entry)


def test_missing_entry_breaks_chain():
    chain = AuditChain().append(AuditAction.PREFLIGHT_STARTED, AuditOutcome.PASSED)
    chain = chain.append(AuditAction.CONFIGURATION_CHECKED, AuditOutcome.PASSED)
    with pytest.raises(ValidationError):
        AuditChain(entries=(chain.entries[1],), head_sha256=chain.head_sha256)


def test_changed_head_breaks_chain():
    chain = AuditChain().append(AuditAction.PREFLIGHT_STARTED, AuditOutcome.PASSED)
    with pytest.raises(ValidationError):
        AuditChain(entries=chain.entries, head_sha256="0" * 64)


def test_unknown_action_not_allowed():
    with pytest.raises(TypeError):
        AuditChain().append("some_private_identifying_text", AuditOutcome.PASSED)


def test_unknown_outcome_not_allowed():
    with pytest.raises(TypeError):
        AuditChain().append(AuditAction.PREFLIGHT_STARTED, "a secret")


def test_ledger_has_no_free_text_payload_fields():
    assert set(AuditEntry.model_fields) == {
        "sequence", "action", "outcome", "previous_sha256", "entry_sha256"
    }


def test_preflight_ledger_includes_skipped_backend_check():
    chain = build_preflight_audit(
        config_valid=True, manifest_valid=True, records_valid=True,
        backend_checked=False, backend_compatible=None, final_valid=True,
    )
    assert len(chain.entries) == 6
    assert chain.entries[-2].action == AuditAction.BACKEND_CONTRACTS_CHECKED
    assert chain.entries[-2].outcome == AuditOutcome.SKIPPED
    assert chain.entries[-1].outcome == AuditOutcome.PASSED


def test_preflight_ledger_flags_failed_record_check():
    chain = build_preflight_audit(
        config_valid=True, manifest_valid=True, records_valid=False,
        backend_checked=False, backend_compatible=None, final_valid=False,
    )
    assert chain.entries[3].outcome == AuditOutcome.FAILED
    assert chain.entries[-1].outcome == AuditOutcome.WARNING


def test_preflight_ledger_flags_backend_warning():
    chain = build_preflight_audit(
        config_valid=True, manifest_valid=True, records_valid=True,
        backend_checked=True, backend_compatible=False, final_valid=True,
    )
    assert chain.entries[-2].outcome == AuditOutcome.WARNING
