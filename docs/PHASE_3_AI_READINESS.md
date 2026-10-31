# VetMind AI — Phase 3: Real AI Integration Readiness

**Status:** Architecture ready for future real imaging models.  
**Not claimed:** Clinical validation, production certification, encryption-at-rest, anonymization pipeline, or multi-tenant isolation.

Payment, checkout, pricing, and billing remain out of scope. No real models are connected or trained in this phase. Demo/mock mode remains the default and fully functional.

---

## 1. Architecture changes

Phase 3 hardens the existing modular path without rewriting Phases 1–2:

```
Case / DICOM confirm
  → MetadataOnlyPreparationPipeline (ImagingModelInput, metadata-only)
  → ModelRouter + ScenarioPolicy + ExecutionPolicy
  → ImagingModel adapters (mock registry; optional HTTP Vision if configured)
  → normalize_outputs (fusion) → StructuredFindings
  → LLMGateway (+ optional RAG) → DraftReport
  → ReportValidator → expert review gates
```

Async jobs: `POST /cases/{id}/analyze/async` → job backend (thread default / RQ optional) → poll `GET /jobs/{id}`; cooperative cancel via `POST /jobs/{id}/cancel`. Frontend poll abort does **not** cancel backend work.

### Key additions

| Area | Change |
|------|--------|
| Image prep | `backend/app/imaging/` — decoder / volume / preprocess / preparer Protocols; `PreprocessingContract`; metadata-only pipeline |
| Capabilities | `ModelCapability` declares version, input/output schema ids, timeout, resource hint, pixel flag |
| Jobs | `cancel_requested`, `CANCELLED`, `TIMED_OUT`, `idempotency_key`, `analysis_mode`, `timeout_s`, `routed_model_versions` |
| HTTP policy | Vision/LLM POST never auto-retried (`HttpClientPolicy.post_max_retries=0`) |
| DICOM geometry | Rows/Columns, PixelSpacing, SliceThickness, IOP/IPP propagated into model input frames when present |
| LLM DTO | `findings_source_kind` / model identity separated from `rag_passages`; `rag_is_clinical_validation=false` |
| Frontend | Processing page shows backend job fields; DEMO/MOCK vs REAL/MIXED banners; `progress_pct` only from orchestrator stage checkpoints (never time/GPU estimates) |

---

## 2. Modified / new files

### New

- `backend/app/imaging/__init__.py`
- `backend/app/imaging/interfaces.py`
- `backend/app/imaging/contracts.py`
- `backend/app/imaging/metadata_prep.py`
- `backend/app/http_policy.py`
- `backend/tests/test_phase3_ai_readiness.py`
- `docs/PHASE_3_AI_READINESS.md`

### Modified (selected)

- `backend/app/orchestration/orchestrator.py` — prep pipeline, cancel checks, analysis_mode, timeout from caps, no silent LLM mock fallback
- `backend/app/services/case_service.py` — idempotent enqueue, cooperative cancel
- `backend/app/api/analysis.py` — cancel route, `Idempotency-Key`
- `backend/app/routing/capabilities.py` — Phase 3 capability fields
- `backend/app/routing/remote_config.py` — remote cap versions/timeouts
- `backend/app/models/http_vision.py` — timeout, confidence validation, processing_metadata
- `backend/app/models/model_input_builder.py` — geometry + transfer syntax on frames
- `backend/app/dicom/parser.py`, `schemas/dicom.py`, `validator.py` — geometry tags (metadata only)
- `backend/app/schemas/jobs.py`, `findings.py`, `enums.py`, `model_input.py`
- `backend/app/llm/interfaces.py`, `gateway.py`
- `backend/app/storage/quarantine.py` — path hardening, `cleanup_temp_dir`
- `backend/app/container.py` — `imaging_prep`
- `src/pages/Processing.tsx`, `src/lib/backend.ts`
- `backend/tests/test_async_analyze.py` — idempotent duplicate enqueue

