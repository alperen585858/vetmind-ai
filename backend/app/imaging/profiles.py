"""Model-specific preprocessing profiles for MRI, CT, and X-ray.

Profiles are PreprocessingContract factories. They do not authorize or decode pixels.
"""

from __future__ import annotations

from app.imaging.contracts import PreprocessingContract, pixel_2d_contract, pixel_3d_contract
from app.imaging.pixel_ops import (
    TRANSFORM_APPLY_SPACING,
    TRANSFORM_EXTRACT_PIXELS,
    TRANSFORM_HU_WINDOW,
    TRANSFORM_MONOCHROME_INVERT,
    TRANSFORM_NORMALIZE,
    TRANSFORM_ORDER_SLICES,
    TRANSFORM_PREPARE_2D,
    TRANSFORM_PREPARE_3D,
)
from app.schemas.enums import AnatomicalRegion, Modality, Species

# Common uncompressed / little-endian transfer syntaxes (explicit allow-list when set).
_EXPLICIT_LE = "1.2.840.10008.1.2.1"
_IMPLICIT_LE = "1.2.840.10008.1.2"


def mri_volume_profile(
    model_id: str,
    *,
    version: str = "1.0.0",
    regions: frozenset[AnatomicalRegion] | None = None,
    species: frozenset[Species] | None = None,
) -> PreprocessingContract:
    """MRI 3D stack: extract → MONOCHROME → order → spacing → normalize → DHW."""
    base = pixel_3d_contract(
        model_id,
        version=version,
        modalities=frozenset({Modality.MR}),
        regions=regions,
        species=species,
        transfer_syntaxes=frozenset({_EXPLICIT_LE, _IMPLICIT_LE}),
    )
    return PreprocessingContract(
        contract_id=f"profile.mri_volume:{model_id}",
        model_id=model_id,
        model_version=version,
        modalities=frozenset({Modality.MR}),
        regions=regions or frozenset(),
        species=species,
        requires_pixels=True,
        allowed_transfer_syntaxes=base.allowed_transfer_syntaxes,
        allowed_transforms=(
            TRANSFORM_EXTRACT_PIXELS,
            TRANSFORM_MONOCHROME_INVERT,
            TRANSFORM_ORDER_SLICES,
            TRANSFORM_APPLY_SPACING,
            TRANSFORM_NORMALIZE,
            TRANSFORM_PREPARE_3D,
        ),
        output_tensor_layout="dhw",
        notes="MRI volume profile — no HU window; intensity normalize only.",
    )


def ct_volume_profile(
    model_id: str,
    *,
    version: str = "1.0.0",
    regions: frozenset[AnatomicalRegion] | None = None,
    species: frozenset[Species] | None = None,
    window_center: float | None = None,
    window_width: float | None = None,
) -> PreprocessingContract:
    """CT 3D stack with optional HU window (must be supplied at preprocess time)."""
    _ = (window_center, window_width)  # documented for callers; applied at preprocess
    return PreprocessingContract(
        contract_id=f"profile.ct_volume:{model_id}",
        model_id=model_id,
        model_version=version,
        modalities=frozenset({Modality.CT}),
        regions=regions or frozenset(),
        species=species,
        requires_pixels=True,
        allowed_transfer_syntaxes=frozenset({_EXPLICIT_LE, _IMPLICIT_LE}),
        allowed_transforms=(
            TRANSFORM_EXTRACT_PIXELS,
            TRANSFORM_MONOCHROME_INVERT,
            TRANSFORM_ORDER_SLICES,
            TRANSFORM_APPLY_SPACING,
            TRANSFORM_HU_WINDOW,
            TRANSFORM_NORMALIZE,
            TRANSFORM_PREPARE_3D,
        ),
        output_tensor_layout="dhw",
        notes="CT volume profile — hu_window requires explicit WW/WC at preprocess.",
    )


def xray_2d_profile(
    model_id: str,
    *,
    version: str = "1.0.0",
    regions: frozenset[AnatomicalRegion] | None = None,
    species: frozenset[Species] | None = None,
) -> PreprocessingContract:
    """Projection radiograph 2D CHW package."""
    base = pixel_2d_contract(
        model_id,
        version=version,
        modalities=frozenset({Modality.XR}),
        regions=regions,
        species=species,
        transfer_syntaxes=frozenset({_EXPLICIT_LE, _IMPLICIT_LE}),
    )
    return PreprocessingContract(
        contract_id=f"profile.xray_2d:{model_id}",
        model_id=model_id,
        model_version=version,
        modalities=frozenset({Modality.XR}),
        regions=regions or frozenset(),
        species=species,
        requires_pixels=True,
        allowed_transfer_syntaxes=base.allowed_transfer_syntaxes,
        allowed_transforms=base.allowed_transforms,
        output_tensor_layout="chw",
        notes="X-ray 2D profile — single-frame CHW after window/normalize.",
    )


def profile_for_modality(
    modality: Modality,
    model_id: str,
    *,
    version: str = "1.0.0",
    regions: frozenset[AnatomicalRegion] | None = None,
    species: frozenset[Species] | None = None,
) -> PreprocessingContract:
    if modality == Modality.MR:
        return mri_volume_profile(model_id, version=version, regions=regions, species=species)
    if modality == Modality.CT:
        return ct_volume_profile(model_id, version=version, regions=regions, species=species)
    if modality == Modality.XR:
        return xray_2d_profile(model_id, version=version, regions=regions, species=species)
    from app.models.errors import IncompatibleInputError

    raise IncompatibleInputError(
        f"No preprocessing profile for modality={modality.value}."
    )
