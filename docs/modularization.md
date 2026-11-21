# Frontend / Backend Modularization

Status: **completed**. VetMind remains a **modular monolith** (one deployable). Feature boundaries below are the current layout, not a migration plan.

## Frontend layout

```text
src/
  App.tsx           # Route composition: feature routes + shell slots
  main.tsx          # LocaleProvider + AppProviders
  app/              # Composition root (may import features and shared)
    providers.tsx   # AuthProvider, CaseProvider, KbSourcesProvider, ToastProvider
    useApp.ts       # useMergedAppState() — merges those stores
    Dashboard.tsx   # Role switch across feature dashboards
  features/         # Product domains (pages, local components, lib/, routes.tsx)
    auth/           # Login/register screens, passwordPolicy (session helpers live in shared/auth)
    cases/          # Case pages, CaseStore, role dashboards
    dicom/          # Upload, series explorer; viewer is shared/dicom
    analysis/       # Processing page
    reports/        # Report list/print; editor widgets live in shared/ui
    expert/         # Worklist and radiologist workspace
    submissions/
    messaging/      # api.ts re-exports shared/api/messaging; NotificationBell
    rag-admin/      # demoKb.ts — KB seed + label helpers; SourcePanel
    admin/          # demoInfra.ts — service cards + module catalog
  shared/           # Cross-cutting only (must not import features)
    api/            # HTTP client + domain API modules
    auth/           # AuthContext + session.ts (JWT and demo session)
    demo/           # users.ts, clinic.ts, caseTemplates.ts
    dicom/          # DicomViewer and VHS guide (embedded by cases and expert)
    ui/             # Primitives plus widgets used by more than one feature
    shell/          # Layout, Sidebar, Topbar, Landing, AppContext, LocaleContext
    hooks/          # useLocalizedNavigate
    lib/            # caseId, caseMapper, dicomLimits, dicomFolder, recommendations, …
    types/          # Shared DTO / UI types
```

Flat folders are removed: `src/components/`, `src/lib/`, `src/data/`, `src/context/`, `src/hooks/`, and the `src/types.ts` facade. Nothing re-exports them. Screens live in `features/` or `shared/shell/`, and `App.tsx` mounts each feature's `routes.tsx`. HTTP calls import `shared/api`. Shared DTO types import `shared/types`.

`src/app/` is the composition root. `AppProviders` nests feature stores. `useMergedAppState()` combines them. `useApp()` in `shared/shell/AppContext.tsx` only reads that value. Its `AppState` import from `src/app/useApp.ts` is type-only and is erased at runtime, so `shared/` does not load feature modules.

## Import rules

1. `features/A` **must not** import from `features/B`.
2. Features may import only from:
   - `shared/**`
   - their own `features/<name>/**`
   - third-party packages / `react-router-dom`
3. `shared/**` **must not** import from `features/**`.
4. `src/app/**` and `src/App.tsx` may import both `features/**` and `shared/**`. Pass feature UI into the shell as slots (`notificationSlot`, `sourcePanel`) instead of importing it from `shared/shell`.
5. New code targets `features/`, `shared/`, or `src/app/` when it is composition. Do not add `src/pages/` facades.

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
| payments | `shared/api/payments.ts` | demo payment step UI (`shared/ui/DemoPaymentStep.tsx`, used by submissions) |
| messaging | `shared/api/messaging.ts` (feature facade: `features/messaging/api.ts`) | `services/messaging_facade.py` |
| rag-admin | `shared/api/rag.ts` | `api/rag.py`, lessons |
| admin | `shared/api/admin.ts` | users, payouts, retention, health |

Provider nesting and `useMergedAppState()` live in `src/app/`. `useApp()` in `shared/shell/AppContext.tsx` reads the merged auth, case, knowledge-base, and toast state. `App.tsx` passes `<NotificationBell />` and `<SourcePanel />` into `Layout`.

## Demo seeds

| Data | Module |
|------|--------|
| `USERS`, `ROLE_LABELS` | `shared/demo/users.ts` |
| `CLINIC`, `EMPTY_NEURO`, `SAMPLE_FORM`, `SECTION_LABELS`, `getSectionLabels` | `shared/demo/clinic.ts` |
| `KB_SOURCES`, `getKbSources`, `kbSourceText`, `kbTypeLabel`, `kbLicenseLabel` | `features/rag-admin/demoKb.ts` |
| `SERVICES`, `GPU_SERIES`, `DEPLOYMENTS` | `features/admin/demoInfra.ts` |
| `MODULES` | `features/rag-admin/demoModules.ts` |
| Case AI templates | `shared/demo/caseTemplates.ts`, `caseTemplatesEn.ts` |

Import demo symbols from those modules. `src/data/mock.ts` has been removed.

## Flat folders removed

These compatibility facades are gone. Call sites import the real module:

- `src/lib/backend.ts` → `shared/api`
- `src/types.ts` → `shared/types`
- `src/components/*` → `shared/ui`, `shared/shell`, or the owning `features/<name>/`
- `src/data/mock.ts` → `shared/demo/*` and the feature demo modules above
- `src/context/AppContext.tsx` → `shared/shell/AppContext.tsx`
- `src/context/LocaleContext.tsx` → `shared/shell/LocaleContext.tsx`
- `src/hooks/useLocalizedNavigate.ts` → `shared/hooks/useLocalizedNavigate.ts`
- `src/lib/*` helpers → `shared/lib`, `shared/shell/lazyPage.ts`, or `features/<name>/lib/`

## Adding a new feature

1. Create `src/features/<name>/` with page(s), components, optional `types.ts`, optional `routes.tsx`.
2. Put shared HTTP helpers under `src/shared/api/<name>.ts` if the surface is reusable.
3. Register routes from `App.tsx` (or mount `features/<name>/routes.tsx`).
4. Do not import another feature’s internals. Lift shared pieces into `shared/`. Wire feature-only UI through `src/app/` or `App.tsx` slots.
5. If a new provider belongs in the signed-in tree, nest it in `src/app/providers.tsx` and add its fields in `useMergedAppState()`.

## Backend notes

- Thin routers stay under `backend/app/api/`.
- Bounded-context application services sit beside `CaseService`: analysis, reports, DICOM, documents, workflow, payments. `CaseService` remains the case CRUD / status owner.
- Messaging is one object: `backend/app/services/messaging_facade.py` (support threads + case chat). HTTP paths are unchanged.
- Inject narrow ports instead of post-init `bind_*` where practical.
- `tests/test_import_cycles.py` must stay green.
