"""Stage B planning — allocate a visual-analysis budget across series honestly.

Never marks unselected frames as analyzed. Prefer non-localizer series; ensure each
eligible series gets at least a few frames when budget allows; sample evenly within
a series. Multi-frame objects are already expanded into InventoryFrame rows.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models.study_inventory import InventoryFrame, StudyInventory, evenly_pick
from app.schemas.analysis_coverage import AnalysisCoverage, SeriesCoverage


@dataclass
class AnalysisPlan:
    frames: list[InventoryFrame]
    coverage: AnalysisCoverage
    batches: list[list[InventoryFrame]]

    @property
    def planned_count(self) -> int:
        return len(self.frames)


def _frame_key(f: InventoryFrame) -> tuple:
    return (f.quarantine_rel, f.frame_index, f.sop_instance_uid or "")


def _allocate_per_series(series_frames: list[InventoryFrame], quota: int) -> list[InventoryFrame]:
    if quota <= 0 or not series_frames:
        return []
    ordered = sorted(
        series_frames,
        key=lambda f: (
            f.instance_number is None,
            f.instance_number or 0,
            f.frame_index,
            f.sop_instance_uid or "",
        ),
    )
    return evenly_pick(ordered, quota)


def _series_key(f: InventoryFrame) -> str:
    return f.series_instance_uid or f"file:{f.quarantine_rel}"


def plan_visual_analysis(
    inventory: StudyInventory,
    *,
    max_total_frames: int,
    per_batch_images: int,
    include_localizers: bool = False,
) -> AnalysisPlan:
    max_total_frames = max(1, int(max_total_frames))
    per_batch_images = max(1, min(int(per_batch_images), 12))

    coverage = inventory.coverage_skeleton(
        per_batch_image_cap=per_batch_images,
        total_frame_budget=max_total_frames,
        include_localizers=include_localizers,
    )

    eligible = [f for f in inventory.frames if include_localizers or not f.is_localizer]
    used_localizer_fallback = False
    if not eligible and inventory.frames:
        eligible = list(inventory.frames)
        used_localizer_fallback = True
        coverage = coverage.model_copy(update={"include_localizers": True})

    groups: dict[str, list[InventoryFrame]] = {}
    for fr in eligible:
        groups.setdefault(_series_key(fr), []).append(fr)
    series_items = list(groups.items())
    n_series = max(1, len(series_items))

    floor = 0
    if max_total_frames >= n_series:
        floor = min(3, max(1, max_total_frames // n_series))

    planned: list[InventoryFrame] = []
    remaining = max_total_frames
    planned_keys: set[tuple] = set()

    def _add(frames: list[InventoryFrame]) -> None:
        nonlocal remaining
        for fr in frames:
            k = _frame_key(fr)
            if k in planned_keys or remaining <= 0:
                continue
            planned.append(fr)
            planned_keys.add(k)
            remaining -= 1

    for _key, frames in series_items:
        if remaining <= 0:
            break
        _add(_allocate_per_series(frames, min(floor, len(frames), remaining)))

    if remaining > 0:
        total_size = sum(len(frames) for _, frames in series_items) or 1
        for _key, frames in series_items:
            if remaining <= 0:
                break
            left = [f for f in frames if _frame_key(f) not in planned_keys]
            share = max(1, int(round(max_total_frames * (len(frames) / total_size))))
            # Only use remaining budget for this share.
            take = min(share, len(left), remaining)
            _add(_allocate_per_series(left, take))

    planned = planned[:max_total_frames]

    new_series: list[SeriesCoverage] = []
    for sc in coverage.series:
        count = 0
        for fr in planned:
            if sc.series_instance_uid and fr.series_instance_uid == sc.series_instance_uid:
                count += 1
            elif (
                not sc.series_instance_uid
                and fr.series_description == sc.series_description
                and (fr.series_instance_uid is None)
            ):
                count += 1
        new_series.append(sc.model_copy(update={"frames_planned": count}))

    # If series list empty but we planned file-only frames, synthesize coverage rows.
    if not new_series and planned:
        for key, frames in series_items:
            count = sum(1 for fr in planned if _series_key(fr) == key)
            new_series.append(
                SeriesCoverage(
                    series_instance_uid=None if key.startswith("file:") else key,
                    series_description=frames[0].series_description,
                    is_localizer=all(f.is_localizer for f in frames),
                    frames_detected=len(frames),
                    frames_planned=count,
                )
            )

    batches: list[list[InventoryFrame]] = [
        planned[i : i + per_batch_images] for i in range(0, len(planned), per_batch_images)
    ] if planned else []

    coverage = coverage.model_copy(
        update={
            "frames_planned": len(planned),
            "series": new_series,
            "batches_total": len(batches),
            "include_localizers": include_localizers or used_localizer_fallback,
        }
    )
    return AnalysisPlan(frames=planned, coverage=coverage, batches=batches)
