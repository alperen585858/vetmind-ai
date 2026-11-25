# Phase 14 — Role-Based Functional Completion

Cross-role path (persisted, RBAC-enforced):

**Pet Owner → imaging submission (+ DICOM) → Vet verification → Case (+ optional assign) → Radiologist review → Approved report → Owner access**

## Roles

| Role | Capabilities (high level) |
|------|---------------------------|
| `owner` | Pets, submissions, own approved reports only (no clinic-wide case list) |
| `vet` | Cases, DICOM, accept/reject/request-info on submissions, assign radiologist |
| `expert` | Worklist, workspace, approve/reject/revision, messaging |
| `clinic_owner` | Clinic stats, staff list, submissions view, authorized reports |
| `admin` | Users/roles/clinic membership directory + system status |

## APIs

- `POST/GET/PATCH /api/v1/pets`
- `POST/GET/PATCH /api/v1/submissions`, `POST .../vet-action`
- `GET /api/v1/clinic/stats`
- `GET/POST/PATCH /api/v1/admin/users`
- Assignment: vet **or** expert (`cases:write` \| `review`)

## Isolation

- Pet owners match `pet_owner_subject` / pet `owner_subject` — **never** clinic-wide access.
- Owners may `GET` a case only when `status=approved`.
- Analysis blocked when `vet_verified=false`.

## FE routes

`/hayvanlar`, `/basvurular`, `/kullanicilar`; clinic_owner dashboard; sidebar menus updated.

## Verify

```bash
cd backend && pytest tests/test_phase14_roles.py tests/test_rbac.py -q
npm run typecheck && npm run build
```

## Gaps

- Owner DICOM uses existing quarantine upload (demo fixture helper in UI); full browser folder picker can reuse `/dicom/upload`.
- Postgres cases + sqlite workflow sidecar (not dual-write JSONB for pets).
- No real IdP / email invitations.
