# Phase 12 — Professional Reporting & Case Management

Extends Phase 4 / 10–11 report lifecycle, worklist, and clinic foundation. No new PDF library; print-to-PDF preserved.

## Features

| Area | Behavior |
|------|----------|
| **Templates** | MRI / CT / XR structured skeletons (findings, interpretation/impression, recommendations). Placeholders only — no fabricated findings. |
| **PDF print** | Clinic, case, modality, radiologist, approval date, delivery status on `ApprovedReport`. |
| **Immutability** | Approved versions remain frozen; delivery metadata lives on the case, not inside report content. |
| **Messaging** | `GET/POST /cases/{id}/messages`, `POST .../messages/read`. Author, role, timestamp, unread; CAP_CASE_WRITE or CAP_REVIEW; tenant via case ownership. |
| **Priority** | `normal` / `high` (legacy) / `urgent` / `stat`. Worklist sorts STAT → URGENT → high → NORMAL. |
| **Delivery** | `report_available_at` on approve; `POST .../report/deliver` and `.../report/viewed`. |
| **Versions** | Existing version APIs + UI side-by-side compare (content never rewritten). |
| **Clinic dashboard** | `GET /cases/dashboard` counters + FE search/status filters + progress timeline. |

## Key paths

- Backend: `schemas/case.py`, `services/case_service.py`, `api/cases.py`, `api/reports.py`
- Frontend: `reportTemplates.ts`, `CaseMessaging.tsx`, `ReportVersionCompare.tsx`, `Dashboard.tsx`, `ApprovedReport.tsx`, `ReviewQueue.tsx`

## Tests

```bash
cd backend && pytest tests/test_phase12_reporting.py -q
npm run typecheck && npm run build
```

## Limitations

- Browser print PDF only (no server-side PDF engine).
- Assignment remains string reviewer id (no staff directory).
- Frontend role switch is demo UX; backend enforces RBAC when auth is enabled.
- Real Vision AI still not configured.
