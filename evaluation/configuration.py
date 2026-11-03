"""Immutable, strictly typed policies for the offline Evaluation Core evaluation framework.

These settings are NON-clinical. The configuration intentionally excludes
patient data, case identifiers, filesystem paths, access tokens and free text.
A configuration fingerprint is NOT a claim of anonymization.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Mapping, Any

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, model_validator

from evaluation.fingerprints import configuration_digest
from evaluation.integrity import IntegrityPolicy
from evaluation.versioning import check_contract


class EvaluationConfiguration(BaseModel):
    """Versioned, safe-to-export policy definition; no patient fields."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    schema_version: Literal["1.0.0"] = "1.0.0"
    mode: Literal["structure_only"] = "structure_only"
    require_cases: StrictBool = False
    require_complete_execution: StrictBool = False
    require_kranium_neuro_scope: StrictBool = False
    max_records: StrictInt = Field(default=100_000, ge=1, le=100_000)
    check_backend_contracts: StrictBool = False
    include_record_identifiers_in_reports: Literal[False] = False

    @model_validator(mode="after")
    def check_supported_version(self) -> "EvaluationConfiguration":
        # This package currently has one tested configuration contract.
        if not check_contract("evaluation_manifest", self.schema_version).supported:
            raise ValueError("configuration schema version is unsupported")
        return self

    def integrity_policy(self) -> IntegrityPolicy:
        return IntegrityPolicy(
            require_cases_for_batch=self.require_cases,
            require_complete_execution=self.require_complete_execution,
            require_kranium_neuro_scope=self.require_kranium_neuro_scope,
            max_records=self.max_records,
        )

    def fingerprint(self) -> str:
        """A deterministic SHA-256 of approved NON-clinical settings."""
        return configuration_digest(self.model_dump(mode="json"))


@dataclass(frozen=True)
class ConfigurationComparison:
    identical: bool
    differing_fields: tuple[str, ...]
    first_fingerprint: str
    second_fingerprint: str


def compare_configurations(
    first: EvaluationConfiguration, second: EvaluationConfiguration
) -> ConfigurationComparison:
    """Compare policy fields without comparing case data or exposing values."""
    left, right = first.model_dump(), second.model_dump()
    changed = tuple(sorted(key for key in set(left) | set(right)
                           if left.get(key) != right.get(key)))
    return ConfigurationComparison(
        identical=not changed,
        differing_fields=changed,
        first_fingerprint=first.fingerprint(),
        second_fingerprint=second.fingerprint(),
    )


def validate_configuration(payload: Mapping[str, Any]) -> EvaluationConfiguration:
    """Reject unknown options; do not propagate raw Pydantic errors to logs."""
    if not isinstance(payload, Mapping):
        raise TypeError("configuration must be a mapping")
    return EvaluationConfiguration.model_validate(payload)
