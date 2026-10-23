"""Multi-slice volume assembly for MRI/CT (authorized pixel path only)."""

from __future__ import annotations

from typing import Any

import numpy as np

from app.imaging.contracts import PreprocessingContract
from app.imaging.interfaces import PrepValidationError
from app.imaging.pixel_ops import (
    TRANSFORM_ORDER_SLICES,
    order_slice_indices,
    parse_pixel_spacing,
    stack_ordered_slices,
)
from app.schemas.case import CaseRecord


class SliceOrderedVolumeAssembler:
    """Assemble 2D slices into a DHW volume using IPP / InstanceNumber ordering."""

    def assemble(
        self,
        *,
        case: CaseRecord,
        contract: PreprocessingContract,
        decoded: list[dict],
    ) -> dict:
        if not decoded:
            raise PrepValidationError("No decoded instances to assemble.")
        if not contract.requires_pixels:
            raise PrepValidationError("Volume assemble denied: contract is metadata-only.")

        frames_meta = [
            {
                "image_position_patient": d.get("image_position_patient"),
                "instance_number": d.get("instance_number"),
                "sop_instance_uid": d.get("sop_instance_uid"),
                "pixel_spacing": d.get("pixel_spacing"),
            }
            for d in decoded
        ]
        order = list(range(len(decoded)))
        if TRANSFORM_ORDER_SLICES in contract.allowed_transforms:
            order = order_slice_indices(frames_meta)

        slices = []
        for d in decoded:
            pix = d.get("pixels")
            if not isinstance(pix, np.ndarray):
                raise PrepValidationError("Decoded entry missing pixels ndarray.")
            if pix.ndim != 2:
                raise PrepValidationError(f"Expected 2D slice, got shape {pix.shape}")
            slices.append(pix)

        volume = stack_ordered_slices(slices, order)
        spacing = parse_pixel_spacing(decoded[order[0]].get("pixel_spacing"))
        return {
            "volume": volume,
            "shape_dhw": tuple(int(x) for x in volume.shape),
            "order_indices": order,
            "pixel_spacing_mm": spacing,
            "case_id": case.case_id,
            "modality": case.modality.value,
            "anatomical_region": case.anatomical_region.value,
            "sop_instance_uids": [decoded[i].get("sop_instance_uid") for i in order],
            "pixels_loaded": True,
            "note": "Volume assembled under contract. Not a clinical reconstruction claim.",
        }


def describe_volume(volume_desc: dict[str, Any]) -> dict[str, str]:
    """Safe, non-PHI summary for processing_metadata."""
    shape = volume_desc.get("shape_dhw")
    spacing = volume_desc.get("pixel_spacing_mm")
    return {
        "volume_shape": "x".join(str(x) for x in shape) if shape else "unknown",
        "pixel_spacing": (
            f"{spacing[0]}\\{spacing[1]}" if isinstance(spacing, tuple) else "absent"
        ),
        "slice_count": str(len(volume_desc.get("order_indices") or [])),
    }
