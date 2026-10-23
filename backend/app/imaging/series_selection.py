"""Study/series/instance selection for model inputs using DICOM spatial metadata.

Never invents missing IPP/spacing. Defaults are deterministic heuristics for XR 2D
and MRI/CT 3D profiles — not clinical hanging protocols.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

from app.imaging.pixel_ops import parse_image_position, slice_sort_key
from app.schemas.enums import Modality
from app.schemas.model_input import ModelInputFrameRef, ModelInputSeriesRef


@dataclass(frozen=True)
class SeriesSelection:
    """Selected series UIDs + ordered frames for prep/routing."""

    mode: str
    series_instance_uids: tuple[str, ...]
    frames: tuple[ModelInputFrameRef, ...]
    reason: str
    profile_hint: str  # xray_2d | mri_volume | ct_volume | metadata_only


def _frame_has_spatial(fr: ModelInputFrameRef) -> bool:
    return parse_image_position(fr.image_position_patient) is not None


def _sort_frames(frames: Sequence[ModelInputFrameRef]) -> list[ModelInputFrameRef]:
    keyed = [
        (
            slice_sort_key(
                image_position_patient=fr.image_position_patient,
                instance_number=fr.instance_number,
                sop_instance_uid=fr.sop_instance_uid,
            ),
            fr,
        )
        for fr in frames
    ]
    keyed.sort(key=lambda x: x[0])
    return [fr for _, fr in keyed]


def _series_score(series: ModelInputSeriesRef, *, prefer_3d: bool) -> tuple:
    """Higher is better. Prefer more frames + spatial coverage for 3D."""
    frames = series.frames
    n = len(frames)
    spatial = sum(1 for f in frames if _frame_has_spatial(f))
    pixels = sum(1 for f in frames if f.has_pixel_data)
    if prefer_3d:
        return (spatial, n, pixels, series.series_instance_uid)
    # 2D: prefer single-frame with pixels
    single_bonus = 1 if n == 1 else 0
    return (pixels, single_bonus, -n, series.series_instance_uid)


def select_series_for_modality(
    series: Sequence[ModelInputSeriesRef],
    modality: Modality,
    *,
    preferred_series_uids: Iterable[str] | None = None,
) -> SeriesSelection:
    """Pick series/instances for XR 2D or MRI/CT 3D model profiles."""
    if not series:
        return SeriesSelection(
            mode="empty",
            series_instance_uids=(),
            frames=(),
            reason="No series on ImagingModelInput.",
            profile_hint="metadata_only",
        )

    preferred = {u for u in (preferred_series_uids or []) if u}
    candidates = [s for s in series if s.series_instance_uid in preferred] if preferred else list(series)
    if preferred and not candidates:
        candidates = list(series)

    if modality == Modality.XR:
        best = max(candidates, key=lambda s: _series_score(s, prefer_3d=False))
        ordered = _sort_frames(best.frames)
        # XR uses a single frame — first after spatial/instance sort.
        picked = ordered[:1] if ordered else ()
        return SeriesSelection(
            mode="xray_single_frame",
            series_instance_uids=(best.series_instance_uid,),
            frames=tuple(picked),
            reason=(
                f"XR 2D: selected series {best.series_instance_uid} "
                f"({len(best.frames)} instance(s)); using first sorted frame."
            ),
            profile_hint="xray_2d",
        )

    if modality in {Modality.MR, Modality.CT}:
        best = max(candidates, key=lambda s: _series_score(s, prefer_3d=True))
        ordered = _sort_frames(best.frames)
        hint = "mri_volume" if modality == Modality.MR else "ct_volume"
        spatial_n = sum(1 for f in ordered if _frame_has_spatial(f))
        return SeriesSelection(
            mode="volume_stack",
            series_instance_uids=(best.series_instance_uid,),
            frames=tuple(ordered),
            reason=(
                f"{modality.value} 3D: selected series {best.series_instance_uid} "
                f"with {len(ordered)} frame(s), {spatial_n} with ImagePositionPatient; "
                "sorted by IPP/InstanceNumber."
            ),
            profile_hint=hint,
        )

    # Other modalities: keep all series, sort within each (metadata routing).
    all_frames: list[ModelInputFrameRef] = []
    uids: list[str] = []
    for s in candidates:
        uids.append(s.series_instance_uid)
        all_frames.extend(_sort_frames(s.frames))
    return SeriesSelection(
        mode="passthrough",
        series_instance_uids=tuple(uids),
        frames=tuple(all_frames),
        reason=f"Modality {modality.value}: passthrough of {len(candidates)} series.",
        profile_hint="metadata_only",
    )


def case_dimensionality_ok(
    *,
    modality: Modality,
    frame_count: int,
    spatial_frame_count: int,
    requires_2d: bool,
    requires_3d: bool,
) -> tuple[bool, str]:
    """Router helper: geometry vs pixels_2d / pixels_3d requirements."""
    if requires_3d:
        if frame_count < 2:
            return False, "pixels_3d requires ≥2 instances in selected series."
        if spatial_frame_count < 2 and frame_count < 3:
            return (
                False,
                "pixels_3d prefers ≥2 frames with ImagePositionPatient "
                "(or ≥3 instances ordered by InstanceNumber).",
            )
        return True, "ok"
    if requires_2d:
        if frame_count < 1:
            return False, "pixels_2d requires ≥1 instance."
        return True, "ok"
    return True, "ok"
