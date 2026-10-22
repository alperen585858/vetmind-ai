# VetMind AI — Phase 1 DICOM Module Audit

**Date:** 2026-10-22  
**Scope:** Upload, quarantine, classification confirm, viewer workspace, ImagingModelInput readiness.  
**Constraint:** No real AI models, no invented findings, no fake checkout, no orchestrator rewrite.

---

## 1. Working functionality

| Area | Status | Location |
|------|--------|----------|
| Multipart DICOM upload | ✅ | `backend/app/api/dicom.py`, `DicomService.upload` |
| Demo fixtures + viewer bytes | ✅ | `/dicom/demo/*`, `/dicom/fixtures/*` |
| Quarantine + SHA256 + manifest | ✅ | `storage/quarantine.py` |
| Part-10 parse (metadata only) | ✅ | `dicom/parser.py` |
| Study → Series → SOP tree | ✅ | `dicom/validator.py`, schemas |
| Classification heuristics | ✅ | `dicom/classifier.py` |
| Confirm → Case + model_input | ✅ | `DicomService.confirm` |
| Async analyze + job poll | ✅ | `analyze/async`, FE `analyzeCaseAsyncAndWait` |
| Browser viewer (W/L, zoom, pan, slice) | ✅ | `DicomViewer.tsx`, `dicomPreview.ts` |
| Folder/file DnD | ✅ | `dicomFolder.ts`, `DicomUpload.tsx` |
| Series explorer (list) | ✅ | `SeriesExplorer.tsx` |
| Case-detail quarantine/cache view | ✅ | `dicomCaseCache.ts`, `CaseDetail.tsx` |
| Pixel auth default-deny | ✅ | `pixel_authorization.py` |

---

## 2. Missing functionality (pre-implementation)

| Gap | Severity |
|-----|----------|
| FE consent not wired to `imaging_*_verified` case flags | P0 |
| No FE per-file / aggregate size enforcement (BE has 25 MiB/file) | P0 |
| No aggregate upload budget on API | P1 |
| Series/instance click → viewer jump | P1 |
| Deterministic workspace phase machine (EMPTY…FAILED) | P1 |
| Upload cancel / AbortSignal | P1 |
| Duplicate submit lock | P1 |
| Client Part-10 sniff before upload | P1 |
| `prepared_for_models` uses live router capabilities on confirm (F4) | P1 |
| Payment workflow states (FE-only reserved; no checkout) | P2 |
| PACS / DICOMweb / AV / retention | Out of Phase 1 |

---

## 3. Architectural risks

1. **Dead lifecycle:** `AWAITING_CLASSIFICATION_CONFIRMATION` never assigned; ingest is pre-case.  
2. **Consent/pixel disconnect:** UI checkbox did not set BE consent flags (pixels still denied for mocks).  
3. **Display ≠ AI contract:** Browser may decode pixels while `metadata_only=True`.  
4. **Soft duplicate SOP:** Deduped, not hard-blocked.  
5. **FE status animation** can briefly diverge from persisted BE status after analyze.  
6. **Quarantine** is durable local PHI without TTL/encryption (documented limitation).

---

## 4. Suggested file-level modifications (executed in this phase)

| File | Change |
|------|--------|
| `docs/audits/02_DICOM_PHASE1_AUDIT.md` | This audit |
| `src/lib/dicomWorkflow.ts` | Workspace phases + BE mapping + demo payment gate |
| `src/lib/dicomFolder.ts` | Size limits, Part-10 sniff, batch validation |
| `src/lib/dicomCaseCache.ts` | LRU eviction |
| `src/lib/backend.ts` | Consent flags, AbortSignal on upload |
| `src/components/SeriesExplorer.tsx` | Instance → viewer selection |
| `src/components/DicomViewer.tsx` | Focus by SOP / index |
| `src/pages/DicomUpload.tsx` | Phase UI, cancel/retry, validation, submit lock |
| `backend/app/api/dicom.py` | Aggregate size limit |
| `backend/app/schemas/dicom.py` | Consent fields on confirm |
| `backend/app/services/dicom_service.py` | Consent + live capabilities → model_input |
| `backend/app/container.py` | Inject capabilities into DicomService |
| `backend/tests/test_dicom.py` | Consent + aggregate limit tests |
| `src/lib/*.test.ts` + vitest | FE unit tests |

---

## 5. Explicit non-goals

- Rewrite `AIOrchestrator`  
- Fake checkout / payment provider  
- Invent clinical findings  
- Enable pixel inference / bypass authorization  
- Claim clinical production readiness  

---

## 6. Implementation status (this PR / session)

| Item | Status |
|------|--------|
| Consent → `imaging_*_verified` | ✅ |
| FE/BE size + aggregate limits | ✅ |
| Part-10 client sniff | ✅ |
| Abort / cancel upload | ✅ |
| Duplicate submit lock | ✅ |
| Series → viewer jump | ✅ |
| Workspace phase machine + payment FE-only | ✅ |
| Live capabilities on confirm model_input (F4 for DICOM) | ✅ |
| IndexedDB LRU | ✅ |
| Vitest + pytest coverage | ✅ |
| Fake checkout / real AI / pixel bypass | ❌ intentionally not done |

### Known remaining blockers (before real clinical data + AI)

- No PACS/DICOMweb, AV, encryption-at-rest, retention TTL  
- No real Vision/LLM; mocks only  
- `AWAITING_CLASSIFICATION_CONFIRMATION` still unused as a persisted case status (ingest confirm creates case directly)  
- Backend job cancel API still absent (Phase 1.1: client poll abort only — see `PollingCancelledError`)  
- Transfer-syntax coverage for production PACS dumps incomplete  
- Cross-ingest StudyInstanceUID uniqueness not enforced  
- No clinical security/validation evidence for production claims  

**Phase 1.1 follow-up:** see [docs/PHASE_1_1_AND_2.md](../PHASE_1_1_AND_2.md).  
