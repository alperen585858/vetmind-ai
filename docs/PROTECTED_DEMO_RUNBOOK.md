# Protected-demo runbook

Local/classroom default remains **demo** (`VETMIND_AUTH_ENABLED=0`, `VETMIND_DEPLOYMENT_MODE=demo`).  
Do not enable protected mode against real PHI — encryption/KMS and real AV are still Goal B.

## Tier A — Auth-on demo (recommended for locked classroom demos)

Enforces JWT/RBAC without the full protected fail-closed matrix.

```bash
export VETMIND_AUTH_ENABLED=1
export VETMIND_DEPLOYMENT_MODE=demo
export VETMIND_JWT_SECRET='replace-with-a-long-random-secret-at-least-32-chars'
# optional local-only escape hatch (never in shared hosting):
# export VETMIND_ALLOW_INSECURE_DEMO=1
export VETMIND_DICOM_IDENTITY_SCRUB=1
export VETMIND_DEMO_SEED=1   # optional synthetic cases on empty store
```

Effects:

- Frontend role-switch disabled (`authMode.roleSwitchAllowed=false`).
- API requires Bearer JWT / API key.
- Seed accounts: `vet@demo.local`, `expert@demo.local`, `owner@demo.local` (and admin seeds per demo credentials) with documented demo passwords.
- Register remains **browser-only demo session** — durable users come from Admin → Users or seeds.

## Tier B — Full `protected` deployment mode

```bash
export VETMIND_DEPLOYMENT_MODE=protected
export VETMIND_AUTH_ENABLED=1
export VETMIND_JWT_SECRET='replace-with-a-long-random-secret-at-least-32-chars'
# Defaults when mode=protected:
#   VETMIND_MALWARE_SCAN_REQUIRED=1
#   VETMIND_DICOM_IDENTITY_SCRUB=1
```

Startup fail-closed (`validate_security_settings`):

- Auth must be on  
- Non-default JWT secret  
- Malware scan required (currently **UnavailableScanner** — uploads fail closed until a real scanner is wired)  
- DICOM identity scrub on  

Honest consequence today: Tier B is for **security posture testing**, not for a smooth DICOM upload demo, until a real AV integration exists (Goal B). Prefer Tier A for product demos.

## Playwright

```bash
E2E_PROTECTED=1 npm run e2e -- e2e/protected.spec.ts
```

## Retention / scrub checklist

- [ ] No real patient PHI in the environment  
- [ ] DICOM identity scrub enabled for shared demos  
- [ ] Audit log path set / writable  
- [ ] Training export uses `verified_only` only  
- [ ] Understand scrub ≠ certified de-ID ([RELEASE_READINESS.md](RELEASE_READINESS.md))  

## Goal B still deferred

OIDC, KMS encryption at rest, real malware signatures, institutional PHI policy, clinical validation — see [P2_HARDENING_BACKLOG.md](P2_HARDENING_BACKLOG.md).

## Related

- [RELEASE_READINESS.md](RELEASE_READINESS.md)  
- [TECHNICAL_DEBT.md](TECHNICAL_DEBT.md) TD-01  
- `backend/app/settings.py` → `validate_security_settings`  
