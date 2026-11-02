"""Render AI / vet localization overlays onto native DICOM slices (brain MR/CT first).

Produces PNG bytes. Does not invent boxes — caller must supply bbox or mask.
Coordinates are drawn in native pixel space after optional transform invert.
"""

from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass
from typing import Sequence

import numpy as np

from app.imaging.geometry import (
    TransformStep,
    map_bbox_inverse,
    steps_from_dicts,
)
from app.schemas.findings import BoundingBoxEvidence, EVIDENCE_DISCLAIMER


@dataclass(frozen=True)
class RenderedOverlay:
    png_bytes: bytes
    width: int
    height: int
    label: str
    disclaimer: str = EVIDENCE_DISCLAIMER
    coordinate_space: str = "pixel_2d_native"


def _png_rgb(arr_u8: np.ndarray) -> bytes:
    """Encode HxWx3 uint8 as RGB PNG without Pillow."""
    if arr_u8.ndim != 3 or arr_u8.shape[2] != 3:
        raise ValueError("expected HxWx3 uint8")
    height, width, _ = arr_u8.shape
    raw = b"".join(b"\x00" + arr_u8[y].tobytes() for y in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def _to_display_rgb(gray: np.ndarray) -> np.ndarray:
    g = gray.astype(np.float32)
    if g.ndim == 3 and g.shape[0] in (1, 3):
        g = g[0] if g.shape[0] == 1 else g.mean(axis=0)
    if g.ndim != 2:
        raise ValueError(f"expected 2D slice, got {g.shape}")
    lo, hi = float(np.min(g)), float(np.max(g))
    if hi <= lo:
        norm = np.zeros_like(g, dtype=np.float32)
    else:
        norm = (g - lo) / (hi - lo)
    u8 = np.clip(norm * 255.0, 0, 255).astype(np.uint8)
    return np.stack([u8, u8, u8], axis=-1)


def _draw_rect(
    rgb: np.ndarray,
    *,
    x_min: int,
    y_min: int,
    x_max: int,
    y_max: int,
    color: tuple[int, int, int] = (220, 40, 40),
    thickness: int = 2,
) -> None:
    h, w, _ = rgb.shape
    x0 = max(0, min(w - 1, x_min))
    x1 = max(0, min(w - 1, x_max))
    y0 = max(0, min(h - 1, y_min))
    y1 = max(0, min(h - 1, y_max))
    if x1 <= x0 or y1 <= y0:
        return
    t = max(1, thickness)
    rgb[y0 : y0 + t, x0 : x1 + 1] = color
    rgb[y1 - t + 1 : y1 + 1, x0 : x1 + 1] = color
    rgb[y0 : y1 + 1, x0 : x0 + t] = color
    rgb[y0 : y1 + 1, x1 - t + 1 : x1 + 1] = color


def _blend_mask(
    rgb: np.ndarray,
    mask: np.ndarray,
    *,
    color: tuple[int, int, int] = (220, 40, 40),
    alpha: float = 0.35,
) -> None:
    if mask.shape[:2] != rgb.shape[:2]:
        raise ValueError(
            f"mask shape {mask.shape[:2]} does not match image {rgb.shape[:2]} "
            "(geometry mismatch — refuse silent stretch)."
        )
    m = mask.astype(np.float32)
    if m.ndim == 3:
        m = m[..., 0]
    bin_m = (m > 0.5).astype(np.float32)
    if not bin_m.any():
        return
    a = float(np.clip(alpha, 0.0, 1.0))
    for c, col in enumerate(color):
        channel = rgb[..., c].astype(np.float32)
        channel = channel * (1.0 - a * bin_m) + col * (a * bin_m)
        rgb[..., c] = np.clip(channel, 0, 255).astype(np.uint8)


def native_bbox_from_evidence(bbox: BoundingBoxEvidence) -> tuple[float, float, float, float]:
    """Return bbox in pixel_2d_native for drawing on original slice."""
    steps = steps_from_dicts(bbox.transform_chain)
    space = bbox.coordinate_space
    if space in {"pixel_2d_native", "pixel_2d"} and not steps:
        return bbox.x_min, bbox.y_min, bbox.x_max, bbox.y_max
    if space == "model_input" or steps:
        return map_bbox_inverse(bbox.x_min, bbox.y_min, bbox.x_max, bbox.y_max, steps)
    return bbox.x_min, bbox.y_min, bbox.x_max, bbox.y_max


def render_bbox_overlay(
    slice_2d: np.ndarray,
    bbox: BoundingBoxEvidence,
    *,
    label: str = "AI-suspected",
    origin: str = "ai_proposed",
) -> RenderedOverlay:
    rgb = _to_display_rgb(slice_2d)
    x0, y0, x1, y1 = native_bbox_from_evidence(bbox)
    color = (220, 40, 40) if origin == "ai_proposed" else (30, 120, 200)
    _draw_rect(
        rgb,
        x_min=int(round(x0)),
        y_min=int(round(y0)),
        x_max=int(round(x1)),
        y_max=int(round(y1)),
        color=color,
        thickness=2,
    )
    # Simple label bar (top-left of box)
    lx = max(0, int(round(x0)))
    ly = max(0, int(round(y0)) - 6)
    if ly < rgb.shape[0] and lx < rgb.shape[1]:
        rgb[ly : min(ly + 4, rgb.shape[0]), lx : min(lx + 40, rgb.shape[1])] = color
    return RenderedOverlay(
        png_bytes=_png_rgb(rgb),
        width=int(rgb.shape[1]),
        height=int(rgb.shape[0]),
        label=label,
        coordinate_space="pixel_2d_native",
    )


def render_mask_overlay(
    slice_2d: np.ndarray,
    mask_2d: np.ndarray,
    *,
    label: str = "AI-suspected",
    origin: str = "ai_proposed",
    also_bbox: BoundingBoxEvidence | None = None,
) -> RenderedOverlay:
    rgb = _to_display_rgb(slice_2d)
    color = (220, 40, 40) if origin == "ai_proposed" else (30, 120, 200)
    _blend_mask(rgb, mask_2d, color=color, alpha=0.35)
    if also_bbox is not None:
        x0, y0, x1, y1 = native_bbox_from_evidence(also_bbox)
        _draw_rect(
            rgb,
            x_min=int(round(x0)),
            y_min=int(round(y0)),
            x_max=int(round(x1)),
            y_max=int(round(y1)),
            color=color,
        )
    return RenderedOverlay(
        png_bytes=_png_rgb(rgb),
        width=int(rgb.shape[1]),
        height=int(rgb.shape[0]),
        label=label,
        coordinate_space="pixel_2d_native",
    )


def render_from_model_space_bbox(
    slice_2d: np.ndarray,
    *,
    x_min: float,
    y_min: float,
    x_max: float,
    y_max: float,
    transform_chain: Sequence[TransformStep] | None = None,
    label: str = "AI-suspected",
    origin: str = "ai_proposed",
) -> RenderedOverlay:
    bbox = BoundingBoxEvidence(
        x_min=x_min,
        y_min=y_min,
        x_max=x_max,
        y_max=y_max,
        coordinate_space="model_input" if transform_chain else "pixel_2d_native",
        transform_chain=[
            {"name": s.name, "params": dict(s.params)} for s in (transform_chain or [])
        ],
    )
    return render_bbox_overlay(slice_2d, bbox, label=label, origin=origin)
