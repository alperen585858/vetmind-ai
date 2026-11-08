"""Shared DICOM → display PNG for VLM upload and PDF thumbnails.

Preserves native aspect ratio. Uses percentile windowing + MONOCHROME1 invert
(aligned with clinical display intent). Not a substitute for PACS window presets.
"""

from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass
from io import BytesIO
from typing import Sequence

import numpy as np
from pydicom import dcmread
from pydicom.errors import InvalidDicomError

MAX_RENDER_PIXELS = 40_000_000


@dataclass(frozen=True)
class DisplayPngResult:
    png_bytes: bytes
    width: int
    height: int
    frame_index: int
    photometric: str
    native_width: int | None = None
    native_height: int | None = None


def _png_gray(arr_u8: np.ndarray) -> bytes:
    height, width = arr_u8.shape
    raw = b"".join(b"\x00" + arr_u8[y].tobytes() for y in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", ihdr),
            chunk(b"IDAT", zlib.compress(raw, 6)),
            chunk(b"IEND", b""),
        ]
    )


def _png_rgb(arr_u8: np.ndarray) -> bytes:
    if arr_u8.ndim != 3 or arr_u8.shape[2] != 3:
        raise ValueError("expected HxWx3 uint8")
    height, width, _ = arr_u8.shape
    raw = b"".join(b"\x00" + arr_u8[y].tobytes() for y in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", ihdr),
            chunk(b"IDAT", zlib.compress(raw, 6)),
            chunk(b"IEND", b""),
        ]
    )


