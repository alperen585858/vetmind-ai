"""PNG/VLM display space ↔ native DICOM pixel transforms for overlays.

If a transform cannot be verified by round-trip, callers must not draw overlays.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from app.imaging.geometry import (
    TransformStep,
    crop_step,
    flip_h_step,
    flip_v_step,
    map_bbox_forward,
    map_bbox_inverse,
    pan_step,
    resize_step,
    rotate_step,
    steps_to_dicts,
    verify_bbox_roundtrip,
    zoom_step,
)
from app.schemas.findings import BoundingBoxEvidence


@dataclass(frozen=True)
class VerifiedNativeBBox:
    """BBox guaranteed in pixel_2d_native after verified invert."""

    bbox: BoundingBoxEvidence
    verified: bool
    reason: str = ""


def vlm_resize_chain(
    *,
    native_width: int,
    native_height: int,
    png_width: int,
    png_height: int,
) -> list[TransformStep]:
    """Native DICOM plane → VLM PNG (max-edge resize, aspect preserved)."""
    if (
        native_width <= 0
        or native_height <= 0
        or png_width <= 0
        or png_height <= 0
    ):
        return []
    if native_width == png_width and native_height == png_height:
        return []
    return [
        resize_step(
            src_h=native_height,
            src_w=native_width,
            dst_h=png_height,
            dst_w=png_width,
        )
    ]


def viewer_display_chain(
    *,
    native_width: int,
    native_height: int,
    zoom: float = 1.0,
    pan_x: float = 0.0,
    pan_y: float = 0.0,
    rotation_deg: float = 0.0,
    flip_h: bool = False,
    flip_v: bool = False,
) -> list[TransformStep]:
    """CSS-equivalent viewer transforms applied after native pixels (for tests)."""
    steps: list[TransformStep] = []
    w, h = float(native_width), float(native_height)
    if flip_h:
        steps.append(flip_h_step(w))
    if flip_v:
        steps.append(flip_v_step(h))
    deg = float(rotation_deg) % 360.0
    if deg in {90.0, 180.0, 270.0}:
        steps.append(rotate_step(deg, width=w, height=h))
    if abs(zoom - 1.0) > 1e-9:
        steps.append(zoom_step(zoom, cx=(w - 1.0) / 2.0, cy=(h - 1.0) / 2.0))
    if pan_x or pan_y:
        steps.append(pan_step(pan_x, pan_y))
    return steps


def native_bbox_from_vlm_png(
    *,
    x_min: float,
    y_min: float,
    x_max: float,
    y_max: float,
    native_width: int | None,
    native_height: int | None,
    png_width: int | None,
    png_height: int | None,
    atol: float = 1.5,
) -> VerifiedNativeBBox | None:
    """Map a VLM/PNG-space bbox to native DICOM pixels; None if unverified."""
    if (
        native_width is None
        or native_height is None
        or png_width is None
        or png_height is None
        or native_width <= 0
        or native_height <= 0
        or png_width <= 0
        or png_height <= 0
    ):
        return None
    if x_max < x_min or y_max < y_min:
        return None
    chain = vlm_resize_chain(
        native_width=native_width,
        native_height=native_height,
        png_width=png_width,
        png_height=png_height,
    )
    if not chain:
        # Identity — already native-sized PNG.
        try:
            bbox = BoundingBoxEvidence(
                x_min=x_min,
                y_min=y_min,
                x_max=x_max,
                y_max=y_max,
                coordinate_space="pixel_2d_native",
                transform_chain=[],
            )
        except Exception:
            return None
        return VerifiedNativeBBox(bbox=bbox, verified=True, reason="identity")

    # Probe with a native box mapped forward then inverse.
    probe = (
        native_width * 0.25,
        native_height * 0.25,
        native_width * 0.75,
        native_height * 0.75,
    )
    if not verify_bbox_roundtrip(*probe, chain, atol=atol):
        return None

    nx0, ny0, nx1, ny1 = map_bbox_inverse(x_min, y_min, x_max, y_max, chain)
    # Clamp to native plane.
    nx0 = max(0.0, min(float(native_width - 1), nx0))
    nx1 = max(0.0, min(float(native_width - 1), nx1))
    ny0 = max(0.0, min(float(native_height - 1), ny0))
    ny1 = max(0.0, min(float(native_height - 1), ny1))
    if nx1 - nx0 < 1 or ny1 - ny0 < 1:
        return None
    try:
        bbox = BoundingBoxEvidence(
            x_min=nx0,
            y_min=ny0,
            x_max=nx1,
            y_max=ny1,
            coordinate_space="pixel_2d_native",
            transform_chain=[],
        )
    except Exception:
        return None
    return VerifiedNativeBBox(bbox=bbox, verified=True, reason="resized_inverted")


def model_input_bbox_with_chain(
    *,
    x_min: float,
    y_min: float,
    x_max: float,
    y_max: float,
    chain: Sequence[TransformStep],
) -> VerifiedNativeBBox | None:
    """Keep bbox in model_input space with invert chain, only if verified."""
    if not verify_bbox_roundtrip(x_min, y_min, x_max, y_max, chain):
        return None
    try:
        bbox = BoundingBoxEvidence(
            x_min=x_min,
            y_min=y_min,
            x_max=x_max,
            y_max=y_max,
            coordinate_space="model_input",
            transform_chain=steps_to_dicts(chain),
        )
    except Exception:
        return None
    return VerifiedNativeBBox(bbox=bbox, verified=True, reason="model_input_chained")


def should_draw_overlay(verified: VerifiedNativeBBox | None) -> bool:
    return verified is not None and verified.verified


__all__ = [
    "VerifiedNativeBBox",
    "vlm_resize_chain",
    "viewer_display_chain",
    "native_bbox_from_vlm_png",
    "model_input_bbox_with_chain",
    "should_draw_overlay",
    "crop_step",
    "map_bbox_forward",
    "map_bbox_inverse",
]