---

## 3. New interfaces and contracts

### Imaging prep (`app.imaging`)

| Protocol | Role |
|----------|------|
| `DicomDecoder` | Future instance decode (blocked until pixel auth + contract) |
| `VolumeAssembler` | Multi-slice / multi-series assembly |
| `ImagePreprocessor` | Only `allowed_transforms` from contract |
| `ModelInputPreparer` | Build/validate `ImagingModelInput` |

`PreprocessingContract` binds model id/version, modalities, regions, species, `requires_pixels`, transfer-syntax allow-list, and allowed transforms. Default path: `MetadataOnlyPreparationPipeline` with `requires_pixels=False`.

### Vision adapter capability (`ModelCapability`)

Declares: `model_id`, `model_version`, modalities, regions, species, `allows_pixel_analysis`, `input_contract_id`, `output_schema_version`, `timeout_s`, `max_instances`, `resource_hint`, `source_kind`.

No fake “real” capabilities are registered unless `VETMIND_VISION_ENDPOINT` (+ modality/region config) is set.

### Structured results (`StructuredFindings` v1.1.0)

Includes model identity/version, `source_kind`, `execution_status`, findings with anatomical location + evidence refs, optional `model_confidence` (rejected if outside [0,1]; never invented), warnings, `processing_metadata`, provenance fields. Mock findings remain `source_kind=mock` / `synthetic=true` when produced by mocks.

### Jobs (`AnalysisJob`)

Statuses: `queued` | `running` | `completed` | `failed` | `cancel_requested` | `cancelled` | `timed_out`.

---

## 4. Tests and results

Commands (run from repo root):

```bash
npm test
npm run typecheck
npm run build
npm run backend:test
```

Phase 3 backend coverage includes:

- Metadata prep default-deny / pixel contract rejection
- Transfer syntax allow-list (unsupported + missing)
- Quarantine path traversal rejection
- Duplicate async analyze idempotency + `Idempotency-Key`
- Cooperative cancel while queued
- Malformed / out-of-range confidence
- Remote vision timeout and unavailability
- Mock provenance (`analysis_mode=mock`, `source_kind=mock`)
- Unsupported scenario → no AI draft
- DICOM demo confirm → async analyze

### Actual results (this delivery)

| Command | Result |
|---------|--------|
| `npm test` | **Pass** — 5 files, 15 tests |
| `npm run typecheck` | **Pass** |
| `npm run build` | **Pass** (vite production build) |
| `npm run backend:test` | **Pass** — all tests green (1 skipped); Phase 3 suite included |

Note: On a nearly full system volume, pytest may need `TMPDIR` pointed at a workspace path. SQLite persistence uses `journal_mode=DELETE` for portability when WAL sidecars fail.

---

## 5. Supported vs unsupported capabilities

### Supported now (demo / readiness)

- Metadata-only model input for MR / CT / XR / multimodal mocks
- Multi-series / multi-instance **references** (no pixel tensors)
- Transfer syntax + geometry tags when present on DICOM
- Mock adapters with MOCK provenance
- Optional HTTP Vision/LLM adapters when endpoints are configured (still not “clinically validated”)
- Async jobs, cooperative cancel, idempotent re-submit while in-flight
- Expert review gates, report validation, RAG as non-clinical context

### Not supported / not implemented

- Real pixel decode / volume prep / medically significant transforms
- Pixel authorization grant in default config (default-deny)
- Automatic retry of Vision/LLM POSTs
- Invented confidence scores or GPU/time-based progress estimates (stage checkpoint `progress_pct` is allowed)
- Training, model hosting, or paid external LLM by default
- Encryption, de-identification, or multi-tenant isolation claims
- Payment / billing

---

## 6. Security boundaries

