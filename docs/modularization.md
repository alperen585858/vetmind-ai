# Frontend / Backend Modularization

Status: **completed**. VetMind remains a **modular monolith** (one deployable). Feature boundaries below are the current layout, not a migration plan.

## Frontend layout

```text
src/
  App.tsx           # Composition root: providers + feature route mounts
  features/         # Product domains (pages, local components, routes.tsx)
    auth/
    cases/
    dicom/
    analysis/
    reports/
    expert/
    submissions/
    messaging/      # api.ts re-exports shared/api/messaging
    rag-admin/      # demoKb.ts — KB seed + label helpers
    admin/          # demoInfra.ts — service cards + module catalog
    dashboard/
  shared/           # Cross-cutting only (no product feature ownership)
    api/            # HTTP client + domain API modules
    auth/           # Session / AuthContext
    demo/           # users.ts, clinic.ts (forms, empty neuro, section labels)
    ui/             # Toast, Card, Button, and other shared primitives
    shell/          # Layout, Sidebar, Topbar, Landing, NotFound
    types/          # Shared DTO / UI types
  context/AppContext.tsx   # Composes auth + cases + kb + toasts; useApp() merge
  components/       # Compatibility re-exports (still imported) + leftover UI
  lib/backend.ts    # Compatibility facade → shared/api
  types.ts          # Compatibility facade → shared/types
  data/mock.ts      # Demo seed facade → shared/demo and feature demo modules
```

`src/pages/` has been removed. Screens live in `features/` or `shared/shell/`, and `App.tsx` mounts each feature's `routes.tsx`.

## Import rules

1. `features/A` **must not** import from `features/B`.
2. Features may import only from:
   - `shared/**`
   - their own `features/<name>/**`
   - third-party packages / `react-router-dom`
3. `shared/**` **must not** import from `features/**`.
4. New code targets `features/` or `shared/`. Do not add `src/pages/` facades.

## Domain map (FE ↔ BE)

| Feature | Primary API modules | Backend focus |
|---------|---------------------|---------------|
| auth | `shared/api/auth.ts` | `api/auth.py`, `auth/*` |
| cases | `shared/api/cases.ts` | `api/cases.py`, `services/case_service.py` |
| dicom | `shared/api/dicom.ts` | `api/dicom.py`, `services/dicom_service.py` |
| analysis | `shared/api/analysis.ts` | `api/analysis.py`, `services/analysis_application.py` |
| reports | `shared/api/reports.ts` | `api/reports.py`, `services/report_application.py` |
| expert | cases + reports APIs | worklist / review |
| submissions | `shared/api/workflow.ts`, `payments.ts` | `services/workflow_service.py`, payments |
| messaging | `shared/api/messaging.ts` (feature facade: `features/messaging/api.ts`) | `services/messaging_facade.py` |
| rag-admin | `shared/api/rag.ts` | `api/rag.py`, lessons |
| admin | `shared/api/admin.ts` | users, payouts, retention, health |

`AppContext` no longer owns that state. `useApp()` merges `AuthContext`, `CaseStore`, `KbSourcesContext`, and toast context so older call sites keep working.

## Demo seeds

| Data | Module |
|------|--------|
| `USERS`, `ROLE_LABELS` | `shared/demo/users.ts` |
| `CLINIC`, `EMPTY_NEURO`, `SAMPLE_FORM`, `SECTION_LABELS`, `getSectionLabels` | `shared/demo/clinic.ts` |
| `KB_SOURCES`, `getKbSources`, `kbSourceText`, `kbTypeLabel`, `kbLicenseLabel` | `features/rag-admin/demoKb.ts` |
| `SERVICES`, `GPU_SERIES`, `DEPLOYMENTS` | `features/admin/demoInfra.ts` |
| `MODULES` | `features/rag-admin/demoModules.ts` |

`src/data/mock.ts` re-exports those symbols so existing `from '../data/mock'` imports (including tests) keep working. Prefer the domain module in new code.

## Remaining compatibility shims

Leave these until their call sites are gone:

- `src/lib/backend.ts` — `export *` from `shared/api`
- `src/types.ts` — `export *` from `shared/types`
- `src/components/*` — re-exports of `shared/ui`, `shared/shell`, and a few feature components; many features still import them
- `src/data/mock.ts` — demo seed facade
- `src/context/AppContext.tsx` — `useApp()` composition facade

## Adding a new feature

1. Create `src/features/<name>/` with page(s), components, optional `types.ts`, optional `routes.tsx`.
2. Put shared HTTP helpers under `src/shared/api/<name>.ts` if the surface is reusable.
3. Register routes from `App.tsx` (or mount `features/<name>/routes.tsx`).
4. Do not import another feature’s internals; lift shared pieces into `shared/`.

## Backend notes

- Thin routers stay under `backend/app/api/`.
- Bounded-context application services sit beside `CaseService`: analysis, reports, DICOM, documents, workflow, payments. `CaseService` remains the case CRUD / status owner.
- Messaging is one object: `backend/app/services/messaging_facade.py` (support threads + case chat). HTTP paths are unchanged.
- Inject narrow ports instead of post-init `bind_*` where practical.
- `tests/test_import_cycles.py` must stay green.
