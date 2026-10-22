"""Parse and validate remote Vision capability configuration from settings.

Remote coverage is never inferred. When an endpoint is configured, modalities and
regions must be declared explicitly via settings/env.
"""

from __future__ import annotations

from app.routing.capabilities import ModelCapability
from app.schemas.enums import AnatomicalRegion, Modality, SourceKind, Species
from app.settings import Settings


class VisionConfigError(ValueError):
    """Invalid remote Vision configuration (fail fast at startup)."""


def _parse_enum_csv(
    values: tuple[str, ...],
    enum_cls: type,
    *,
    field_name: str,
) -> frozenset:
    if not values:
        raise VisionConfigError(
            f"{field_name} must be declared when a remote Vision endpoint is configured."
        )
    parsed: set = set()
    allowed = {m.value for m in enum_cls}
    for raw in values:
        key = raw.strip()
        if not key:
            continue
        # Accept enum value (MR) or name-like (mr)
        candidates = {key, key.upper(), key.lower()}
        match = None
        for item in enum_cls:
            if item.value in candidates or item.name in {key.upper(), key}:
                match = item
                break
        if match is None:
            raise VisionConfigError(
                f"Unknown {field_name} value {raw!r}. Allowed: {sorted(allowed)}."
            )
        parsed.add(match)
    if not parsed:
        raise VisionConfigError(
            f"{field_name} must include at least one valid value when remote Vision is enabled."
        )
    return frozenset(parsed)


def _parse_species(values: tuple[str, ...]) -> frozenset[Species] | None:
    """Empty tuple → all species (None). Non-empty must be valid Species values."""
    if not values:
        return None
    parsed: set[Species] = set()
    allowed = {s.value for s in Species}
    for raw in values:
        key = raw.strip().lower()
        try:
            parsed.add(Species(key))
        except ValueError as exc:
            raise VisionConfigError(
                f"Unknown vision species {raw!r}. Allowed: {sorted(allowed)}."
            ) from exc
    return frozenset(parsed)


def _parse_source_kind(raw: str) -> SourceKind:
    text = (raw or "real").strip().lower()
    try:
        return SourceKind(text)
    except ValueError as exc:
        raise VisionConfigError(
            f"Unknown vision source_kind {raw!r}. Allowed: {[s.value for s in SourceKind]}."
        ) from exc


def remote_capability_from_settings(settings: Settings) -> ModelCapability | None:
    """Build a REAL ModelCapability from settings, or None when no endpoint is set.

    Raises VisionConfigError when endpoint is set but capability config is invalid/incomplete.
    """
    if not settings.vision_endpoint:
        return None

    model_id = (settings.vision_model_id or "").strip()
    if not model_id:
        raise VisionConfigError("vision_model_id must be non-empty when vision_endpoint is set.")

    modalities = _parse_enum_csv(
        settings.vision_modalities,
        Modality,
        field_name="vision_modalities (VETMIND_VISION_MODALITIES)",
    )
    regions = _parse_enum_csv(
        settings.vision_regions,
        AnatomicalRegion,
        field_name="vision_regions (VETMIND_VISION_REGIONS)",
    )
    species = _parse_species(settings.vision_species)
    source_kind = _parse_source_kind(settings.vision_source_kind)
    priority = int(settings.vision_priority)
    if priority < 0:
        raise VisionConfigError("vision_priority must be >= 0.")

    return ModelCapability(
        model_id=model_id,
        modalities=modalities,
        regions=regions,
        species=species,
        priority=priority,
        enabled=bool(settings.vision_enabled),
        description="Remote HTTP Vision/VLM adapter (configured)",
        source_kind=source_kind,
    )
