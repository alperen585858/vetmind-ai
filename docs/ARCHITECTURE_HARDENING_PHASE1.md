# Architecture Hardening Phase 1

**Scope:** DICOM Ingestion → Classification → Model Routing  
**Date:** 2026-10-24  
**Constraint:** Synthetic DICOM + mock adapters only (no clinical data, GPU, or paid APIs)

---

## 1. Existing architecture overview

VetMind is a React + FastAPI veterinary teleradiology prototype. The imaging path before LLM draft generation is:

```
Upload DICOM bytes
    → QuarantineStore (bytes retained; malware scan optional)
    → parse_dicom_bytes (metadata only; never pixel_array for diagnosis)
    → validate_parsed_instances (Study → Series → Instance tree)
    → classify_study (deterministic heuristics; no LLM)
    → DicomIngestionRecord (pre-case)
    → confirm classification (human gate)
    → CaseRecord + ImagingModelInput
    → AIOrchestrator
         → MetadataOnlyPreparationPipeline
         → ModelRouter (capability match)
         → ScenarioRoutingPolicy (demo overrides only)
         → ModelExecutionPolicy (exclusive_real default)
         → ImagingModel adapters
         → normalize_outputs (provenance / conflicts)
         → LLMGateway (+ RAG) → ReportValidator
```

Composition root: `AppContainer` (`backend/app/container.py`). Pixel analysis remains default-deny via `evaluate_pixel_access` and capability `allows_pixel_analysis`.

---

## 2. Findings from the initial code review

### Already solid

- Multi-file ingest into a single study tree with soft SOP dedupe
- Metadata-only parser (Part 10) and quarantine separation from PDF/documents
- Capability-based router independent of MockScenario and concrete adapters
- `exclusive_real` execution policy that drops overlapping mocks when a REAL model matches
- Orchestrator fail-closed paths for unsupported studies and LLM provider errors
- Confirm gate before analyze (`classification_confirmed`)

### Gaps addressed in this phase

| Gap | Risk | Fix |
|-----|------|-----|
| `prepared_for_models` used anatomy-only matching | UI/readiness could overstate runnable models vs router | Shared `list_routable_model_ids` |
| Incomplete UID issues marked ERROR while study still confirmable | Ambiguous “blocking” semantics | Incomplete UIDs → WARNING; confirm uses `blocked` |
| `has_blocking_errors` unused / severity-based | Drift from real confirm gate | Wired to `blocked` / hard-block codes |
| Classification lacked explicit status / species / conflict labels | Harder to reason about ambiguous uploads | `ClassificationStatus` + species suggestion + conflict path |
| Manual confirm override lost confidence/rationale | Weak audit trail | Persist override flags on `StudyInfo` |
| Job routing trace incomplete | Hard to debug route decisions | `route_rule_id`, `matched_capabilities` on `AnalysisJob` |
| Exclusive real kept unknown capability IDs | Possible silent non-real execution | Drop unknown IDs when REAL matches |
| Missing multi-sequence / IPP fixtures | Spatial selection not exercised via DICOM bytes | `brain_mri_multisequence_files` |
| No orchestrator test for remote fail under exclusive_real | Mock fallback regression risk | Phase-1 integration test |

---

## 3. Changes implemented

### DICOM ingest / validation

- Incomplete Study/Series/SOP UID instances emit **WARNING** and are excluded; upload blocks only when no complete instances remain (or hard failures: empty, inconsistent study UID, unsupported-only modality).
- `DicomIngestResult.confirmable` property documents the confirm gate.
- `has_blocking_errors(..., blocked=)` prefers the authoritative `blocked` flag.

### Classification

- New enum `ClassificationStatus`: `ready | ambiguous | unsupported | missing_metadata | conflicting`.
- `ClassificationSuggestion` extended with `classification_status`, `suggested_species`, `species_confidence`.
- Species suggested **only** from clear canine XOR feline tokens; never invented when absent; conflicting tokens leave species unset.
- Mixed supported modalities in one study → `CONFLICTING` + `needs_confirmation`.
- Ambiguous multi-region tokens → `AMBIGUOUS` + `UNKNOWN` region.
- Still **no LLM** in classification.

### Confirm / contracts

- Manual override sets `StudyInfo.classification_override=True`, confidence `unknown`, status `ambiguous`, and appends rationale.
- Accept-suggestion path stores classifier status/rationale/confidence.

### Routing

- `list_routable_capabilities` / `list_routable_model_ids` shared by router and `build_imaging_model_input`.
- `ModelExecutionPolicy` exclusive_real retains only REAL model IDs (drops mocks **and** unknown IDs).
- Orchestrator records `route_rule_id`, `matched_capabilities`, and series-selection summary messages.

### Fixtures

- Multi-sequence brain MRI with monotonic `ImagePositionPatient`.
- Mixed-modality, ambiguous-region, and partial missing-UID helpers.

