# VetMind AI — Phase 1.1 Stabilization + Phase 2 Case Management

> **Date:** 2026-10-22  
> **Payment:** Explicitly out of scope — no checkout, pricing, invoices, or payment gates.

## Phase 1.1 — DICOM stabilization

| Issue | Resolution |
|-------|------------|
| Async poll continues after navigation | `AbortSignal` on poll loop; unmount aborts controller in `DicomUpload` |
| FE cancel vs BE cancel confusion | `PollingCancelledError` — client stop only; backend job may finish |
| Duplicate SOP severity misleading | Soft-dedupe keeps first; issue is **warning** with “kept/dropped” message |
| Study/Series/SOP identity | `src/lib/studyIdentity.ts` + tests; unique SOPs after dedupe asserted in pytest |
| Classification confirmation clarity | Ingest-scoped `accepted` / UI `READY_FOR_CONFIRMATION`; case created only after confirm; reserved lifecycle enum documented as unused |
| Payment leftovers | Removed `PAYMENT_*` phases and payment gates from workflow |

## Phase 2 — Case management

| Area | Change |
|------|--------|
| Case list | Modality, study counts/UID, analysis + expert labels, search/filters, skeleton, sync error + retry |
| Case summary API | Additive fields: `breed`, `classification_confirmed`, `study_instance_uid`, `series_count`, `instance_count` |
| Case detail | Loading skeleton, hydrate retry, imaging/classification panel, link to existing viewer (no duplicate) |
| Workflow copy | Upload → classification confirm → case → **mock** analysis → expert review → report |

## AI readiness (unchanged contracts)

- `ImagingModelInput`, router, Vision adapters, LLM gateway preserved  
- Stable Study/Series/SOP UIDs + quarantine paths remain model-facing refs  
- Pixel authorization still default-deny; no fabricated findings  

## Tests

- Vitest: workflow, folder, study identity, caseMapper, polling cancel  
- Pytest: duplicate SOP warning, case list fields, unconfirmed analyze 409, auth 401 on case GET  

## Remaining issues

- No backend job cancel API (poll abort ≠ worker cancel)  
- No PACS / multi-tenant / real AI  
- `AWAITING_CLASSIFICATION_CONFIRMATION` still unused as assigned case status  
- Transfer-syntax / production PACS dump coverage incomplete  
