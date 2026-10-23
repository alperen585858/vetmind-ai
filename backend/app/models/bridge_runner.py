"""Integration bridge: prep → entrypoint → validated structured results."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.imaging.contracts import PreprocessingContract
from app.imaging.profiles import profile_for_modality
from app.models.bridge_resources import ArtifactWorkspace, ResourceLimits
from app.models.entrypoint import (
    InferenceRequest,
    VisionEntrypoint,
    inference_request_from_case,
)
from app.models.errors import (
    IncompatibleInputError,
    InferenceFailedError,
    InferenceTimeoutError,
    ModelUnavailableError,
)
from app.models.pixel_bridge import AuthorizedPixelBridge
from app.models.task_output_mapper import map_task_outputs_to_findings
from app.routing.capabilities import ModelCapability
from app.schemas.case import CaseRecord
from app.schemas.findings import StructuredFindings
from app.schemas.model_outputs import ModelTaskOutputs
from app.storage.quarantine import QuarantineStore


@dataclass(frozen=True)
class BridgeAdapterConfig:
    """Per-adapter bridge configuration (local torch or HTTP)."""

    model_id: str
    version: str
    entrypoint: VisionEntrypoint
    requires_pixels: bool = False
    capability: ModelCapability | None = None
    window_center: float | None = None
    window_width: float | None = None
    transmit_pixels: bool = False
    keep_tensor_in_memory: bool = False
    contract: PreprocessingContract | None = None


class IntegrationBridge:
    """Runs authorized prep + entrypoint inference with guaranteed artifact cleanup."""

    def __init__(
        self,
        *,
        capabilities: list[ModelCapability],
        quarantine: QuarantineStore | None = None,
        limits: ResourceLimits | None = None,
        artifact_root: Path | None = None,
    ) -> None:
        self._limits = limits or ResourceLimits()
        root = artifact_root
        if root is None and quarantine is not None:
            root = quarantine.root / "_bridge_tmp"
        self._artifact_root = root
        self._pixel = AuthorizedPixelBridge(
            quarantine=quarantine,
            capabilities=capabilities,
            limits=self._limits,
            artifact_root=root,
        )

    def analyze(self, case: CaseRecord, config: BridgeAdapterConfig) -> StructuredFindings:
        workspace: ArtifactWorkspace | None = None
        try:
            if self._artifact_root is not None:
                workspace = ArtifactWorkspace(self._artifact_root, case_id=case.case_id)

            if not config.entrypoint.is_ready():
                try:
                    config.entrypoint.load()
                except ModelUnavailableError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    raise ModelUnavailableError(
                        f"Failed to load entrypoint for {config.model_id!r}: {type(exc).__name__}."
                    ) from exc
            if not config.entrypoint.is_ready():
                raise ModelUnavailableError(f"Entrypoint for {config.model_id!r} is not ready.")

            prepared = None
            if config.requires_pixels:
                contract = config.contract or profile_for_modality(
                    case.modality,
                    config.model_id,
                    version=config.version,
                    regions=frozenset({case.anatomical_region}),
                    species=frozenset({case.species}),
                )
                # CT profile requires explicit WW/WC
                wc, ww = config.window_center, config.window_width
                if case.modality.value == "CT" and "hu_window" in contract.allowed_transforms:
                    if wc is None or ww is None:
                        raise IncompatibleInputError(
                            "CT profile requires window_center and window_width; "
                            "no silent clinical presets."
                        )
                prepared = self._pixel.prepare_for_model(
                    case,
                    model_id=config.model_id,
                    contract=contract,
                    window_center=wc,
                    window_width=ww,
                    keep_tensor_in_memory=config.keep_tensor_in_memory,
                    workspace=workspace,
                )

            request: InferenceRequest = inference_request_from_case(
                case,
                model_id=config.model_id,
                model_version=config.version,
                prepared=prepared,
                transmit_pixels=config.transmit_pixels,
            )
            try:
                result = config.entrypoint.infer(request)
            except (InferenceTimeoutError, InferenceFailedError, ModelUnavailableError, IncompatibleInputError):
                raise
            except Exception as exc:  # noqa: BLE001
                raise InferenceFailedError(
                    f"Entrypoint infer failed: {type(exc).__name__}: {exc}"
                ) from exc

            if isinstance(result, StructuredFindings):
                findings = result
            elif isinstance(result, ModelTaskOutputs):
                from app.models.schema_validation import validate_model_task_outputs

                try:
                    result = validate_model_task_outputs(result)
                except ValueError as exc:
                    raise InferenceFailedError(str(exc)) from exc
                findings = map_task_outputs_to_findings(case, result)
            else:
                raise InferenceFailedError(
                    "Entrypoint returned unsupported result type "
                    "(expected ModelTaskOutputs or StructuredFindings)."
                )

            meta: dict[str, str] = {
                **findings.processing_metadata,
                "bridge": "integration_bridge/1.0.0",
                "requires_pixels": "true" if config.requires_pixels else "false",
                "model_id": config.model_id,
                "model_version": config.version,
            }
            if case.model_input is not None and case.model_input.selection:
                sel = case.model_input.selection
                meta["selection_mode"] = sel.mode
                meta["profile_hint"] = sel.profile_hint
                meta["selected_series"] = ",".join(sel.series_instance_uids)
                meta["linked_ingests"] = ",".join(sel.linked_ingest_ids)
            if prepared is not None:
                meta["prep_contract"] = prepared.provenance.contract_id
                meta["tensor_shape"] = "x".join(str(x) for x in prepared.tensor_shape)
                meta["pixels_loaded"] = "true" if prepared.provenance.pixels_loaded else "false"
            findings.processing_metadata = meta
            # Never silently replace failed real outputs with mock findings.
            if findings.source_kind and str(findings.source_kind.value) == "real":
                if not findings.source_model_id:
                    findings.source_model_id = config.model_id
                if not findings.source_model_version:
                    findings.source_model_version = config.version
            return findings
        finally:
            if workspace is not None:
                workspace.close()


def run_bridge_analyze(
    case: CaseRecord,
    config: BridgeAdapterConfig,
    *,
    capabilities: list[ModelCapability],
    quarantine: QuarantineStore | None = None,
    limits: ResourceLimits | None = None,
    artifact_root: Path | None = None,
) -> StructuredFindings:
    """Functional helper for adapters/tests."""
    return IntegrationBridge(
        capabilities=capabilities,
        quarantine=quarantine,
        limits=limits,
        artifact_root=artifact_root,
    ).analyze(case, config)
