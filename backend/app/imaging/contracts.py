"""Per-model preprocessing contracts. Do not invent transforms without a contract."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.schemas.enums import AnatomicalRegion, Modality, Species


@dataclass(frozen=True)
class PreprocessingContract:
    """Declares what a future Vision adapter is allowed to do to pixels.

    Metadata-only mocks use ``requires_pixels=False`` and an empty transform list.
    """

    contract_id: str
    model_id: str
    model_version: str
    modalities: frozenset[Modality]
    regions: frozenset[AnatomicalRegion]
    species: Optional[frozenset[Species]] = None
    requires_pixels: bool = False
    allowed_transfer_syntaxes: frozenset[str] = field(default_factory=frozenset)
    # Named ops only — never apply without listing here (e.g. "hu_window", "resample_iso").
    allowed_transforms: tuple[str, ...] = ()
    output_tensor_layout: str = "none"  # none | chw | dhw | ndhwc
    notes: str = (
        "No medically significant transform may run unless listed in allowed_transforms "
        "and pixel access is authorized."
    )


@dataclass(frozen=True)
class TransformProvenance:
    """Audit trail for any future pixel prep step (never invent silent transforms)."""

    contract_id: str
    steps: tuple[str, ...] = ()
    source_sop_uids: tuple[str, ...] = ()
    pixels_loaded: bool = False
    authorization_reason_codes: tuple[str, ...] = ()
    note: str = "Provenance only. Empty steps means metadata package only."


def metadata_only_contract(model_id: str, *, version: str = "1.0.0") -> PreprocessingContract:
    return PreprocessingContract(
        contract_id=f"meta-only:{model_id}",
        model_id=model_id,
        model_version=version,
        modalities=frozenset(),
        regions=frozenset(),
        requires_pixels=False,
        allowed_transforms=(),
        output_tensor_layout="none",
        notes="Metadata-only contract — pixels must not be decoded.",
    )


def pixel_2d_contract(
    model_id: str,
    *,
    version: str = "1.0.0",
    modalities: frozenset[Modality] | None = None,
    regions: frozenset[AnatomicalRegion] | None = None,
    species: frozenset[Species] | None = None,
    transfer_syntaxes: frozenset[str] | None = None,
) -> PreprocessingContract:
    """Future 2D Vision contract. Still requires pixel authorization at runtime."""
    from app.imaging.pixel_ops import (
        TRANSFORM_EXTRACT_PIXELS,
        TRANSFORM_HU_WINDOW,
        TRANSFORM_MONOCHROME_INVERT,
        TRANSFORM_NORMALIZE,
        TRANSFORM_PREPARE_2D,
    )

    return PreprocessingContract(
        contract_id=f"pixel-2d:{model_id}",
        model_id=model_id,
        model_version=version,
        modalities=modalities or frozenset(),
        regions=regions or frozenset(),
        species=species,
        requires_pixels=True,
        allowed_transfer_syntaxes=transfer_syntaxes or frozenset(),
        allowed_transforms=(
            TRANSFORM_EXTRACT_PIXELS,
            TRANSFORM_MONOCHROME_INVERT,
            TRANSFORM_HU_WINDOW,
            TRANSFORM_NORMALIZE,
            TRANSFORM_PREPARE_2D,
        ),
        output_tensor_layout="chw",
        notes="2D pixel contract — decode only after authorization.",
    )


def pixel_3d_contract(
    model_id: str,
    *,
    version: str = "1.0.0",
    modalities: frozenset[Modality] | None = None,
    regions: frozenset[AnatomicalRegion] | None = None,
    species: frozenset[Species] | None = None,
    transfer_syntaxes: frozenset[str] | None = None,
) -> PreprocessingContract:
    """Future MRI/CT volume contract. Still requires pixel authorization at runtime."""
    from app.imaging.pixel_ops import (
        TRANSFORM_APPLY_SPACING,
        TRANSFORM_EXTRACT_PIXELS,
        TRANSFORM_MONOCHROME_INVERT,
        TRANSFORM_NORMALIZE,
        TRANSFORM_ORDER_SLICES,
        TRANSFORM_PREPARE_3D,
    )

    return PreprocessingContract(
        contract_id=f"pixel-3d:{model_id}",
        model_id=model_id,
        model_version=version,
        modalities=modalities or frozenset(),
        regions=regions or frozenset(),
        species=species,
        requires_pixels=True,
        allowed_transfer_syntaxes=transfer_syntaxes or frozenset(),
        allowed_transforms=(
            TRANSFORM_EXTRACT_PIXELS,
            TRANSFORM_MONOCHROME_INVERT,
            TRANSFORM_ORDER_SLICES,
            TRANSFORM_APPLY_SPACING,
            TRANSFORM_NORMALIZE,
            TRANSFORM_PREPARE_3D,
        ),
        output_tensor_layout="dhw",
        notes="3D volume contract — assemble/order only after authorization.",
    )
