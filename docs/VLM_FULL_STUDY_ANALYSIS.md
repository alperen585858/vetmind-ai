# Full-study VLM analysis (honest coverage)

## Why it used to look like “one image”

`VETMIND_VLM_MAX_IMAGES` (default 6, hard cap 12) sampled a **single API request**.
`normalize_outputs` also dropped `processing_metadata`, so the UI could not show how many
frames were actually sent.

## Architecture now

| Stage | Module | Behavior |
|-------|--------|----------|
| A – Inventory | `study_inventory.py` | Count every DICOM file / `NumberOfFrames`; record undecodable paths |
| B – Plan + batches | `vlm_batch_planner.py` + `vlm_vision.analyze` | Budget frames across series; call VLM in batches of `VETMIND_VLM_MAX_IMAGES` |
| C – Merge | `_dedupe_findings` | Same code+location across batches merged with evidence refs |
| D – Report | existing LLM gateway | Text findings + evidence loci (still no second pixel pass) |

## Settings

| Env | Meaning |
|-----|---------|
| `VETMIND_VLM_MAX_IMAGES` | Images **per batch** (≤12) |
| `VETMIND_VLM_MAX_TOTAL_FRAMES` | Total visual budget across batches (≤1000, default **128**) |
| `VETMIND_VLM_INCLUDE_LOCALIZERS` | Include scout/localizer in budget (default off) |

If a study has 350 non-localizer frames and budget=128 → `analysis_scope=partial`,
`frames_visually_analyzed=128`, never “350 analyzed”. Set budget ≥ study size (max 1000)
for `full` scope.

## Coverage DTO

`StructuredFindings.analysis_coverage` (+ flat keys in `processing_metadata`).
UI: Case detail “Analiz kapsamı” card.
Live job poll: `vision_batch_*`, `vision_frames_*`, `vision_series_*`, `vision_detail`
on Processing screen.

## Cache

Per-case batch JSON cache under quarantine `/_vlm_batch_cache` (case_id in key —
no cross-patient reuse).

## Tests

`tests/test_vlm_study_scale.py` — 10/50/100/300/1000 inventory planning + partial E2E.
`tests/test_vlm_progress_and_cache.py` — progress callbacks + cache hits.
Software tests ≠ clinical validation.
