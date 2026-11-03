"""Deterministic checksums for non-identifying configuration artifacts.

Do not feed patient records, owner details or raw clinical text into a hash and
assume it is anonymized. Hashing personal data is not de-identification.
"""
from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Mapping
from typing import Any

from evaluation.contracts import EvaluationManifest


_ALLOWED_CONFIG_TYPES = (str, bool, int, float, type(None))


def _safe_configuration(value: Any, *, depth: int = 0) -> Any:
    if depth > 20:
        raise ValueError("configuration nesting exceeds 20 levels")
    if isinstance(value, Mapping):
        if len(value) > 1024:
            raise ValueError("configuration has too many keys")
        if any(not isinstance(key, str) for key in value):
            raise TypeError("configuration keys must be strings")
        return {key: _safe_configuration(item, depth=depth+1)
                for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        if len(value) > 10_000:
            raise ValueError("configuration list too long")
        return [_safe_configuration(item, depth=depth+1) for item in value]
    if type(value) not in _ALLOWED_CONFIG_TYPES:
        raise TypeError(f"unsupported configuration type: {type(value).__name__}")
    if type(value) is float and not math.isfinite(value):
        raise ValueError("nonfinite configuration value")
    return value


def configuration_digest(settings: Mapping[str, Any]) -> str:
    """Hash only caller-supplied, reviewed, non-personal settings."""
    sanitized = _safe_configuration(settings)
    canonical = json.dumps(sanitized, sort_keys=True, separators=(",", ":"),
                           ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(("vetmind-config-v1\n" + canonical).encode("utf-8")).hexdigest()


def schema_digest(contract: type) -> str:
    """Fingerprint a Pydantic model's public JSON Schema, not any patient values."""
    if not hasattr(contract, "model_json_schema"):
        raise TypeError("contract must be a Pydantic model class")
    return configuration_digest(contract.model_json_schema())


def policy_manifest_digest(manifest: EvaluationManifest) -> str:
    """Fingerprint non-identifying policy fields only, excluding dataset identifiers."""
    return configuration_digest({
        "schema_version": manifest.schema_version,
        "task": manifest.task,
        "reference_status": manifest.reference_status,
        "template_version_present": manifest.report_template_version is not None,
        "dataset_version_present": manifest.dataset_version is not None,
    })
