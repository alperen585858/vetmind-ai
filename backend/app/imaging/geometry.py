"""Coordinate transforms for evidence localization (native DICOM ↔ model input ↔ display).

Preserves orientation / spacing metadata. Never invents missing IOP/IPP.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Sequence

import numpy as np

CoordinateSpace = Literal["pixel_2d_native", "model_input", "patient", "pixel_2d"]


@dataclass(frozen=True)
class TransformStep:
    """One invertible 2D spatial step applied during prep or display."""

    name: str
    # For scale: sx, sy relative to previous space. For crop: x0,y0,x1,y1 in prev space.
    params: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class FrameGeometry:
    """Spatial metadata for one DICOM frame / volume slice."""

    sop_instance_uid: str | None = None
    frame_index: int | None = None
    instance_number: int | None = None
    rows: int | None = None
    columns: int | None = None
    pixel_spacing_mm: tuple[float, float] | None = None
    image_orientation_patient: str | None = None
    image_position_patient: str | None = None
    series_instance_uid: str | None = None
    study_instance_uid: str | None = None


@dataclass(frozen=True)
class VolumeGeometry:
    """3D volume geometry (DHW) for mask alignment checks."""

    shape_dhw: tuple[int, int, int]
    spacing_dhw_mm: tuple[float, float, float] | None = None
    origin_xyz_mm: tuple[float, float, float] | None = None
    # Row-major 3x3 direction cosines flattened, or IOP of first slice repeated.
    direction_9: tuple[float, ...] | None = None

    def matches(self, other: "VolumeGeometry", *, atol: float = 1e-3) -> bool:
        if self.shape_dhw != other.shape_dhw:
            return False
        if self.spacing_dhw_mm and other.spacing_dhw_mm:
            a = np.asarray(self.spacing_dhw_mm, dtype=np.float64)
            b = np.asarray(other.spacing_dhw_mm, dtype=np.float64)
            if not np.allclose(a, b, atol=atol, rtol=0):
                return False
        if self.origin_xyz_mm and other.origin_xyz_mm:
            a = np.asarray(self.origin_xyz_mm, dtype=np.float64)
            b = np.asarray(other.origin_xyz_mm, dtype=np.float64)
            if not np.allclose(a, b, atol=atol, rtol=0):
                return False
        if self.direction_9 and other.direction_9:
            if len(self.direction_9) != len(other.direction_9):
                return False
            a = np.asarray(self.direction_9, dtype=np.float64)
            b = np.asarray(other.direction_9, dtype=np.float64)
            if not np.allclose(a, b, atol=atol, rtol=0):
                return False
        return True


def scale_step(sx: float, sy: float) -> TransformStep:
    return TransformStep(name="scale", params={"sx": float(sx), "sy": float(sy)})


def crop_step(x0: float, y0: float, x1: float, y1: float) -> TransformStep:
    return TransformStep(
        name="crop",
        params={"x0": float(x0), "y0": float(y0), "x1": float(x1), "y1": float(y1)},
    )


def resize_step(*, src_h: int, src_w: int, dst_h: int, dst_w: int) -> TransformStep:
    sx = float(dst_w) / float(src_w) if src_w else 1.0
    sy = float(dst_h) / float(src_h) if src_h else 1.0
    return TransformStep(
        name="resize",
        params={
            "sx": sx,
            "sy": sy,
            "src_h": float(src_h),
            "src_w": float(src_w),
            "dst_h": float(dst_h),
            "dst_w": float(dst_w),
        },
    )


def rotate_step(degrees: float, *, width: float, height: float) -> TransformStep:
    """Clockwise rotation about image center; width/height are pre-rotate size."""
    return TransformStep(
        name="rotate",
        params={"degrees": float(degrees), "width": float(width), "height": float(height)},
    )


def flip_h_step(width: float) -> TransformStep:
    return TransformStep(name="flip_h", params={"width": float(width)})


def flip_v_step(height: float) -> TransformStep:
    return TransformStep(name="flip_v", params={"height": float(height)})


def pan_step(dx: float, dy: float) -> TransformStep:
    return TransformStep(name="pan", params={"dx": float(dx), "dy": float(dy)})


def zoom_step(factor: float, *, cx: float, cy: float) -> TransformStep:
    """Zoom about (cx, cy) in the current space."""
    return TransformStep(
        name="zoom",
        params={"factor": float(factor), "cx": float(cx), "cy": float(cy)},
    )


def map_point_forward(x: float, y: float, steps: Sequence[TransformStep]) -> tuple[float, float]:
    """Apply transform_chain native → model_input (or display)."""
    cx, cy = float(x), float(y)
    for step in steps:
        if step.name in {"scale", "resize"}:
            cx *= float(step.params.get("sx", 1.0))
            cy *= float(step.params.get("sy", 1.0))
        elif step.name == "crop":
            cx -= float(step.params.get("x0", 0.0))
            cy -= float(step.params.get("y0", 0.0))
        elif step.name == "flip_h":
            w = float(step.params.get("width", 0.0))
            cx = w - 1.0 - cx
        elif step.name == "flip_v":
            h = float(step.params.get("height", 0.0))
            cy = h - 1.0 - cy
        elif step.name == "rotate":
            deg = float(step.params.get("degrees", 0.0)) % 360.0
            w = float(step.params.get("width", 0.0))
            h = float(step.params.get("height", 0.0))
            ox, oy = (w - 1.0) / 2.0, (h - 1.0) / 2.0
            rx, ry = cx - ox, cy - oy
            if deg == 90.0:
                cx, cy = ox + ry, oy - rx
                # After 90° CW, width/height swap for subsequent steps is caller's concern.
            elif deg == 180.0:
                cx, cy = ox - rx, oy - ry
            elif deg == 270.0:
                cx, cy = ox - ry, oy + rx
            # Non-cardinal rotations are not supported for overlay — leave unchanged.
        elif step.name == "pan":
            cx += float(step.params.get("dx", 0.0))
            cy += float(step.params.get("dy", 0.0))
        elif step.name == "zoom":
            f = float(step.params.get("factor", 1.0)) or 1.0
            zcx = float(step.params.get("cx", 0.0))
            zcy = float(step.params.get("cy", 0.0))
            cx = zcx + (cx - zcx) * f
            cy = zcy + (cy - zcy) * f
    return cx, cy


def map_point_inverse(x: float, y: float, steps: Sequence[TransformStep]) -> tuple[float, float]:
    """Invert transform_chain model_input → native."""
    cx, cy = float(x), float(y)
    for step in reversed(list(steps)):
        if step.name in {"scale", "resize"}:
            sx = float(step.params.get("sx", 1.0)) or 1.0
            sy = float(step.params.get("sy", 1.0)) or 1.0
            cx /= sx
            cy /= sy
        elif step.name == "crop":
            cx += float(step.params.get("x0", 0.0))
            cy += float(step.params.get("y0", 0.0))
        elif step.name == "flip_h":
            w = float(step.params.get("width", 0.0))
            cx = w - 1.0 - cx
        elif step.name == "flip_v":
            h = float(step.params.get("height", 0.0))
            cy = h - 1.0 - cy
        elif step.name == "rotate":
            deg = float(step.params.get("degrees", 0.0)) % 360.0
            w = float(step.params.get("width", 0.0))
            h = float(step.params.get("height", 0.0))
            ox, oy = (w - 1.0) / 2.0, (h - 1.0) / 2.0
            rx, ry = cx - ox, cy - oy
            # Inverse of CW is CCW (same as CW of 360-deg).
            if deg == 90.0:
                cx, cy = ox - ry, oy + rx
            elif deg == 180.0:
                cx, cy = ox - rx, oy - ry
            elif deg == 270.0:
                cx, cy = ox + ry, oy - rx
        elif step.name == "pan":
            cx -= float(step.params.get("dx", 0.0))
            cy -= float(step.params.get("dy", 0.0))
        elif step.name == "zoom":
            f = float(step.params.get("factor", 1.0)) or 1.0
            zcx = float(step.params.get("cx", 0.0))
            zcy = float(step.params.get("cy", 0.0))
            cx = zcx + (cx - zcx) / f
            cy = zcy + (cy - zcy) / f
    return cx, cy


def verify_bbox_roundtrip(
    x_min: float,
    y_min: float,
    x_max: float,
    y_max: float,
    steps: Sequence[TransformStep],
    *,
    atol: float = 1.5,
) -> bool:
    """True when forward→inverse recovers the bbox within ``atol`` pixels."""
    fx0, fy0, fx1, fy1 = map_bbox_forward(x_min, y_min, x_max, y_max, steps)
    bx0, by0, bx1, by1 = map_bbox_inverse(fx0, fy0, fx1, fy1, steps)
    return (
        abs(bx0 - x_min) <= atol
        and abs(by0 - y_min) <= atol
        and abs(bx1 - x_max) <= atol
        and abs(by1 - y_max) <= atol
    )


def map_bbox_inverse(
    x_min: float,
    y_min: float,
    x_max: float,
    y_max: float,
    steps: Sequence[TransformStep],
) -> tuple[float, float, float, float]:
    x0, y0 = map_point_inverse(x_min, y_min, steps)
    x1, y1 = map_point_inverse(x_max, y_max, steps)
    return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


def map_bbox_forward(
    x_min: float,
    y_min: float,
    x_max: float,
    y_max: float,
    steps: Sequence[TransformStep],
) -> tuple[float, float, float, float]:
    x0, y0 = map_point_forward(x_min, y_min, steps)
    x1, y1 = map_point_forward(x_max, y_max, steps)
    return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


def display_scale_steps(*, native_w: int, native_h: int, canvas_w: int, canvas_h: int) -> list[TransformStep]:
    """Canvas CSS/size scale from native pixels (viewer overlay)."""
    return [resize_step(src_h=native_h, src_w=native_w, dst_h=canvas_h, dst_w=canvas_w)]


def steps_to_dicts(steps: Sequence[TransformStep]) -> list[dict[str, Any]]:
    return [{"name": s.name, "params": dict(s.params)} for s in steps]


def steps_from_dicts(raw: Sequence[dict[str, Any]] | None) -> list[TransformStep]:
    out: list[TransformStep] = []
    for item in raw or []:
        out.append(
            TransformStep(
                name=str(item.get("name") or ""),
                params={str(k): float(v) for k, v in dict(item.get("params") or {}).items()},
            )
        )
    return out