def window_to_u8(pixels: np.ndarray) -> np.ndarray:
    """Percentile (1–99) window to uint8 2D plane. Aspect preserved."""
    flat = np.asarray(pixels, dtype=np.float64)
    while flat.ndim > 2:
        # Prefer last two dims as spatial when first dims look like frames/channels.
        if flat.shape[0] in (1, 3) and flat.shape[0] < min(flat.shape[1], flat.shape[2]):
            flat = flat[0] if flat.shape[0] == 1 else flat.mean(axis=0)
        else:
            flat = flat[flat.shape[0] // 2]
    if flat.ndim != 2:
        raise ValueError("Expected 2D image after frame selection")
    if flat.size > MAX_RENDER_PIXELS:
        raise ValueError(f"slice too large to render ({flat.size} pixels > {MAX_RENDER_PIXELS})")
    lo, hi = np.percentile(flat, [1, 99])
    if not np.isfinite(lo) or not np.isfinite(hi):
        lo, hi = float(np.min(flat)), float(np.max(flat))
    if hi < lo:
        lo, hi = hi, lo
    if hi <= lo:
        # Flat (or outlier-only) intensity: do not expand to rare spikes via min/max.
        return np.full(flat.shape, 128, dtype=np.uint8)
    scaled = np.clip((flat - lo) / (hi - lo), 0, 1)
    return (scaled * 255.0).astype(np.uint8)


def resize_max_edge(arr: np.ndarray, max_edge: int | None) -> np.ndarray:
    if max_edge is None or max_edge <= 0:
        return arr
    h, w = arr.shape[:2]
    edge = max(h, w)
    if edge <= max_edge:
        return arr
    scale = max_edge / float(edge)
    nh, nw = max(1, int(round(h * scale))), max(1, int(round(w * scale)))
    ys = (np.linspace(0, h - 1, nh)).astype(np.int32)
    xs = (np.linspace(0, w - 1, nw)).astype(np.int32)
    if arr.ndim == 2:
        return arr[ys][:, xs]
    return arr[ys][:, xs, :]


def select_frame_indices(n_frames: int, *, max_frames: int = 3) -> list[int]:
    """Middle + optional quartile indices for a multi-frame DICOM object."""
    if n_frames <= 0:
        return []
    if n_frames == 1 or max_frames <= 1:
        return [n_frames // 2]
    if max_frames == 2:
        return sorted({0, n_frames - 1})
    # mid + ~25% + ~75%
    idxs = {
        n_frames // 2,
        max(0, int(round(0.25 * (n_frames - 1)))),
        min(n_frames - 1, int(round(0.75 * (n_frames - 1)))),
    }
    out = sorted(idxs)
    if len(out) > max_frames:
        # Prefer mid when truncating.
        mid = n_frames // 2
        out = sorted(out, key=lambda i: (abs(i - mid), i))[:max_frames]
        out = sorted(out)
    return out


def plane_from_array(arr: np.ndarray, frame_index: int | None = None) -> tuple[np.ndarray, int]:
    """Extract a 2D (or HxWx3) plane and the frame index used."""
    a = np.asarray(arr)
    if a.ndim == 2:
        return a, 0
    if a.ndim == 3:
        # Channel-first RGB/mono stack with small first dim.
        if a.shape[0] in (1, 3) and a.shape[0] < min(a.shape[1], a.shape[2]):
            if a.shape[0] == 1:
                return a[0], 0
            # HxW from mean of channels for grayscale windowing path.
            return a.mean(axis=0), 0
        # True RGB spatial last.
        if a.shape[2] in (1, 3) and a.shape[2] < min(a.shape[0], a.shape[1]):
            if a.shape[2] == 1:
                return a[:, :, 0], 0
            return a, 0  # keep HxWx3 for RGB encode
        n = a.shape[0]
        idx = n // 2 if frame_index is None else int(frame_index)
        idx = max(0, min(n - 1, idx))
        return a[idx], idx
    # Fallback: last two dims.
    plane = a.reshape((-1, a.shape[-2], a.shape[-1]))
    idx = plane.shape[0] // 2 if frame_index is None else int(frame_index)
    idx = max(0, min(plane.shape[0] - 1, idx))
    return plane[idx], idx


def dicom_bytes_to_png(
    data: bytes,
    *,
    frame_index: int | None = None,
    max_edge: int | None = None,
    as_rgb: bool = True,
) -> DisplayPngResult | None:
    """Decode DICOM pixels to PNG. Returns None on failure (caller skips frame)."""
    try:
        ds = dcmread(BytesIO(data), force=True)
    except (InvalidDicomError, Exception):
        return None
    if not hasattr(ds, "PixelData") and not hasattr(ds, "FloatPixelData"):
        return None
    try:
        arr = np.asarray(ds.pixel_array)
    except Exception:
        return None
    photo = str(getattr(ds, "PhotometricInterpretation", "MONOCHROME2") or "MONOCHROME2")
    try:
        plane, used_idx = plane_from_array(arr, frame_index)
        if plane.ndim == 3 and plane.shape[2] == 3:
            native_h, native_w = int(plane.shape[0]), int(plane.shape[1])
            # RGB: light percentile per channel then optional resize.
            u8 = np.zeros_like(plane, dtype=np.uint8)
            for c in range(3):
                u8[:, :, c] = window_to_u8(plane[:, :, c])
            u8 = resize_max_edge(u8, max_edge)
            if photo.upper() == "MONOCHROME1":
                u8 = 255 - u8
            png = _png_rgb(u8) if as_rgb else _png_gray(u8.mean(axis=2).astype(np.uint8))
            h, w = u8.shape[:2]
        else:
            native_h, native_w = int(plane.shape[0]), int(plane.shape[1])
            u8 = window_to_u8(plane)
            if photo.upper() == "MONOCHROME1":
                u8 = 255 - u8
            u8 = resize_max_edge(u8, max_edge)
            if as_rgb:
                png = _png_rgb(np.stack([u8, u8, u8], axis=-1))
            else:
                png = _png_gray(u8)
            h, w = u8.shape
    except Exception:
        return None
    return DisplayPngResult(
        png_bytes=png,
        width=w,
        height=h,
        frame_index=used_idx,
        photometric=photo,
        native_width=native_w,
        native_height=native_h,
    )


def maybe_image_bytes(
    name: str,
    data: bytes,
    *,
    frame_index: int | None = None,
    max_edge: int | None = None,
) -> bytes | None:
    """Return PNG/JPEG bytes suitable for VLM upload or PDF."""
    lower = (name or "").lower()
    if lower.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")):
        return data
    if data[:8] == b"\x89PNG\r\n\x1a\n" or data[:2] == b"\xff\xd8":
        return data
    result = dicom_bytes_to_png(data, frame_index=frame_index, max_edge=max_edge, as_rgb=True)
    return result.png_bytes if result else None


def is_localizer_label(*parts: str | None) -> bool:
    """Heuristic: series/study labels that are scout/localizer/survey."""
    text = " ".join(p for p in parts if p).upper()
    if not text:
        return False
    needles = (
        "LOCALIZER",
        "LOCALISER",
        "SCOUT",
        "SURVEY",
        "LOCATOR",
        "TOPOGRAM",
        "SCANORAMA",
        "PILOT",
    )
    return any(n in text for n in needles)


def evenly_sample(items: Sequence, limit: int) -> list:
    if limit <= 0:
        return []
    if len(items) <= limit:
        return list(items)
    if limit == 1:
        return [items[len(items) // 2]]
    idxs = [int(round(i * (len(items) - 1) / (limit - 1))) for i in range(limit)]
    return [items[i] for i in dict.fromkeys(idxs)]
