# VetMind AI — Phase 5: Security, Privacy & Performance Hardening

**Status:** Hardened demo foundation with explicit protected-mode gates.  
**Not claimed:** Full multi-tenancy certification, encryption-at-rest, antivirus protection, regulatory compliance, or production IdP readiness.

Payment and real AI integration remain out of scope. DICOM viewer, AIOrchestrator, model contracts, report versioning, expert review, and print-to-PDF are preserved.

## 1. Security architecture

```
Client
  → JWT / API key (when VETMIND_AUTH_ENABLED=1)
  → RBAC capabilities (role matrix)
  → Clinic / owner isolation (when tenant_isolation=true)
  → CaseService / DicomService authorization checks
  → Quarantine store (path + ingest_id sanitization, sha256)
  → Append-only security audit JSONL (separate from ops logs)
```

| Layer | Mechanism |
|-------|-----------|
| Transport auth | Optional Bearer JWT (HS256) or `X-API-Key` |
| Capabilities | `require_capability` on case/DICOM/analyze/review/report routes |
| Object ACL | `clinic_id` + `owner_subject` on cases/ingests |
| Storage | Quarantine path resolve, ingest_id validation, hash verify on read |
| Audit | `AuditLogger` JSONL / in-memory |
| Fail-closed | Default JWT secret blocked when auth on; protected mode requires auth |

Frontend role gates remain **UX only**. Backend enforcement is mandatory for any real data.

## 2. Threat model (prioritized)

| Priority | Risk | Mitigation in Phase 5 |
|----------|------|------------------------|
| P0 | Anonymous PHI access (auth off) | Explicit demo vs protected modes; docs require auth for clinical data |
| P0 | IDOR across clinics when auth on | Tenant isolation + 404 on cross-clinic access |
| P0 | Forgeable JWT with demo secret | Startup fail-closed unless `ALLOW_INSECURE_DEMO` |
| P1 | Path traversal in quarantine | `validate_ingest_id` + existing `resolve()` |
| P1 | Client-spoofed reviewer identity | Bind `reviewer_id` to JWT `sub` when auth on |
| P1 | Shared-browser DICOM cache after logout | FE clears IndexedDB on sign-out / role clear |
| P2 | Absolute path leakage in `/health` | Redacted when auth enabled or protected mode |
| P2 | No malware scan | Fail-closed boundary when `MALWARE_SCAN_REQUIRED` |
| P2 | No encryption-at-rest | Documented pluggable design; mode stays `none` |
| P3 | Redis/RQ trust boundary | Documented blocker (not solved here) |

## 3. Modified / added files

**Backend (core)**  
`settings.py`, `container.py`, `main.py`  
`auth/security.py`, `auth/deps.py`, `auth/principal.py`, `auth/tenancy.py`  
`schemas/case.py`, `schemas/dicom.py`  
`services/case_service.py`, `services/dicom_service.py`  
`storage/quarantine.py`, `storage/encryption.py`, `storage/malware_scan.py`  
`security/audit.py`, `security/retention.py`, `security/redaction.py`  
`api/auth.py`, `api/cases.py`, `api/analysis.py`, `api/reports.py`, `api/dicom.py`  
`tests/test_phase5_security.py`, `scripts/bench_dicom_synthetic.py`

**Frontend**  
`src/lib/auth.ts` (sessionStorage JWT in protected mode)  
`src/context/AppContext.tsx` (IndexedDB clear on logout)  
`src/pages/Login.tsx`, `src/lib/backend.ts`

**Docs**  
`docs/PHASE_5_SECURITY_PERFORMANCE.md`

## 4. Actual protections implemented

- Server-side auth on case, DICOM, analyze, job, report, review routes (unchanged wiring; strengthened checks)
- Fail-closed on missing/invalid credentials when auth enabled
- Clinic ownership on create/upload/confirm; list/get/analyze/review/job/report filtered
- Legacy null-ownership rows: default-deny under isolation (admin/service only)
- Reviewer identity bound to JWT subject
- Quarantine: ingest_id validation, max file size in store, sha256 verify on DICOM download
- Malware scanner boundary (fail-closed when required and unavailable)
- Encryption-at-rest **design only** (`encryption.mode == "none"` unless a real encryptor is wired)
- Retention policy planner (dry-run); preserves approved/immutable reports
- Audit events for login, auth failure, case create/read, analysis, review, DICOM upload/retrieve
- Concurrent analyze semaphore (`VETMIND_MAX_CONCURRENT_ANALYZE`)
- Log/error redaction helpers for tokens/emails/patient_name patterns
- FE: logout clears DICOM IndexedDB; protected auth uses sessionStorage for JWT

## 5. Demo vs protected deployment

