# VetMind AI — Technical Debt Register

**Last verified commit:** `50cf064`  
**Ranking:** P0 (honesty / safety of claims) → P3 (requires GPU or institution).

## P0 — Correctness of demo claims

| ID | Debt | Evidence | Resolution track |
|----|------|----------|------------------|
| TD-01 | Auth disabled by default; demo principal has broad capabilities | `backend/app/settings.py` `auth_enabled=False`; `auth/deps.py` | **Mitigated (ops)** — Tier A/B runbook + Login honesty; default remains demo by design. Real accounts, hashed passwords, short JWT + refresh rotation, password reset and attempt limits exist (#31) for auth-on deployments |
| TD-02 | Dashboard / Modules / SystemStatus mock GPU & deploy charts | `src/shared/demo/*` + feature demo modules | **Mitigated** — demoFiction badges + live /health panels (charts still illustrative) |
| TD-03 | Register creates localStorage-only “accounts” | `src/features/auth/Register.tsx` | **Resolved (#31)** — sign-up uses `POST /auth/register`; browser-only accounts removed and purged from old browsers |
| TD-04 | No hosted CI | Missing `.github/workflows` | **Mitigated** — `.github/workflows/ci.yml` |
| TD-05 | Vitest cancelled-job polling edge case | `src/shared/api/backend.polling.test.ts` | **Verified green** (2026-11-09) |
| TD-06 | Dead env key `VETMIND_ALLOW_MOCK_LLM` not read by settings | `.env` / docs vs `settings.py` | **Resolved** — the key no longer appears in any `.env`, doc or code (checked 2026-11-28, #128) |

## P1 — Productization of existing APIs

| ID | Debt | Evidence | Resolution track |
|----|------|----------|------------------|
| TD-10 | Training export API lacks ops UI/runbook | `api/training_export.py` exists; FE weak | Phase 2 |
| TD-11 | `markReportDelivered` API ahead of UX | `src/shared/api/*` | Phase 2 deliver UX |
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
| TD-35 | App Dockerfile / K8s deploy | Dockerfiles + root `docker compose up` done (#29); K8s / registry publishing still open |
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
| 2026-11-13 | #31: server-side accounts (scrypt), refresh rotation, password reset, rate limits; TD-03 resolved, TD-01 note updated |
| 2026-11-13 | #29: backend/web Dockerfiles and root docker-compose.yml (TD-35 partly) |
| 2026-11-16 | #48: circular import via app.imaging.metadata_prep fixed (37 of 207 modules failed when imported first); tests/test_import_cycles.py guards every module |
| 2026-11-26 | #41: email verification for self-registered vets; register no longer reveals existing emails (uniform 202) |
| 2026-11-27 | #107: opt-in TOTP two-step sign-in (Fernet-sealed secrets, backup codes, setup-only session for required roles set from Admin → Users (`app_settings`, Alembic 0005; env var is the starting value), admin reset); challenge tickets' single-use memory is per process |
| 2026-11-26 | #108: clinic patient records (`patients` table, Alembic 0003), prior studies, side-by-side viewer sync, report comparison section; `scripts/backfill_patients.py` for existing cases |
| 2026-11-27 | #106: admin security / audit screen (filtered, paged query on memory/JSONL/SQL; Alembic 0004 indexes; suspicious-event rules; CSV export) |
| 2026-11-27 | #113: plain-language owner summary from the approved report (glossary + safety rules, vet approval, PDF); stored in the case payload, no migration |
