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
    return cx, cy


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
