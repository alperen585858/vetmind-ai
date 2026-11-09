# VetMind AI — Release Readiness

**Last verified commit:** `e85dab3`  
**Authority:** [READINESS_GOALS.md](READINESS_GOALS.md) — never market Goal A as Goal B.

## Release classes

| Class | Intent | GO / NO-GO |
|-------|--------|------------|
| **Local / classroom demo** | Synthetic data, mock or configured Gemini, auth may be off | **GO** with MOCK/SYNTHETIC labelling |
| **Protected demo** | Auth on, seed accounts, scrub/audit baselines, no real PHI claim | **CONDITIONAL** — after Phase 4 runbook followed |
| **Pre-training software (Goal A)** | Ingest, inventory, verify labels, export + split, honest eval | **APPROACHING** — export/eval strong; train stub; CI pending |
| **Clinical-use (Goal B)** | KMS, AV, OIDC, clinical validation, institutional policy | **NO-GO** |

## Goal A checklist

| Requirement | Status |
|-------------|--------|
| Multi-DICOM ingest + quarantine | Met |
| Inventory / decode / coverage honesty | Met (tests in regression gate) |
| Ground findings to loci + expert verify | Met (bbox path) |
| Auth/tenant/scrub **baselines available** | Met in code; **default auth off** |
| Expert-verified training export + patient split | Met (API + tests) |
| Hosted CI for software gates | Open (Phase 1) |
| CPU-safe train contract from export | Open (Phase 3) |
| Clinical performance claims | **Not claimed** |

## Goal B checklist (deferred)

| Requirement | Status |
|-------------|--------|
| Production encryption / KMS | Not implemented (default `encryption_at_rest=none`) |
| Real malware signatures | `malware_scan_required` default false |
| OIDC / enterprise IdP | Not implemented |
| Independent clinical validation protocol | Not claimed |
| Institutional PHI policy sign-off | Out of repo scope |

## Environment honesty

| Signal | Expected demo behavior |
|--------|------------------------|
| Health `pipeline_mode` | `mock` unless remote LLM/VLM configured |
| Finding provenance | MOCK / SYNTHETIC / REAL labels via UI banners |
| `clinically_validated` / `clinically_approved` | Remain `false` for demo/seed and train stubs |
| Register without auth backend | Must not imply durable server account |

## Protected-demo minimum

Prefer **Tier A (auth-on demo)** for classroom/product demos. Use full `protected` (Tier B) for security posture tests. Details: [PROTECTED_DEMO_RUNBOOK.md](PROTECTED_DEMO_RUNBOOK.md).

1. `VETMIND_AUTH_ENABLED=1`  
2. Non-default JWT secret (or explicit `VETMIND_ALLOW_INSECURE_DEMO=1` locally only)  
3. Seed radiologist / clinic / owner accounts only  
4. DICOM identity scrub enabled for shared demos  
5. Audit logging enabled  
6. No real patient PHI  
7. Full `VETMIND_DEPLOYMENT_MODE=protected` only when malware fail-closed behavior is understood (uploads blocked until real AV)  

## Retention checklist (demo)

- [ ] Empty or synthetic store only  
- [ ] Quarantine path isolated from production  
- [ ] Retention dry-run reviewed before apply  
- [ ] Training export verified_only  


## Scrub / anonymization statement

`backend/app/dicom/anonymize.py` provides **best-effort identity scrub** for demo and export hygiene. It is **not** certified de-identification and must not be described as HIPAA/KVKK-complete.

Protected-demo recommendation: enable DICOM identity scrub on quarantine writes; use training export `verified_only` only; never load real PHI into demo environments. Operational steps: [TRAINING_EXPORT_RUNBOOK.md](TRAINING_EXPORT_RUNBOOK.md).

## Retention

Retention helpers and admin hooks exist for Goal A baselines. Production retention policy is institutional (Goal B).

## Sign-off template

| Gate | Owner | Result | Date |
|------|-------|--------|------|
| Demo GO | | | |
| Protected demo | | | |
| Goal A software | | | |
| Goal B clinical | | **NO-GO** until validation | |

## Related

- [MASTER_ROADMAP.md](MASTER_ROADMAP.md)  
- [ENGINEERING_STATUS.md](ENGINEERING_STATUS.md)  
- [TECHNICAL_DEBT.md](TECHNICAL_DEBT.md)  
- [P2_HARDENING_BACKLOG.md](P2_HARDENING_BACKLOG.md)  
