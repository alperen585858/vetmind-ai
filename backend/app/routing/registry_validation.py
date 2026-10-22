"""Startup validation: capability table ↔ ImagingModel registry consistency."""

from __future__ import annotations

from collections import defaultdict

from app.models.interfaces import ImagingModel
from app.routing.capabilities import ModelCapability


class RegistryConsistencyError(RuntimeError):
    """Raised when capability/registry composition is invalid (fail fast at startup)."""


def validate_registry_capabilities(
    capabilities: list[ModelCapability],
    registry: dict[str, ImagingModel],
) -> None:
    """Ensure every enabled capability maps to a registered adapter; detect duplicates."""
    by_id: dict[str, list[ModelCapability]] = defaultdict(list)
    for cap in capabilities:
        by_id[cap.model_id].append(cap)

    for model_id, group in by_id.items():
        if len(group) > 1:
            # Allow identical re-declarations; reject incompatible duplicates.
            first = group[0]
            for other in group[1:]:
                if other != first:
                    raise RegistryConsistencyError(
                        f"Incompatible duplicate capability entries for model_id={model_id!r}."
                    )

        # Validate against any enabled declaration for this id.
        enabled = [c for c in group if c.enabled]
        if not enabled:
            continue
        cap = enabled[0]
        if model_id not in registry:
            raise RegistryConsistencyError(
                f"Enabled capability model_id={model_id!r} has no ImagingModel in the registry. "
                "Register the adapter or disable the capability."
            )
        adapter = registry[model_id]
        adapter_id = getattr(adapter, "model_id", None)
        if adapter_id is not None and adapter_id != model_id:
            raise RegistryConsistencyError(
                f"Registry key {model_id!r} points to adapter with model_id={adapter_id!r}."
            )
