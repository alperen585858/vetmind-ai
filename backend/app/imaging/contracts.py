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
