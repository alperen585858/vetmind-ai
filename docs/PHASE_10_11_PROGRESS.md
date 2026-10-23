# Phase 10–11 Progress

## Done (Phase 10 — Radiologist workspace)

- Worklist (`/kuyruk`): search/filter by status, modality, priority, assignment; assign-to-self; link to workspace
- Split workspace (`/vakalar/:id/calisma`): DICOM left + report editor right
- Viewer: series nav, compare, zoom/pan, W/L, fullscreen, calibrated measure when PixelSpacing present
- Report editor: section edit, templates, save draft (`PUT /report/draft`), approve/reject/revision, version history (immutable after approve)
- Case context + AI Findings panel labeled **NOT CONFIGURED** (no fabricated findings)
- Keyboard: viewer shortcuts + ⌘/Ctrl+S draft save

## Done (Phase 11 — Clinic foundation)

- Persisted `priority`, `patient_age_years`, `assigned_reviewer_id`, `clinical_history_structured` (+ handoff notes)
- NewCase sends structured history / priority / age to API
- Case progress tracker on case overview + workspace
- Tenant-scoped worklist/list (existing RBAC/tenancy preserved)

## Verification

- `pytest tests/test_phase10_workspace.py` (+ report versioning / phase6 sample): pass
- `npm run typecheck` / `npm run build`: pass
- Full Playwright E2E for workspace: **not claimed**

## Remaining limitations

- No multi-monitor hanging protocol / MPR
- Assignment is string id (not staff directory)
- Clinic handoff is structured notes, not messaging
- Real Vision AI still not configured (panel honest)
- Frontend role Gate remains demo-switchable; backend enforces capabilities when auth on
