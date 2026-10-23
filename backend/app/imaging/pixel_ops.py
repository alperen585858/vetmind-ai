"""DICOM pixel math for future Vision adapters.

Operates on in-memory arrays only. Callers must already have passed pixel
authorization + PreprocessingContract.allowed_transforms. Never invents clinical
window presets beyond explicit WW/WC arguments.
"""

from __future__ import annotations

from typing import Iterable, Sequence

import numpy as np

from app.imaging.interfaces import PrepValidationError

TRANSFORM_EXTRACT_PIXELS = "extract_pixels"
TRANSFORM_NORMALIZE = "normalize_01"
TRANSFORM_HU_WINDOW = "hu_window"
TRANSFORM_MONOCHROME_INVERT = "monochrome1_invert"
TRANSFORM_APPLY_SPACING = "apply_pixel_spacing"
TRANSFORM_ORDER_SLICES = "order_slices"
TRANSFORM_PREPARE_2D = "prepare_2d"
TRANSFORM_PREPARE_3D = "prepare_3d"

KNOWN_TRANSFORMS = frozenset(
    {
        TRANSFORM_EXTRACT_PIXELS,
        TRANSFORM_NORMALIZE,
        TRANSFORM_HU_WINDOW,
        TRANSFORM_MONOCHROME_INVERT,
        TRANSFORM_APPLY_SPACING,
        TRANSFORM_ORDER_SLICES,
        TRANSFORM_PREPARE_2D,
        TRANSFORM_PREPARE_3D,
    }
)


def as_float_array(pixels: np.ndarray) -> np.ndarray:
    if not isinstance(pixels, np.ndarray):
        raise PrepValidationError("pixels must be a numpy.ndarray")
    if pixels.size == 0:
        raise PrepValidationError("empty pixel array")
    return pixels.astype(np.float32, copy=False)


def normalize_01(pixels: np.ndarray) -> np.ndarray:
    """Min-max normalize to [0, 1]. Constant images → zeros."""
    arr = as_float_array(pixels)
    lo = float(np.min(arr))
    hi = float(np.max(arr))
    if hi <= lo:
        return np.zeros_like(arr, dtype=np.float32)
    return ((arr - lo) / (hi - lo)).astype(np.float32)


def apply_window(
    pixels: np.ndarray,
    *,
    window_center: float,
    window_width: float,
) -> np.ndarray:
    """Linear WW/WC window to [0, 1]. Width must be > 0."""
    if window_width <= 0:
        raise PrepValidationError("window_width must be > 0")
    arr = as_float_array(pixels)
    half = window_width / 2.0
    lo = window_center - half
    hi = window_center + half
    clipped = np.clip(arr, lo, hi)
    return ((clipped - lo) / (hi - lo)).astype(np.float32)


def apply_photometric(pixels: np.ndarray, photometric: str | None) -> np.ndarray:
    """Invert MONOCHROME1 so higher values are brighter (MONOCHROME2 convention)."""
    arr = as_float_array(pixels)
    pi = (photometric or "MONOCHROME2").strip().upper()
    if pi == "MONOCHROME1":
        return (np.max(arr) - arr).astype(np.float32)
    if pi in {"MONOCHROME2", ""}:
        return arr
    raise PrepValidationError(f"Unsupported PhotometricInterpretation: {photometric!r}")


def parse_pixel_spacing(raw: str | None) -> tuple[float, float] | None:
    """Parse DICOM PixelSpacing 'row\\col' → (row_mm, col_mm). None if absent/invalid."""
    if raw is None or not str(raw).strip():
        return None
    text = str(raw).strip().replace(",", "\\")
    parts = [p for p in text.replace("/", "\\").split("\\") if p.strip()]
    if len(parts) < 2:
        return None
    try:
        row_mm = float(parts[0])
        col_mm = float(parts[1])
    except ValueError:
        return None
    if row_mm <= 0 or col_mm <= 0:
        return None
    return row_mm, col_mm


def parse_image_position(raw: str | None) -> tuple[float, float, float] | None:
    if raw is None or not str(raw).strip():
        return None
    parts = [p.strip() for p in str(raw).replace("/", "\\").split("\\") if p.strip()]
    if len(parts) < 3:
        return None
    try:
        return float(parts[0]), float(parts[1]), float(parts[2])
    except ValueError:
        return None


def slice_sort_key(
    *,
    image_position_patient: str | None,
    instance_number: int | None,
    sop_instance_uid: str,
) -> tuple:
    """MRI/CT slice order: prefer IPP along approximate Z, else InstanceNumber, else UID."""
    ipp = parse_image_position(image_position_patient)
    if ipp is not None:
        # Use third patient coordinate as primary stack axis (common axial convention).
        return (0, ipp[2], ipp[1], ipp[0], sop_instance_uid)
    if instance_number is not None:
        return (1, int(instance_number), sop_instance_uid)
    return (2, sop_instance_uid)


def order_slice_indices(
    frames: Sequence[dict],
) -> list[int]:
    """Return indices into ``frames`` sorted for volume stacking."""
    keyed = []
    for i, fr in enumerate(frames):
        keyed.append(
            (
                slice_sort_key(
                    image_position_patient=fr.get("image_position_patient"),
                    instance_number=fr.get("instance_number"),
                    sop_instance_uid=str(fr.get("sop_instance_uid") or i),
                ),
                i,
            )
        )
    keyed.sort(key=lambda x: x[0])
    return [i for _, i in keyed]


def prepare_2d_chw(pixels: np.ndarray) -> np.ndarray:
    """Ensure CHW float32 (C=1 for mono). Accepts HW or CHW."""
    arr = as_float_array(pixels)
    if arr.ndim == 2:
        return arr[np.newaxis, ...]
    if arr.ndim == 3 and arr.shape[0] in (1, 3):
        return arr
    if arr.ndim == 3 and arr.shape[-1] in (1, 3):
        return np.transpose(arr, (2, 0, 1))
    raise PrepValidationError(f"Cannot prepare_2d from shape {arr.shape}")


def prepare_3d_dhw(volume: np.ndarray) -> np.ndarray:
    """Ensure DHW float32 (single-channel depth stack). Accepts DHW or DHWC/CDHW."""
    arr = as_float_array(volume)
    if arr.ndim == 3:
        return arr
    if arr.ndim == 4 and arr.shape[0] == 1:
        return arr[0]
    if arr.ndim == 4 and arr.shape[-1] == 1:
        return arr[..., 0]
    raise PrepValidationError(f"Cannot prepare_3d from shape {arr.shape}")


def stack_ordered_slices(slices: Iterable[np.ndarray], order: Sequence[int]) -> np.ndarray:
    items = list(slices)
    if not items:
        raise PrepValidationError("no slices to stack")
    if len(order) != len(items):
        raise PrepValidationError("order length must match slice count")
    ordered = [as_float_array(items[i]) for i in order]
    shapes = {s.shape for s in ordered}
    if len(shapes) != 1:
        raise PrepValidationError(f"inhomogeneous slice shapes: {shapes}")
    return np.stack(ordered, axis=0)