---

## 4. Updated DICOM → router data flow

```
files[]
  ├─ malformed → ERROR, may still proceed if other files OK
  ├─ incomplete UIDs → WARNING, instance dropped
  ├─ duplicate SOP → WARNING, keep first
  ├─ mixed MR+CT → WARNING MIXED_MODALITY + classification CONFLICTING
  └─ unsupported-only → blocked=True

classify_study(study)
  → modality / region / optional species + ClassificationStatus
  → needs_confirmation when not high-confidence ready

confirm(accept | override)
  → CaseRecord(modality, region, classification_confirmed=True)
  → ImagingModelInput.prepared_for_models == ModelRouter.route(...).model_ids

analyze
  → execution_policy(exclusive_real)
  → if REAL routed and adapter fails → FAILED, no mock fallback, no draft
```

---

## 5. Key architectural decisions

1. **Confirm gate remains `ValidationResult.blocked`**, not “any ERROR issue”. Advisory problems must not silently prevent legitimate multi-file uploads that still have a valid study tree.
2. **Router and prepared_for_models share one filter** so readiness cannot lie about runnable adapters.
3. **Fail-closed exclusive_real:** a configured REAL match never co-runs mocks; a REAL failure does not re-route to mock.
4. **Classification stays deterministic and metadata-only**; human confirmation is required for ambiguous/conflicting/unsupported/missing cases (and for medium/low confidence).
5. **Pixel authorization unchanged:** mocks and default capabilities remain metadata-only; pixel-requiring capabilities without authorization route to manual review / are excluded from prepared_for.

---

## 6. Remaining limitations

- Part 10 DICOM only (no `force=True` implicit DICOM).
- Anatomical tokens cover brain / cervical / thorax heuristics only.
- Species suggestion is text-token based (not a PatientSpecies DICOM tag reader yet).
- XR still defaults weakly to THORAX when region tokens are absent (explicitly low confidence + confirmation).
- Multimodal VLM route is metadata stub for `OTHER` + `UNKNOWN`/`OTHER`, not true image+text fusion.
- No real Vision weights; remote HTTP adapter is a wire-contract extension point.
- Frontend not redesigned in this phase (API fields are additive/backward compatible).

---

## 7. Test results

Primary suite: `backend/tests/test_phase1_hardening.py` covering:

1. Valid brain MRI metadata (+ species hint + route)
2. Valid cervical MRI metadata
3. Multiple series within one study (IPP present)
4. Missing / conflicting / ambiguous metadata
5. Unsupported modality / anatomical region → manual review
6. Duplicate SOP soft-dedupe
7. Corrupted input blocked
8. Pixel access not authorized + prepared_for alignment
9. Mock/real exclusive vs mixed policy
10. Real remote failure under exclusive_real → no mock fallback
11. Provenance preserved on mock success
12. Confirm override persistence + orchestrator route trace

Run (from repo):

```bash
cd backend && .venv/bin/python -m pytest -q \
  tests/test_phase1_hardening.py \
  tests/test_dicom.py tests/test_router.py tests/test_execution_policy.py \
  tests/test_model_input.py tests/test_ct_xr.py \
  tests/test_orchestrator.py tests/test_ai_contracts.py \
  tests/test_pixel_authorization.py tests/test_phase3_ai_readiness.py \
  tests/test_phase7_hardening.py tests/test_phase8_ai_readiness.py \
  tests/test_remote_capabilities.py tests/test_registry_consistency.py \
  tests/test_http_vision.py
```

**Result (2026-10-24):** all selected tests passed (`138` green; deprecation warnings only from Starlette/FastAPI test client).

---

## 8. Files touched (implementation)

- `backend/app/schemas/enums.py` — `ClassificationStatus`
- `backend/app/schemas/dicom.py` — classification contract fields
- `backend/app/schemas/findings.py` — `StudyInfo` override/rationale fields
- `backend/app/schemas/jobs.py` — route trace fields
- `backend/app/dicom/classifier.py` — status / species / conflict hardening
- `backend/app/dicom/validator.py` — advisory incomplete UIDs
- `backend/app/dicom/ingest.py` — confirmable + blocking helper semantics
- `backend/app/dicom/fixtures.py` — multi-sequence / conflict fixtures
- `backend/app/routing/model_router.py` — shared routable listing
- `backend/app/routing/execution_policy.py` — drop unknown under exclusive_real
- `backend/app/routing/__init__.py` — exports
- `backend/app/models/model_input_builder.py` — prepared_for ↔ router alignment
- `backend/app/orchestration/orchestrator.py` — job route trace
- `backend/app/services/dicom_service.py` — confirm override persistence
- `backend/tests/test_phase1_hardening.py` — regression suite
- `docs/ARCHITECTURE_HARDENING_PHASE1.md` — this document
