"""Apply only PreprocessingContract.allowed_transforms to decoded volumes/slices."""

from __future__ import annotations

from typing import Any

import numpy as np

from app.imaging.contracts import PreprocessingContract, TransformProvenance
from app.imaging.interfaces import PrepValidationError
from app.imaging.pixel_ops import (
    KNOWN_TRANSFORMS,
    TRANSFORM_APPLY_SPACING,
    TRANSFORM_EXTRACT_PIXELS,
    TRANSFORM_HU_WINDOW,
    TRANSFORM_MONOCHROME_INVERT,
    TRANSFORM_NORMALIZE,
    TRANSFORM_ORDER_SLICES,
    TRANSFORM_PREPARE_2D,
    TRANSFORM_PREPARE_3D,
    apply_window,
    normalize_01,
    parse_pixel_spacing,
    prepare_2d_chw,
    prepare_3d_dhw,
)


class ContractImagePreprocessor:
    """Deterministic transform runner. Unknown / undeclared transforms are rejected."""

    def preprocess(
        self,
        *,
        volume: dict,
        contract: PreprocessingContract,
        window_center: float | None = None,
        window_width: float | None = None,
    ) -> tuple[dict, TransformProvenance]:
        if not contract.requires_pixels:
            raise PrepValidationError("Preprocessor denied: contract is metadata-only.")

        for name in contract.allowed_transforms:
            if name not in KNOWN_TRANSFORMS:
                raise PrepValidationError(f"Unknown transform in contract: {name!r}")

        steps: list[str] = []
        work: dict[str, Any] = dict(volume)
        tensor: np.ndarray | None = None

        if "volume" in work and isinstance(work["volume"], np.ndarray):
            tensor = work["volume"]
        elif "pixels" in work and isinstance(work["pixels"], np.ndarray):
            tensor = work["pixels"]
        else:
            raise PrepValidationError("volume dict must include 'volume' or 'pixels' ndarray.")

        # extract_pixels / order_slices / monochrome are assumed already applied upstream
        # when present in the contract; record them for provenance if declared.
        for gate in (
            TRANSFORM_EXTRACT_PIXELS,
            TRANSFORM_ORDER_SLICES,
            TRANSFORM_MONOCHROME_INVERT,
        ):
            if gate in contract.allowed_transforms:
                steps.append(gate)

        if TRANSFORM_HU_WINDOW in contract.allowed_transforms:
            if window_center is None or window_width is None:
                raise PrepValidationError(
                    "hu_window requires explicit window_center and window_width "
                    "(no silent clinical presets)."
                )
            tensor = apply_window(tensor, window_center=window_center, window_width=window_width)
            steps.append(TRANSFORM_HU_WINDOW)
            work["window_center"] = window_center
            work["window_width"] = window_width

        if TRANSFORM_NORMALIZE in contract.allowed_transforms:
            tensor = normalize_01(tensor)
            steps.append(TRANSFORM_NORMALIZE)

        if TRANSFORM_APPLY_SPACING in contract.allowed_transforms:
            spacing = parse_pixel_spacing(
                work.get("pixel_spacing")
                if isinstance(work.get("pixel_spacing"), str)
                else (
                    f"{work['pixel_spacing_mm'][0]}\\{work['pixel_spacing_mm'][1]}"
                    if work.get("pixel_spacing_mm")
                    else None
                )
            )
            work["pixel_spacing_mm"] = spacing
            steps.append(TRANSFORM_APPLY_SPACING)
            # Spacing is recorded for physical measurements; resampling is out of scope
            # until a dedicated resample transform is contracted.

        layout = contract.output_tensor_layout or "none"
        if TRANSFORM_PREPARE_2D in contract.allowed_transforms or layout == "chw":
            if tensor.ndim == 3 and tensor.shape[0] > 1 and layout == "chw":
                # Mid-slice for 2D head from a volume when explicitly asked.
                mid = tensor[tensor.shape[0] // 2]
                tensor = prepare_2d_chw(mid)
            else:
                tensor = prepare_2d_chw(tensor if tensor.ndim == 2 else tensor)
            steps.append(TRANSFORM_PREPARE_2D)
            work["tensor_layout"] = "chw"
        elif TRANSFORM_PREPARE_3D in contract.allowed_transforms or layout in {"dhw", "ndhwc"}:
            tensor = prepare_3d_dhw(tensor)
            steps.append(TRANSFORM_PREPARE_3D)
            work["tensor_layout"] = "dhw" if layout != "ndhwc" else "ndhwc"
            if layout == "ndhwc":
                tensor = tensor[..., np.newaxis]
        else:
            work["tensor_layout"] = layout

        work["tensor"] = tensor
        work["tensor_shape"] = tuple(int(x) for x in tensor.shape)
        sops = tuple(
            str(u) for u in (work.get("sop_instance_uids") or []) if u
        ) or tuple(
            str(u) for u in ([work.get("sop_instance_uid")] if work.get("sop_instance_uid") else [])
        )
        provenance = TransformProvenance(
            contract_id=contract.contract_id,
            steps=tuple(steps),
            source_sop_uids=sops,
            pixels_loaded=True,
            authorization_reason_codes=(),
            note="Transforms applied only as listed on PreprocessingContract.",
        )
        return work, provenance
