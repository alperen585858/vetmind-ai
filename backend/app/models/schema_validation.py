"""Secure model configuration + I/O schema validation (no real inference)."""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from app.schemas.model_input import ImagingModelInput
from app.schemas.model_outputs import ModelTaskOutputs


def validate_imaging_model_input(payload: dict[str, Any] | ImagingModelInput) -> ImagingModelInput:
    """Fail closed on malformed AI packages."""
    if isinstance(payload, ImagingModelInput):
        return payload
    try:
        return ImagingModelInput.model_validate(payload)
    except ValidationError as exc:
        raise ValueError(f"ImagingModelInput schema invalid: {exc.error_count()} error(s)") from exc


def validate_model_task_outputs(payload: dict[str, Any] | ModelTaskOutputs) -> ModelTaskOutputs:
    """Ensure adapter outputs match ModelTaskOutputs before findings mapping."""
    if isinstance(payload, ModelTaskOutputs):
        return payload
    try:
        return ModelTaskOutputs.model_validate(payload)
    except ValidationError as exc:
        raise ValueError(f"ModelTaskOutputs schema invalid: {exc.error_count()} error(s)") from exc


def validate_bridge_model_config(config: dict[str, Any]) -> list[str]:
    """Return blocker strings for incomplete real-model configuration (never invents secrets)."""
    blockers: list[str] = []
    model_id = (config.get("model_id") or "").strip()
    if not model_id:
        blockers.append("model_id_missing")
    version = (config.get("version") or "").strip()
    if not version:
        blockers.append("model_version_missing")
    adapter = (config.get("adapter_kind") or "").strip()
    if adapter in {"local_torch", "torch"} and not config.get("weights_path"):
        blockers.append("weights_path_missing")
    if adapter in {"http", "remote_http"} and not config.get("endpoint_url"):
        blockers.append("endpoint_url_missing")
    if config.get("requires_pixels") and not config.get("allows_pixel_analysis"):
        blockers.append("pixel_analysis_not_allowed")
    if config.get("modality") == "CT" and config.get("requires_pixels"):
        if config.get("window_center") is None or config.get("window_width") is None:
            blockers.append("ct_window_unset")
    input_contract = config.get("input_contract_id")
    if input_contract and not str(input_contract).startswith("imaging-model-input"):
        blockers.append("input_contract_mismatch")
    return blockers
