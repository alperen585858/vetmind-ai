"""Model registry view: capability table + adapter presence for readiness APIs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.models.interfaces import ImagingModel
from app.models.schema_validation import validate_bridge_model_config
from app.routing.capabilities import (
    AVAILABILITY_AVAILABLE,
    AVAILABILITY_NOT_CONFIGURED,
    AVAILABILITY_SYNTHETIC,
    INPUT_PIXELS_2D,
    INPUT_PIXELS_3D,
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

    def blockers(self) -> list[str]:
        """Integration blockers for readiness UI (missing config / policy)."""
        blockers: list[str] = []
        if not self.enabled:
            blockers.append("disabled")
        if not self.adapter_registered:
            blockers.append("adapter_missing")
        if self.availability == AVAILABILITY_NOT_CONFIGURED:
            blockers.append("not_configured")
        if self.availability == AVAILABILITY_SYNTHETIC:
            blockers.append("synthetic_probe_only")
        needs_pixels = bool(set(self.input_requirements) & {INPUT_PIXELS_2D, INPUT_PIXELS_3D})
        if needs_pixels and not self.allows_pixel_analysis:
            blockers.append("pixel_analysis_denied_by_capability")
        if not self.preprocessing_contract_id and needs_pixels:
            blockers.append("preprocessing_contract_missing")
        cfg: dict[str, Any] = {
            "model_id": self.model_id,
            "version": self.version,
            "adapter_kind": self.adapter_kind,
            "requires_pixels": needs_pixels,
            "allows_pixel_analysis": self.allows_pixel_analysis,
            "input_contract_id": self.input_contract_id,
        }
        if self.modalities == ("CT",):
            cfg["modality"] = "CT"
        blockers.extend(validate_bridge_model_config(cfg))
        # Deduplicate preserving order
        seen: set[str] = set()
        out: list[str] = []
        for b in blockers:
            if b not in seen:
                seen.add(b)
                out.append(b)
        return out

    def to_dict(self) -> dict[str, Any]:
        bl = self.blockers()
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
            "blockers": bl,
            "ready_for_real_integration": len(bl) == 0 and self.source_kind == "real",
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
            adapter = self._adapters.get(cap.model_id)
            if registered and cap.adapter_kind == "local_torch" and hasattr(adapter, "availability"):
                if getattr(adapter, "availability", "") != "configured":
                    availability = AVAILABILITY_NOT_CONFIGURED
            if cap.enabled and not registered:
                availability = AVAILABILITY_NOT_CONFIGURED
            elif (
                registered
                and availability == AVAILABILITY_NOT_CONFIGURED
                and cap.adapter_kind != "local_torch"
            ):
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
        models = [e.to_dict() for e in entries]
        blocked = sum(1 for m in models if m.get("blockers"))
        return {
            "schema_version": "1.1.0",
            "model_count": len(entries),
            "enabled_count": sum(1 for e in entries if e.enabled),
            "models_with_blockers": blocked,
            "pixel_analysis_default": False,
            "note": (
                "AI model readiness inventory. "
                "availability=synthetic is for contract probes only. "
                "source_kind=real does not imply clinical validation. "
                "Pixel access remains default-deny. "
                "blockers list missing configuration / integration prerequisites."
            ),
            "models": models,
            "remaining_steps_to_first_real_model": [
                "Register a ModelCapability with source_kind=real and allows_pixel_analysis only after legal/ethics review",
                "Provide weights_path (local_torch) or endpoint_url (HTTP) via secure env — never commit secrets",
                "Set preprocessing_contract_id to profile.mri_volume / profile.ct_volume / profile.xray_2d",
                "For CT: supply explicit window_center/window_width at analyze time (no silent presets)",
                "Confirm case imaging_source_permission_verified + imaging_analysis_consent_verified",
                "Verify multi-ingest DICOM merge + series selection on /cases/{id}/model-input",
                "Run IntegrationBridge path (not mock adapter) and refuse analyze on typed errors (no fake findings)",
                "Expert-review approved reports remain immutable",
            ],
        }
