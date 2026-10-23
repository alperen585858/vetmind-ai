"""Model registry view: capability table + adapter presence for readiness APIs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.models.interfaces import ImagingModel
from app.routing.capabilities import (
    AVAILABILITY_AVAILABLE,
    AVAILABILITY_NOT_CONFIGURED,
    ModelCapability,
)


@dataclass(frozen=True)
class ModelRegistryEntry:
    """Readiness snapshot for one model id (species, modality, region, capabilities)."""

    model_id: str
    version: str
    species: tuple[str, ...]
    modalities: tuple[str, ...]
    body_regions: tuple[str, ...]
    input_requirements: tuple[str, ...]
    task_capabilities: tuple[str, ...]
    availability: str
    source_kind: str
    allows_pixel_analysis: bool
    adapter_kind: str
    enabled: bool
    adapter_registered: bool
    description: str
    resource_hint: str
    timeout_s: float
    preprocessing_contract_id: str
    input_contract_id: str
    output_schema_version: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "model_id": self.model_id,
            "version": self.version,
            "species": list(self.species),
            "modalities": list(self.modalities),
            "body_regions": list(self.body_regions),
            "input_requirements": list(self.input_requirements),
            "task_capabilities": list(self.task_capabilities),
            "availability": self.availability,
            "source_kind": self.source_kind,
            "allows_pixel_analysis": self.allows_pixel_analysis,
            "adapter_kind": self.adapter_kind,
            "enabled": self.enabled,
            "adapter_registered": self.adapter_registered,
            "description": self.description,
            "resource_hint": self.resource_hint,
            "timeout_s": self.timeout_s,
            "preprocessing_contract_id": self.preprocessing_contract_id or None,
            "input_contract_id": self.input_contract_id,
            "output_schema_version": self.output_schema_version,
        }


class ModelRegistry:
    """Thin composition helper over capability list + ImagingModel dict."""

    def __init__(
        self,
        capabilities: list[ModelCapability],
        adapters: dict[str, ImagingModel],
    ) -> None:
        self._capabilities = list(capabilities)
        self._adapters = dict(adapters)

    @property
    def adapters(self) -> dict[str, ImagingModel]:
        return dict(self._adapters)

    def list_capabilities(self) -> list[ModelCapability]:
        return list(self._capabilities)

    def entries(self) -> list[ModelRegistryEntry]:
        out: list[ModelRegistryEntry] = []
        seen: set[str] = set()
        for cap in self._capabilities:
            if cap.model_id in seen:
                continue
            seen.add(cap.model_id)
            registered = cap.model_id in self._adapters
            availability = cap.availability
            if cap.enabled and not registered:
                availability = AVAILABILITY_NOT_CONFIGURED
            elif registered and availability == AVAILABILITY_NOT_CONFIGURED:
                availability = AVAILABILITY_AVAILABLE
            species = (
                tuple(sorted(s.value for s in cap.species))
                if cap.species is not None
                else ("*",)
            )
            out.append(
                ModelRegistryEntry(
                    model_id=cap.model_id,
                    version=cap.model_version,
                    species=species,
                    modalities=tuple(sorted(m.value for m in cap.modalities)),
                    body_regions=tuple(sorted(r.value for r in cap.regions)),
                    input_requirements=tuple(sorted(cap.input_requirements)),
                    task_capabilities=tuple(sorted(cap.task_capabilities)),
                    availability=availability,
                    source_kind=cap.source_kind.value,
                    allows_pixel_analysis=cap.allows_pixel_analysis,
                    adapter_kind=cap.adapter_kind,
                    enabled=cap.enabled,
                    adapter_registered=registered,
                    description=cap.description,
                    resource_hint=cap.resource_hint,
                    timeout_s=cap.timeout_s,
                    preprocessing_contract_id=cap.preprocessing_contract_id,
                    input_contract_id=cap.input_contract_id,
                    output_schema_version=cap.output_schema_version,
                )
            )
        # Adapters without capability rows (e.g. manual-review) still surface.
        for mid, adapter in self._adapters.items():
            if mid in seen:
                continue
            out.append(
                ModelRegistryEntry(
                    model_id=mid,
                    version=str(getattr(adapter, "version", "unknown")),
                    species=("*",),
                    modalities=(),
                    body_regions=(),
                    input_requirements=("metadata_only",),
                    task_capabilities=("structured_findings",),
                    availability=AVAILABILITY_AVAILABLE,
                    source_kind="mock",
                    allows_pixel_analysis=False,
                    adapter_kind="manual" if mid == "manual-review" else "unknown",
                    enabled=True,
                    adapter_registered=True,
                    description="Registry adapter without capability declaration",
                    resource_hint="cpu",
                    timeout_s=0.0,
                    preprocessing_contract_id="",
                    input_contract_id="imaging-model-input/1.0.0",
                    output_schema_version="1.1.0",
                )
            )
        out.sort(key=lambda e: (not e.enabled, e.model_id))
        return out

    def readiness_payload(self) -> dict[str, Any]:
        entries = self.entries()
        return {
            "schema_version": "1.0.0",
            "model_count": len(entries),
            "enabled_count": sum(1 for e in entries if e.enabled),
            "pixel_analysis_default": False,
            "note": (
                "AI model readiness inventory. "
                "availability=synthetic is for contract probes only. "
                "source_kind=real does not imply clinical validation. "
                "Pixel access remains default-deny."
            ),
            "models": [e.to_dict() for e in entries],
        }
