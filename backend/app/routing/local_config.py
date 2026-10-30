"""Parse optional local PyTorch Vision capability from settings."""

from __future__ import annotations

from pathlib import Path

from app.routing.capabilities import (
    AVAILABILITY_AVAILABLE,
    AVAILABILITY_NOT_CONFIGURED,
    INPUT_PIXELS_2D,
    INPUT_PIXELS_3D,
    ModelCapability,
    TASK_STRUCTURED_FINDINGS,
)
from app.routing.remote_config import VisionConfigError, _parse_enum_csv, _parse_source_kind, _parse_species
from app.schemas.enums import AnatomicalRegion, Modality, SourceKind
from app.settings import Settings


def local_capability_from_settings(settings: Settings) -> ModelCapability | None:
    """Return a local_torch capability when model id + entrypoint are declared."""
    model_id = (settings.local_torch_model_id or "").strip()
    entrypoint = (settings.local_torch_entrypoint or "").strip()
    if not model_id or not entrypoint:
        return None

    modalities = _parse_enum_csv(
        settings.local_torch_modalities,
        Modality,
        field_name="local_torch_modalities (VETMIND_LOCAL_TORCH_MODALITIES)",
    )
    regions = _parse_enum_csv(
        settings.local_torch_regions,
        AnatomicalRegion,
        field_name="local_torch_regions (VETMIND_LOCAL_TORCH_REGIONS)",
    )
    species = _parse_species(settings.local_torch_species)
    source_kind = _parse_source_kind(settings.local_torch_source_kind)

    needs_3d = Modality.MR in modalities or Modality.CT in modalities
    input_req = frozenset({INPUT_PIXELS_3D if needs_3d else INPUT_PIXELS_2D})

    weights = (settings.local_torch_weights_path or "").strip()
    availability = AVAILABILITY_AVAILABLE
    if weights:
        if not Path(weights).is_file():
            availability = AVAILABILITY_NOT_CONFIGURED
    else:
        availability = AVAILABILITY_NOT_CONFIGURED

    profile = "profile.mri_volume" if needs_3d else "profile.xray_2d"
    if modalities == frozenset({Modality.XR}):
        profile = "profile.xray_2d"
    elif Modality.CT in modalities:
        profile = "profile.ct_volume"

    return ModelCapability(
        model_id=model_id,
        modalities=modalities,
        regions=regions,
        species=species,
        priority=int(settings.local_torch_priority),
        enabled=bool(settings.local_torch_enabled),
        description="Local PyTorch Vision adapter (configured via env)",
        source_kind=source_kind if source_kind != SourceKind.MOCK else SourceKind.REAL,
        allows_pixel_analysis=True,
        model_version=settings.local_torch_model_version,
        input_contract_id="imaging-model-input/1.1.0",
        output_schema_version="1.1.0",
        timeout_s=float(settings.local_torch_timeout_s),
        resource_hint="gpu" if settings.local_torch_device != "cpu" else "cpu",
        task_capabilities=frozenset({TASK_STRUCTURED_FINDINGS}),
        input_requirements=input_req,
        availability=availability,
        adapter_kind="local_torch",
        preprocessing_contract_id=profile,
    )


def validate_local_torch_settings(settings: Settings) -> None:
    """Fail fast when partial local torch env is inconsistent."""
    model_id = (settings.local_torch_model_id or "").strip()
    entrypoint = (settings.local_torch_entrypoint or "").strip()
    weights = (settings.local_torch_weights_path or "").strip()
    if any([model_id, entrypoint, weights]) and not (model_id and entrypoint):
        raise VisionConfigError(
            "local_torch requires VETMIND_LOCAL_TORCH_MODEL_ID and "
            "VETMIND_LOCAL_TORCH_ENTRYPOINT when any local torch env is set."
        )
