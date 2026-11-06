# VLM / PDF quality — MR & XR smoke notes

Engineering quality pass only. Gemini (and other general VLMs) are **not** veterinary-validated; radiologist review remains mandatory.

## What the model actually sees (pipeline)

1. **VLM (pixels once):** Quarantine DICOM/JPG → PNG (percentile window, MONOCHROME1 invert). Up to `VETMIND_VLM_MAX_IMAGES` (default 6, hard cap 12). Localizers deprioritized; multi-frame objects contribute mid+quartile frames. Each PNG is labeled `IMG-n` with series/SOP/instance/frame catalog.
2. **Structured findings:** VLM JSON mapped to `Finding` + `EvidenceReference` (series UID, SOP, instance #, frame, optional bbox). Metadata: `images_sent`, `study_dicom_instances`, `sent_image_catalog_json`, ungrounded count.
3. **Report LLM (text only):** Receives finding descriptions + evidence locus strings + RAG passages — **does not get pixels again**.
4. **PDF:** Separate illustrative thumbnails (max 4) + report prose; not the exact VLM bundle unless SOP overlap happens by chance.

## Fixed in this pass

| Area | Before | After |
|------|--------|-------|
| DICOM → PNG | Min–max; VLM skipped MONOCHROME1 invert | Shared `display_png` percentile + invert |
| Slice pick / inventory | Opaque sampling | Localizer deprioritized; study vs sent counts in metadata |
| Evidence binding | Generic “inspected N images” | Per-finding IMG/SOP/instance/frame + optional bbox |
| Unverifiable claims | Accepted as suspected | Ungrounded lesions → uncertain; unknown MR sequence blocks signal-as-pathology |
| Report prose | English pipeline crumbs / repeats | `sanitize_report_prose` |
| PDF whitespace | Aggressive KeepTogether + large spacers | Short-section KeepTogether only; smaller images/spacers; TR evidence heading |
| UI | Finding text only | Evidence locus + uncertainty + VLM image counts |
| Verification tests | — | no / wrong / correct image scenarios in `test_vlm_image_grounding.py` |

## Remaining gaps (expected)

- Still not a full-volume read — capped frame sample, not every MR slice.
- VLM can still hallucinate; grounding + demotion reduce but do not eliminate it.
- Report LLM never re-sees pixels.
- No DICOM WW/WC presets; bbox is on the **sent PNG**, not automatically reprojected to a PACS viewer.
- Clinical validation / species-calibrated models are out of scope.

## Suggested manual smoke

1. **MR brain** with Localizer + axial series: confirm VLM metadata prefers non-localizer SOPs; draft discusses real/uncertain findings or technical notes, not empty template.
2. **XR thorax** single-frame: PNG renders with correct polarity; PDF shows TR species, citation legend when [F#]/[S#] present, and demo approver labeled if reviewer id contains `demo`.
