# Phase 20 — Final AI Integration Readiness

Finalizes Phase 8–9 / Phase 19 wiring for **future** MRI, CT and X-ray real-model integration.  
**No real models are downloaded, trained, loaded, or connected.**

## Delivered

1. **Multi-ingest → AI package** — `merge_case_dicom_attachments` unions Phase 19 DICOM `attachment_refs` into `case.dicom_study` (accept + `prepare_model_input`).
2. **Series selection** — `imaging/series_selection.py` picks XR single-frame or MRI/CT volume stacks using IPP / InstanceNumber (never invents tags).
3. **Profiles** — Existing `xray_2d` / `mri_volume` / `ct_volume` profiles surfaced on `ImagingModelInput.preprocessing_profile_hint` + selection summary.
4. **Router** — `ModelRouter` checks modality, species, region, availability, pixel auth, and **dimensionality** (`pixels_2d` / `pixels_3d`).
5. **Schema validation** — `schema_validation.py` for `ImagingModelInput` / `ModelTaskOutputs` + config blockers (weights/endpoint/CT window).
6. **Bridge provenance** — IntegrationBridge stamps `model_id`, `model_version`, prep contract, selected series, linked ingests; validates task outputs; no silent mock fallback on typed failures.
7. **Readiness** — `GET /models/readiness` includes per-model `blockers`, `ready_for_real_integration`, and `remaining_steps_to_first_real_model` (shown on System Status).
8. **Synthetic walkthrough** — `run_synthetic_integration_walkthrough`: DICOM → selection → profile prep → bridge → findings → stub LLM draft (no fabricated clinical scores).

## Remaining steps to connect the first real model

1. Register `ModelCapability` with `source_kind=real` only after legal/ethics review; keep pixel access default-deny until consented.
2. Supply `weights_path` (local torch) or `endpoint_url` (HTTP) via secure env — never commit secrets.
3. Set `preprocessing_contract_id` to the matching profile (`profile.mri_volume` / `ct_volume` / `xray_2d`).
4. For CT: pass explicit `window_center` / `window_width` at analyze time (no silent clinical presets).
5. Ensure case `imaging_source_permission_verified` + `imaging_analysis_consent_verified`.
6. Verify multi-ingest merge + selection on `POST /cases/{id}/model-input`.
7. Route analyze through IntegrationBridge (not mock adapters); fail closed on typed errors.
8. Keep approved report immutability and expert review gates.

## Tests

`backend/tests/test_phase20_ai_readiness.py` (+ Phase 8/9 / model_input regression).

## Limits

- Default production analyze path still uses mock/metadata adapters until a real adapter is registered.
- Not clinical/PACS-grade validation.
- Pixel tensors remain policy-gated and absent from `ImagingModelInput` packages.
