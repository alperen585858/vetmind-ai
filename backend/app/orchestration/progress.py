"""Discrete analysis-job progress (checkpoint-only; never time-interpolated)."""

from __future__ import annotations

from typing import Optional

from app.schemas.jobs import AnalysisJob

# Ordered pipeline stages. progress_pct is assigned only when a stage is entered
# (or when a vision adapter index advances) — not estimated from wall clock / GPU.
PIPELINE_STAGES: tuple[str, ...] = (
    "queued",
    "prep_metadata",
    "route_models",
    "vision_adapters",
    "normalize_findings",
    "llm_draft",
    "validate_report",
    "finalize",
)

# Base percent when the stage begins (vision may advance within [35, 54]).
STAGE_BASE_PCT: dict[str, int] = {
    "queued": 0,
    "prep_metadata": 8,
    "route_models": 18,
    "vision_adapters": 35,
    "normalize_findings": 55,
    "llm_draft": 65,
    "validate_report": 92,
    "finalize": 100,
}

STAGE_LABELS_TR: dict[str, str] = {
    "queued": "Sırada",
    "prep_metadata": "Metadata hazırlığı",
    "route_models": "Model yönlendirme",
    "vision_adapters": "Görüntü analizi",
    "normalize_findings": "Bulgular birleştiriliyor",
    "llm_draft": "Taslak yazılıyor",
    "validate_report": "Rapor doğrulama",
    "finalize": "Tamamlanıyor",
}


def stage_label_tr(stage: str | None) -> str:
    if not stage:
        return "—"
    return STAGE_LABELS_TR.get(stage, stage)


def vision_progress_pct(*, adapter_index: int, adapter_total: int) -> int:
    """Percent while running vision adapters (index is 0-based, currently starting).

    Maps [0, N) into [35, 54] so normalize_findings (55) is still a real step up.
    """
    base = STAGE_BASE_PCT["vision_adapters"]
    span = STAGE_BASE_PCT["normalize_findings"] - base - 1  # leave headroom before 55
    total = max(int(adapter_total), 1)
    idx = max(0, min(int(adapter_index), total - 1))
    return base + int(span * idx / total)


def vision_batch_progress_pct(
    *,
    adapter_index: int,
    adapter_total: int,
    batch_index: int,
    batch_total: int,
) -> int:
    """Refine vision % using completed VLM batches inside the current adapter slot."""
    base = STAGE_BASE_PCT["vision_adapters"]
    span = STAGE_BASE_PCT["normalize_findings"] - base - 1
    adapters = max(int(adapter_total), 1)
    a_idx = max(0, min(int(adapter_index), adapters - 1))
    # Slice of the vision band owned by this adapter.
    slice_w = span / adapters
    slice_start = base + int(slice_w * a_idx)
    batches = max(int(batch_total), 1)
    # batch_index is 0-based "about to run / just finished" — use completed count.
    done = max(0, min(int(batch_index) + 1, batches))
    return slice_start + int((slice_w - 0.01) * done / batches)


def apply_pipeline_progress(
    job: AnalysisJob,
    stage: str,
    *,
    vision_adapter_index: Optional[int] = None,
    vision_adapter_total: Optional[int] = None,
    vision_batch_index: Optional[int] = None,
    vision_batch_total: Optional[int] = None,
    vision_frames_detected: Optional[int] = None,
    vision_frames_analyzed: Optional[int] = None,
    vision_series_total: Optional[int] = None,
    vision_series_done: Optional[int] = None,
    vision_analysis_scope: Optional[str] = None,
    vision_detail: Optional[str] = None,
    done: bool = False,
) -> None:
    """Mutate job progress fields from a real orchestrator checkpoint."""
    if stage not in STAGE_BASE_PCT and not done:
        stage = "prep_metadata"
    job.pipeline_stage = "finalize" if done else stage
    if done:
        job.progress_pct = 100
        job.stage_label = STAGE_LABELS_TR["finalize"]
        job.vision_adapter_index = vision_adapter_index
        job.vision_adapter_total = vision_adapter_total
        return

    if (
        stage == "vision_adapters"
        and vision_adapter_index is not None
        and vision_adapter_total is not None
        and vision_adapter_total > 0
        and vision_batch_index is not None
        and vision_batch_total is not None
        and vision_batch_total > 0
    ):
        job.progress_pct = vision_batch_progress_pct(
            adapter_index=vision_adapter_index,
            adapter_total=vision_adapter_total,
            batch_index=vision_batch_index,
            batch_total=vision_batch_total,
        )
    elif (
        stage == "vision_adapters"
        and vision_adapter_index is not None
        and vision_adapter_total is not None
        and vision_adapter_total > 0
    ):
        job.progress_pct = vision_progress_pct(
            adapter_index=vision_adapter_index,
            adapter_total=vision_adapter_total,
        )
    else:
        job.progress_pct = STAGE_BASE_PCT.get(stage, 0)

    if vision_detail:
        job.stage_label = vision_detail
    else:
        job.stage_label = STAGE_LABELS_TR.get(stage, stage)
    if vision_adapter_index is not None:
        job.vision_adapter_index = vision_adapter_index
    if vision_adapter_total is not None:
        job.vision_adapter_total = vision_adapter_total
    if vision_batch_index is not None:
        job.vision_batch_index = vision_batch_index
    if vision_batch_total is not None:
        job.vision_batch_total = vision_batch_total
    if vision_frames_detected is not None:
        job.vision_frames_detected = vision_frames_detected
    if vision_frames_analyzed is not None:
        job.vision_frames_analyzed = vision_frames_analyzed
    if vision_series_total is not None:
        job.vision_series_total = vision_series_total
    if vision_series_done is not None:
        job.vision_series_done = vision_series_done
    if vision_analysis_scope is not None:
        job.vision_analysis_scope = vision_analysis_scope
    if vision_detail is not None:
        job.vision_detail = vision_detail
