"""Configurable local PyTorch Vision adapter — entrypoint bridge, no default weight load.

Register only when ``weights_path`` / module entrypoints are configured by ops.
Failures raise typed ImagingAdapterError subclasses (no silent mock fallback).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from app.models.bridge_resources import ResourceLimits
from app.models.bridge_runner import BridgeAdapterConfig, IntegrationBridge
from app.models.entrypoint import (
    LocalTorchEntrypoint,
    VisionEntrypoint,
    build_entrypoint_from_spec,
)
from app.models.errors import ModelUnavailableError
from app.models.interfaces import ImagingAdapterError, ImagingModel
from app.models.model_input_builder import require_model_input
from app.routing.capabilities import ModelCapability
from app.schemas.case import CaseRecord
from app.schemas.enums import ModelExecutionStatus, SourceKind
from app.schemas.findings import StructuredFindings
from app.schemas.model_outputs import ModelTaskOutputs
from app.storage.quarantine import QuarantineStore


@dataclass(frozen=True)
class LocalTorchConfig:
    """Declarative local inference config. No torch import at construction time."""

    model_id: str
    version: str = "0.0.0-unconfigured"
    weights_path: Optional[str] = None
    entrypoint: Optional[str] = None  # e.g. "package.module:build_model"
    device: str = "cpu"
    input_layout: str = "chw"  # chw | dhw
    requires_pixels: bool = True
    timeout_s: float = 30.0
    window_center: float | None = None
    window_width: float | None = None
    task_capabilities: tuple[str, ...] = (
        "classification",
        "detection",
        "segmentation",
        "measurement",
        "structured_findings",
    )


class LocalTorchVisionAdapter:
    """ImagingModel adapter that runs through IntegrationBridge + VisionEntrypoint."""

    def __init__(
        self,
        config: LocalTorchConfig,
        *,
        capabilities: list[ModelCapability] | None = None,
        quarantine: QuarantineStore | None = None,
        limits: ResourceLimits | None = None,
        artifact_root: Path | None = None,
        entrypoint_instance: VisionEntrypoint | None = None,
    ) -> None:
        self._config = config
        self.model_id = config.model_id
        self.version = config.version
        self._capabilities = list(capabilities or [])
        self._quarantine = quarantine
        self._limits = limits or ResourceLimits(inference_timeout_s=config.timeout_s)
        self._artifact_root = artifact_root
        self._entrypoint_instance = entrypoint_instance

    @property
    def configured(self) -> bool:
        return bool(
            self._entrypoint_instance is not None
            or (self._config.weights_path and self._config.entrypoint)
        )

    @property
    def availability(self) -> str:
        if self._entrypoint_instance is not None:
            return "configured"
        if not self.configured:
            return "not_configured"
        path = Path(self._config.weights_path or "")
        if not path.is_file():
            return "not_configured"
        return "configured"

    def _resolve_entrypoint(self) -> VisionEntrypoint:
        if self._entrypoint_instance is not None:
            return self._entrypoint_instance
        if not self._config.entrypoint:
            raise ModelUnavailableError(
                f"LocalTorchVisionAdapter {self.model_id!r} has no entrypoint. "
                "No silent mock fallback."
            )
        if self._config.entrypoint.strip() in {
            "app.models.entrypoint:LocalTorchEntrypoint",
            "local_torch",
        }:
            return LocalTorchEntrypoint(
                model_id=self.model_id,
                version=self.version,
                weights_path=self._config.weights_path,
                device=self._config.device,
                timeout_s=self._config.timeout_s,
            )
        return build_entrypoint_from_spec(
            self._config.entrypoint,
            weights_path=self._config.weights_path,
            device=self._config.device,
            model_id=self.model_id,
            version=self.version,
            timeout_s=self._config.timeout_s,
        )

    def analyze(self, case: CaseRecord) -> StructuredFindings:
        require_model_input(case)
        if self.availability != "configured":
            raise ModelUnavailableError(
                f"LocalTorchVisionAdapter {self.model_id!r} is not configured "
                "(weights_path + entrypoint required). No silent mock fallback."
            )
        entry = self._resolve_entrypoint()
        bridge = IntegrationBridge(
            capabilities=self._capabilities,
            quarantine=self._quarantine,
            limits=self._limits,
            artifact_root=self._artifact_root,
        )
        return bridge.analyze(
            case,
            BridgeAdapterConfig(
                model_id=self.model_id,
                version=self.version,
                entrypoint=entry,
                requires_pixels=self._config.requires_pixels,
                window_center=self._config.window_center,
                window_width=self._config.window_width,
                keep_tensor_in_memory=False,
            ),
        )

    def describe_readiness(self) -> dict[str, str | bool | list[str]]:
        return {
            "model_id": self.model_id,
            "version": self.version,
            "adapter_kind": "local_torch",
            "availability": self.availability,
            "configured": self.configured,
            "requires_pixels": self._config.requires_pixels,
            "input_layout": self._config.input_layout,
            "device": self._config.device,
            "task_capabilities": list(self._config.task_capabilities),
            "source_kind": SourceKind.REAL.value,
            "note": "Bridge-ready. Weights load only via configured entrypoint.",
        }

    def empty_task_outputs(self, case: CaseRecord) -> ModelTaskOutputs:
        return ModelTaskOutputs(
            model_id=self.model_id,
            model_version=self.version,
            case_id=case.case_id,
            execution_status=ModelExecutionStatus.UNSUPPORTED,
            source_kind=SourceKind.REAL,
            warnings=["Local torch adapter not loaded; empty task outputs for contract probe."],
            processing_metadata={"adapter": "local_torch", "availability": self.availability},
        )


def build_optional_local_torch(
    *,
    model_id: str,
    weights_path: str | None,
    entrypoint: str | None,
    version: str = "0.0.0-unconfigured",
    device: str = "cpu",
    capabilities: list[ModelCapability] | None = None,
    quarantine: QuarantineStore | None = None,
    limits: ResourceLimits | None = None,
) -> ImagingModel | None:
    """Return an adapter only when ops explicitly supplies weights + entrypoint."""
    if not weights_path or not entrypoint:
        return None
    return LocalTorchVisionAdapter(
        LocalTorchConfig(
            model_id=model_id,
            version=version,
            weights_path=weights_path,
            entrypoint=entrypoint,
            device=device,
        ),
        capabilities=capabilities,
        quarantine=quarantine,
        limits=limits,
    )


# Re-export for callers that still import ImagingAdapterError from this module path.
__all__ = [
    "LocalTorchConfig",
    "LocalTorchVisionAdapter",
    "build_optional_local_torch",
    "ImagingAdapterError",
]