| | Demo (default) | Protected |
|--|----------------|-----------|
| Env | `VETMIND_DEPLOYMENT_MODE=demo`, auth off | `protected` + `AUTH_ENABLED=1` + strong `JWT_SECRET` |
| Anonymous API | Allowed | Denied |
| Tenant isolation | Off (unless forced) | On by default |
| Malware scan required | Off | On by default (fails closed without scanner) |
| `/health` paths | May show local paths | Redacted |
| FE JWT storage | localStorage | sessionStorage preferred |
| Purpose | Local demos / CI | Pre-clinical hardening baseline |

Insecure demo secret with auth on requires `VETMIND_ALLOW_INSECURE_DEMO=1`.

## 6. Data isolation model

Resources carry optional:

- `owner_subject` — creating principal
- `clinic_id` — clinic tenancy key from JWT claim

Access when isolation is active:

1. `admin` / `service` / API key → global
2. Matching `clinic_id` → allow
3. Matching `owner_subject` → allow
4. Else → **404** (no existence leak)

Seed clinics: `clinic-demo-a` (vet/expert/owner), `clinic-demo-b` (vet-b/expert-b).

**Not claimed complete multi-tenancy:** no org admin UI, no DB row-level security, no Postgres policies, Redis jobs still trust enqueue.

## 7. Storage security

| Control | Status |
|---------|--------|
| Path traversal (`resolve`) | Enforced |
| ingest_id sanitization | Enforced |
| Filename sanitization | Enforced |
| SHA-256 at write + verify on case DICOM read | Enforced |
| Max file bytes in store | 25 MiB |
| API upload size limits | Preserved |
| Encryption-at-rest | **Not enabled** (pluggable `BlobEncryptor` stub) |
| Malware AV | **Not provided**; required mode fails closed |
| Incomplete upload cleanup | Temp `.tmp-*` cleanup helper in retention module |

## 8. Retention policy

Env knobs:

- `VETMIND_RETENTION_DICOM_DAYS`
- `VETMIND_RETENTION_TEMP_HOURS` (default 24)
- `VETMIND_RETENTION_ARTIFACTS_DAYS`
- `VETMIND_RETENTION_REPORTS_DAYS`
- `VETMIND_RETENTION_LOGS_DAYS` (default 90)

**Conflicts documented:**

- Approved/immutable report history is preserved even if DICOM purge is planned (`blocked=true` in dry-run).
- Legal / audit retention may require keeping reports longer than clinical DICOM; do not auto-delete without explicit apply + legal review.
- Phase 5 does **not** auto-delete existing user data.

## 9. Audit logging

Append-only JSONL (`VETMIND_AUDIT_LOG_PATH` or default `backend/data/audit/security.jsonl` when auth/protected).

Fields: `event_id`, `event_type`, `actor`, `resource`, `outcome`, `timestamp`, optional `detail` / `clinic_id`.

Does not store patient names, pixels, passwords, or raw tokens.

Operational logs remain separate (stdlib / uvicorn).

## 10. Performance benchmarks

**Host run (synthetic only, 2026-10-22):**  
`backend/.venv/bin/python scripts/bench_dicom_synthetic.py`

| Metric | Value |
|--------|-------|
| Fixture | `brain_mri` × 4 instances |
| Total bytes | 134 760 |
| Parse | ~0.001 s |
| Quarantine store | ~0.0008 s |
| List files | ~0.0001 s |
| Peak RSS | ~40.8 MiB |

Not a production load test. Viewer init / full HTTP concurrency not measured in this pass (disk-constrained host). Concurrency safeguard: analyze semaphore (default 8).

## 11. Test results

Commands (after reclaiming disk ~277 Mi free):

| Command | Result |
|---------|--------|
| `npm test` | **PASS** — 6 files, **18** tests |
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS** — vite production build |
| `npm run backend:test` | **PASS** — **223** passed, **1** skipped, 0 failed |

Phase 5 suite (`tests/test_phase5_security.py`): **21** tests included in the backend total.

Coverage highlights: unauthorized DICOM, cross-tenant case/report/review/job, invalid credentials, path traversal, oversized store, malware fail-closed, redaction, retention vs immutability, demo compatibility, audit events, concurrent analyze 429.

## 12. Remaining security blockers

1. No real IdP / MFA / hashed password store (demo plaintext users)
2. No encryption-at-rest implementation or KMS
3. No functioning malware scanner integration
4. Redis/RQ workers trust the queue (no signed job principals)
5. Absolute `quarantine_dir` still returned on some demo upload responses
6. Remote Vision may still receive clinical_history in model payloads
7. Postgres/SQLite lack DB-enforced RLS
8. Host disk capacity remains a CI risk
9. Frontend Register can still mint local admin UI roles (backend ignores without JWT)

## Non-claims

This phase hardens the platform for **future** veterinary clinical data. It does **not** constitute HIPAA/GDPR certification, CE/FDA readiness, complete multi-tenancy, encrypted storage, or antivirus protection.
