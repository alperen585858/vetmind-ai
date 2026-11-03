"""Read-only comparison against public Pydantic contracts of the VetMind backend.

No backend API, router, container, persistent database or model weights are
modified. Use this check after teammates update the repository schemas.
"""
from __future__ import annotations

import importlib
from dataclasses import dataclass

from evaluation.versioning import check_contract


@dataclass(frozen=True)
class BackendContractCheck:
    contract: str
    status: str
    version: str | None
    missing_fields: tuple[str, ...]
    message: str


# Names from the uploaded repository. The check fails closed if an important
# public field is renamed or removed, even when a version was not bumped.
_CONTRACTS: tuple[tuple[str, str, str, str, tuple[str, ...]], ...] = (
    (
        "structured_findings", "app.schemas.findings", "StructuredFindings",
        "FINDINGS_SCHEMA_VERSION",
        ("schema_version", "case_id", "species", "modality", "anatomical_region",
         "source_kind", "execution_status", "findings", "no_findings_returned",
         "absences_not_confirmed"),
    ),
    (
        "model_outputs", "app.schemas.model_outputs", "ModelTaskOutputs",
        "MODEL_OUTPUTS_SCHEMA_VERSION",
        ("schema_version", "model_id", "model_version", "case_id",
         "source_kind", "execution_status", "detection", "classification"),
    ),
    (
        "draft_report", "app.schemas.report", "DraftReport",
        "REPORT_SCHEMA_VERSION",
        ("schema_version", "case_id", "report_id", "technique", "findings",
         "impression", "recommendations", "expert_review_status"),
    ),
)


def check_backend_contracts() -> tuple[BackendContractCheck, ...]:
    """Inspect current backend contracts and return a diagnostic for each one."""
    results: list[BackendContractCheck] = []
    for name, module_path, model_name, version_name, required_fields in _CONTRACTS:
        try:
            module = importlib.import_module(module_path)
        except ImportError:
            results.append(BackendContractCheck(
                name, "unavailable", None, (),
                "Backend schema dependency is not importable in this environment",
            ))
            continue
        model = getattr(module, model_name, None)
        version = getattr(module, version_name, None)
        if model is None or not hasattr(model, "model_fields") or not isinstance(version, str):
            results.append(BackendContractCheck(
                name, "invalid", version if isinstance(version, str) else None,
                (), "Expected version constant or Pydantic model is absent",
            ))
            continue
        missing = tuple(sorted(set(required_fields) - set(model.model_fields)))
        try:
            version_supported = check_contract(name, version).supported
        except (ValueError, TypeError):
            version_supported = False
        if not version_supported:
            status, message = "incompatible", "Backend contract version is not supported"
        elif missing:
            status, message = "incompatible", "Required public fields are missing"
        else:
            status, message = "compatible", "Expected version and fields are present"
        results.append(BackendContractCheck(name, status, version, missing, message))
    return tuple(results)