| Boundary | Behavior |
|----------|----------|
| Pixel access | Default-deny via `evaluate_pixel_access`; prep asserts before any future decode |
| Quarantine | Paths resolved under store root; `..` / absolute paths rejected; temp cleanup scoped to root |
| Model responses | Pydantic wire validation; failed remote execution does not map findings |
| Provider failure | Typed `LLMProviderError` / `ImagingAdapterError` — no silent mock draft fallback |
| Logging | Prefer case/job ids; do not log patient names or quarantine absolute paths in adapter metadata |
| Cross-case | Job/case lookups by id through repository; no shared pixel tensors between cases |
| FE vs BE cancel | Aborting poll ≠ job cancel; cancel is explicit API |

Do **not** claim encryption-at-rest, PHI anonymization, or tenant isolation unless separately implemented and verified.

---

## 7. Remaining requirements before real AI deployment

1. Authorized pixel decode implementation behind `PreprocessingContract` + consent/permission flags.
2. Modality-specific contracts (resample, windowing, orientation) reviewed by clinical engineering.
3. Production object storage / quarantine with virus scan and retention policy.
4. Authenticated mutual TLS / API keys for remote inference; network egress controls.
5. Observability: structured audit of model id/version, input hashes, timeouts (no PHI).
6. Load / latency / failure testing against the real inference service.
7. Regulatory / clinical validation process (outside this codebase).
8. Explicit ops runbook for `VETMIND_VISION_*` and `VETMIND_LLM_*` configuration.
9. Confirm `vision_execution_policy` (`exclusive_real` vs mixed) for the deployment environment.

---

## 8. Exact procedure for connecting a future real model

### A. Remote HTTP Vision service

1. Deploy an inference service that accepts the VetMind wire payload (`ImagingModelInput` + case routing fields) and returns `RemoteVisionResponse` (`execution_status`, findings, optional `source_kind`, optional `model_confidence` in [0,1]).
2. Set environment (example):

   ```bash
   export VETMIND_VISION_ENDPOINT=https://inference.example/v1/vision
   export VETMIND_VISION_MODEL_ID=clinic-brain-mri-v1
   export VETMIND_VISION_MODEL_VERSION=1.0.0
   export VETMIND_VISION_MODALITIES=MR
   export VETMIND_VISION_REGIONS=BRAIN
   export VETMIND_VISION_SPECIES=canine,feline
   export VETMIND_VISION_SOURCE_KIND=real
   export VETMIND_VISION_TIMEOUT_S=30
   export VETMIND_VISION_API_KEY=...   # if required
   export VETMIND_VISION_EXECUTION_POLICY=exclusive_real   # or allow_mixed when intentional
   ```

3. Restart the API. Startup validates registry: capability id must match an adapter.
4. Confirm health reflects vision endpoint + policy.
5. Run a synthetic case (not clinical PHI) and verify `source_kind=real`, `analysis_mode=real`, and that failures do **not** produce mock drafts.
6. Only after a pixel contract + authorization flags are implemented, set `allows_pixel_analysis=True` on the capability and implement decoder/preprocessor — never enable pixels by default.

### B. Local inference process

1. Implement `ImagingModel` (same `analyze(case) -> StructuredFindings` contract) in `backend/app/models/`.
2. Register it in the container registry alongside a matching `ModelCapability` (version, modalities, timeout, `source_kind=real`).
3. Prefer calling local gRPC/HTTP with the same validation rules as `HttpRemoteVisionModel`.
4. Keep POST non-idempotent: no automatic retries.

### C. LLM (optional draft generation)

1. Point `VETMIND_LLM_*` (or factory settings) at a service that accepts `LLMGenerationInput` and returns the HTTP LLM wire schema.
2. On timeout/malformed/unavailable: pipeline fails with findings retained and **no** approvable draft — never fall back to mock silently.

---

## Non-claims

This phase delivers an **AI-integration-ready architecture** with tests and honest UI labeling. It does **not** assert that VetMind is clinically validated, FDA/CE cleared, or safe for unsupervised diagnosis.
