# VetMind AI — Technical Debt Register

**Last verified commit:** `e85dab3`  
**Ranking:** P0 (honesty / safety of claims) → P3 (requires GPU or institution).

## P0 — Correctness of demo claims

| ID | Debt | Evidence | Resolution track |
|----|------|----------|------------------|
| TD-01 | Auth disabled by default; demo principal has broad capabilities | `backend/app/settings.py` `auth_enabled=False`; `auth/deps.py` | **Mitigated (ops)** — Tier A/B runbook + Login honesty; default remains demo by design |
| TD-02 | Dashboard / Modules / SystemStatus mock GPU & deploy charts | `src/data/mock.ts` consumers | **Mitigated** — demoFiction badges + live /health panels (charts still illustrative) |
| TD-03 | Register creates localStorage-only “accounts” | `src/pages/Register.tsx` | **Mitigated** — demo session copy + toast; no server-account claim |
| TD-04 | No hosted CI | Missing `.github/workflows` | **Mitigated** — `.github/workflows/ci.yml` |
| TD-05 | Vitest cancelled-job polling edge case | `src/lib/backend.polling.test.ts` | **Verified green** (2026-11-09) |
| TD-06 | Dead env key `VETMIND_ALLOW_MOCK_LLM` not read by settings | `.env` / docs vs `settings.py` | Document or wire; do not silently change LLM routing |

## P1 — Productization of existing APIs

| ID | Debt | Evidence | Resolution track |
|----|------|----------|------------------|
| TD-10 | Training export API lacks ops UI/runbook | `api/training_export.py` exists; FE weak | Phase 2 |
| TD-11 | `markReportDelivered` API ahead of UX | `src/lib/backend.ts` | Phase 2 deliver UX |
| TD-12 | Anonymize is scrub-not-certified | `dicom/anonymize.py` | Document in Phase 2/4; Goal B for certified de-ID |
| TD-13 | i18n / hardcode gaps in sidebar/payment/KB | prior audits | Incremental polish; not blocking Goal A software |

## P2 — ML software readiness (CPU-capable)

| ID | Debt | Evidence | Resolution track |
|----|------|----------|------------------|
| TD-20 | Training script is stub (epochs ignored) | `ml/training/train_xray_classifier.py` | **Mitigated** — CPU tiny loop + synthetic pixels; real DICOM pixel loader still open |
| TD-21 | No experiment tracking | No MLflow/W&B | **Mitigated** — `ml/runs/*/manifest.json`; MLflow adapter later |
| TD-22 | `artifacts/` empty | `.gitkeep` only | Populate only with non-clinical demo checkpoints under policy |
| TD-23 | LocalTorch off / vision extras optional | `requirements-vision.txt`, readiness blockers | Optional CPU readiness runbook; never auto-prod |

## P3 — Deferred (GPU / org / Goal B)

| ID | Debt | Notes |
|----|------|-------|
| TD-30 | Real veterinary fine-tune / CT-MRI train | Needs data + GPU |
| TD-31 | PACS / DICOMweb / 3D MPR | Org imaging stack |
| TD-32 | KMS encryption at rest | Goal B |
| TD-33 | Real malware signatures | Goal B |
| TD-34 | OIDC / SSO | Goal B |
| TD-35 | App Dockerfile / K8s deploy | After CI stabilizes |
| TD-36 | Prometheus / OpenTelemetry | Observability backlog |

## Explicit non-debt (do not “rebuild”)

Working modules that must not be duplicated:

- Case → analyze → report → PDF pipeline  
- DICOM quarantine + 2D viewer + overlays  
- Evidence accept/edit/verify  
- Training export (verified_only + patient split)  
- LLM/VLM adapter factory and orchestrator  
- Offline evaluation package  
- RBAC/JWT/API key implementation (enablement is the gap)  

## Change log

| Date | Note |
|------|------|
| 2026-11-09 | Initial register from master initiative baseline |
| 2026-11-09 | Phase 1: CI + Register/provenance/mock honesty mitigations |
| 2026-11-09 | Phase 2–4: export ops, CPU train contract, protected-demo runbook |
