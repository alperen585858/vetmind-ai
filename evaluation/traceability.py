"""Non-identifying, reproducible metadata receipts for Evaluation Core evaluation runs.

IMPORTANT: These receipts deliberately do not contain case IDs, DICOM UIDs,
file paths, clinical text, owners, report content or actual patient images.
A digest of personal data does not make that data anonymous; this module never
hashes any patient or per-case data.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Sequence

from pydantic import BaseModel, ConfigDict, Field, model_validator

from evaluation.configuration import EvaluationConfiguration
from evaluation.contracts import EvaluationManifest, EvaluationRecord
from evaluation.fingerprints import configuration_digest, policy_manifest_digest, schema_digest



class TraceReceipt(BaseModel):
    """Machine-readable evidence of software settings, NOT clinical validity."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    receipt_version: Literal["1.0.0"] = "1.0.0"
    evaluation_contract_version: Literal["1.0.0"] = "1.0.0"
    configuration_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    manifest_policy_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    manifest_schema_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    record_schema_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    record_count: int = Field(ge=0, le=100_000)
    reference_declared: Literal["unavailable", "pending_expert_review", "expert_verified"]
    dataset_identifier_present: bool
    report_template_identifier_present: bool
    record_sources: tuple[Literal["mock", "real", "mixed", "manual"], ...] = ()
    clinical_validation_status: Literal["not_evaluated"] = "not_evaluated"
    receipt_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def validate_receipt_hash(self) -> "TraceReceipt":
        # Detect accidental modifications of an exported receipt. Not an HMAC
        # or an authenticated signature, so not protection against an attacker.
        body = self.model_dump(mode="json", exclude={"receipt_sha256"})
        if configuration_digest(body) != self.receipt_sha256:
            raise ValueError("trace receipt checksum mismatch")
        return self

    def verified_checksum(self) -> bool:
        body = self.model_dump(mode="json", exclude={"receipt_sha256"})
        return configuration_digest(body) == self.receipt_sha256


def create_receipt(
    configuration: EvaluationConfiguration,
    manifest: EvaluationManifest,
    records: Sequence[EvaluationRecord] = (),
) -> TraceReceipt:
    """Create a self-consistent structural receipt without case-level payloads."""
    if len(records) > configuration.max_records:
        raise ValueError("number of records exceeds configured limit")
    body = dict(
        receipt_version="1.0.0",
        evaluation_contract_version=manifest.schema_version,
        configuration_sha256=configuration.fingerprint(),
        manifest_policy_sha256=policy_manifest_digest(manifest),
        manifest_schema_sha256=schema_digest(EvaluationManifest),
        record_schema_sha256=schema_digest(EvaluationRecord),
        record_count=len(records),
        reference_declared=manifest.reference_status,
        dataset_identifier_present=manifest.dataset_id is not None,
        report_template_identifier_present=manifest.report_template_id is not None,
        record_sources=tuple(sorted({record.source_kind for record in records})),
        clinical_validation_status="not_evaluated",
    )
    return TraceReceipt(**body, receipt_sha256=configuration_digest(body))


@dataclass(frozen=True)
class TraceComparison:
    same_configuration: bool
    same_contracts: bool
    same_manifest_policy: bool
    same_record_count: bool
    same_source_kinds: bool
    clinical_results_comparable: bool = False  # No labels or model testing yet


def compare_receipts(first: TraceReceipt, second: TraceReceipt) -> TraceComparison:
    """Compare run reproducibility settings, NOT clinical model performance."""
    return TraceComparison(
        same_configuration=first.configuration_sha256 == second.configuration_sha256,
        same_contracts=(first.manifest_schema_sha256 == second.manifest_schema_sha256
                        and first.record_schema_sha256 == second.record_schema_sha256),
        same_manifest_policy=(first.manifest_policy_sha256 == second.manifest_policy_sha256),
        same_record_count=first.record_count == second.record_count,
        same_source_kinds=first.record_sources == second.record_sources,
    )
