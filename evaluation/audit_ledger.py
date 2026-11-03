"""Tamper-evident (not tamper-proof) offline software preflight audit receipts.

Only enumerated, non-identifying events can be recorded. This is NOT the
production clinical/audit log and does not establish who authorized a report.
No patient metadata, report text, case identifiers or access tokens are accepted.
"""
from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from evaluation.fingerprints import configuration_digest


class AuditAction(str, Enum):
    PREFLIGHT_STARTED = "preflight_started"
    CONFIGURATION_CHECKED = "configuration_checked"
    MANIFEST_CHECKED = "manifest_checked"
    RECORD_STRUCTURE_CHECKED = "record_structure_checked"
    BACKEND_CONTRACTS_CHECKED = "backend_contracts_checked"
    PREFLIGHT_FINISHED = "preflight_finished"


class AuditOutcome(str, Enum):
    PASSED = "passed"
    WARNING = "warning"
    FAILED = "failed"
    SKIPPED = "skipped"


_GENESIS = "0" * 64


class AuditEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    sequence: int = Field(ge=1)
    action: AuditAction
    outcome: AuditOutcome
    previous_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    entry_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode="after")
    def verify_entry(self) -> "AuditEntry":
        payload = self.model_dump(mode="json", exclude={"entry_sha256"})
        if configuration_digest(payload) != self.entry_sha256:
            raise ValueError("audit entry checksum mismatch")
        return self


class AuditChain(BaseModel):
    """An immutable chain representing only structural preflight operations."""
    model_config = ConfigDict(extra="forbid", frozen=True)
    schema_version: Literal["1.0.0"] = "1.0.0"
    entries: tuple[AuditEntry, ...] = ()
    head_sha256: str = Field(default=_GENESIS, pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode="after")
    def verify_links(self) -> "AuditChain":
        expected_previous = _GENESIS
        for index, entry in enumerate(self.entries, 1):
            if entry.sequence != index or entry.previous_sha256 != expected_previous:
                raise ValueError("audit chain sequence or link mismatch")
            expected_previous = entry.entry_sha256
        if self.head_sha256 != expected_previous:
            raise ValueError("audit chain head mismatch")
        return self

    def append(self, action: AuditAction, outcome: AuditOutcome) -> "AuditChain":
        if not isinstance(action, AuditAction) or not isinstance(outcome, AuditOutcome):
            raise TypeError("audit action/outcome must use declared enums")
        payload = dict(
            sequence=len(self.entries) + 1,
            action=action.value,
            outcome=outcome.value,
            previous_sha256=self.head_sha256,
        )
        entry = AuditEntry(**payload, entry_sha256=configuration_digest(payload))
        return AuditChain(entries=self.entries + (entry,), head_sha256=entry.entry_sha256)


def build_preflight_audit(
    *, config_valid: bool, manifest_valid: bool, records_valid: bool,
    backend_checked: bool, backend_compatible: bool | None,
    final_valid: bool,
) -> AuditChain:
    """Build a deterministic, PHI-free ledger from boolean software decisions."""
    result = AuditChain().append(AuditAction.PREFLIGHT_STARTED, AuditOutcome.PASSED)
    steps = (
        (AuditAction.CONFIGURATION_CHECKED, AuditOutcome.PASSED if config_valid else AuditOutcome.FAILED),
        (AuditAction.MANIFEST_CHECKED, AuditOutcome.PASSED if manifest_valid else AuditOutcome.FAILED),
        (AuditAction.RECORD_STRUCTURE_CHECKED, AuditOutcome.PASSED if records_valid else AuditOutcome.FAILED),
        (AuditAction.BACKEND_CONTRACTS_CHECKED,
         AuditOutcome.SKIPPED if not backend_checked else
         (AuditOutcome.PASSED if backend_compatible else AuditOutcome.WARNING)),
        (AuditAction.PREFLIGHT_FINISHED, AuditOutcome.PASSED if final_valid else AuditOutcome.WARNING),
    )
    for action, outcome in steps:
        result = result.append(action, outcome)
    return result
