"""Honest study-level analysis coverage (never claim full visual analysis unless earned)."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class SeriesCoverage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    series_instance_uid: Optional[str] = None
    series_description: Optional[str] = None
    is_localizer: bool = False
    frames_detected: int = 0
    frames_planned: int = 0
    frames_visually_analyzed: int = 0
    analyzed: bool = False


class SkippedFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    reason: str


class AnalysisCoverage(BaseModel):
    """What the pipeline found vs what pixels were actually sent to a vision model."""

    model_config = ConfigDict(extra="forbid")

    dicom_files_total: int = 0
    dicom_files_undecodable: int = 0
    series_total: int = 0
    series_analyzed: int = 0
    frames_detected: int = 0
    frames_detected_non_localizer: int = 0
    frames_planned: int = 0
    frames_visually_analyzed: int = 0
    frames_skipped: int = 0
    batches_total: int = 0
    batches_succeeded: int = 0
    batches_failed: int = 0
    per_batch_image_cap: int = 0
    total_frame_budget: int = 0
    include_localizers: bool = False
    analysis_scope: Literal["full", "partial", "none"] = "none"
    analysis_complete: bool = False
    note: str = (
        "frames_visually_analyzed counts PNGs actually sent to the vision model. "
        "Metadata inventory alone is not visual analysis. "
        "partial means the study had more detectable frames than the budget allowed."
    )
    series: list[SeriesCoverage] = Field(default_factory=list)
    skipped_files: list[SkippedFile] = Field(default_factory=list)

    def finalize(self) -> "AnalysisCoverage":
        """Recompute scope flags from counts (call after analysis)."""
        target = (
            self.frames_detected
            if self.include_localizers
            else self.frames_detected_non_localizer
        )
        analyzed = self.frames_visually_analyzed
        skipped = max(0, target - analyzed)
        if analyzed <= 0:
            scope: Literal["full", "partial", "none"] = "none"
            complete = False
        elif target > 0 and analyzed >= target:
            scope = "full"
            complete = True
        else:
            scope = "partial"
            complete = False
        series_analyzed = sum(1 for s in self.series if s.frames_visually_analyzed > 0)
        return self.model_copy(
            update={
                "frames_skipped": skipped,
                "series_analyzed": series_analyzed,
                "analysis_scope": scope,
                "analysis_complete": complete,
            }
        )

    def to_metadata(self) -> dict[str, str]:
        """Flat string map for processing_metadata (API/UI without schema change)."""
        import json

        return {
            "analysis_scope": self.analysis_scope,
            "analysis_complete": "true" if self.analysis_complete else "false",
            "dicom_files_total": str(self.dicom_files_total),
            "dicom_files_undecodable": str(self.dicom_files_undecodable),
            "series_total": str(self.series_total),
            "series_analyzed": str(self.series_analyzed),
            "frames_detected": str(self.frames_detected),
            "frames_detected_non_localizer": str(self.frames_detected_non_localizer),
            "frames_planned": str(self.frames_planned),
            "frames_visually_analyzed": str(self.frames_visually_analyzed),
            "images_sent": str(self.frames_visually_analyzed),  # alias for older UI
            "frames_skipped": str(self.frames_skipped),
            "batches_total": str(self.batches_total),
            "batches_succeeded": str(self.batches_succeeded),
            "batches_failed": str(self.batches_failed),
            "vlm_max_images_cap": str(self.per_batch_image_cap),
            "vlm_max_total_frames": str(self.total_frame_budget),
            "analysis_coverage_json": self.model_dump_json()[:12000],
            "series_coverage_json": json.dumps(
                [s.model_dump() for s in self.series], ensure_ascii=False
            )[:8000],
        }
