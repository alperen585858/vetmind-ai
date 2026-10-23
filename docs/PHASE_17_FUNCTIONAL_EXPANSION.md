# Phase 17 — Functional Expansion

UI/navigation unchanged. Adds persistent notifications, pet medical history, server PDF export, and case activity events.

## 1. Notifications
- Store: memory or `vetmind_notifications.sqlite3` sidecar (same pattern as workflow store).
- API: `GET/POST /api/v1/notifications`, mark-one / mark-all read.
- Emitted on: submission create/DICOM attach, vet verify/reject/needs_info, radiologist assign (incl. urgent/STAT), case messages, revision, report approve.
- Deduped by `dedupe_key`.
- UI: topbar `NotificationBell` (unread badge, list, navigate on click).

## 2. Pet medical history
- `GET /api/v1/pets/{pet_id}/medical-history` aggregates clinical notes, submissions, DICOM links, cases, approved reports (ACL-aware).
- OwnerPets: **Tıbbi geçmiş** expands chronological timeline.

## 3. Server PDF
- `GET /api/v1/cases/{case_id}/report/pdf` — ReportLab PDF from immutable approved report only.
- Turkish via system Unicode TTF when available (Arial Unicode / DejaVu).
- ApprovedReport: **PDF indir** (server) + Yazdır.

## 4. Case activity
- `CaseRecord.activity` append-only real events.
- `GET /api/v1/cases/{case_id}/activity`.
- Shown on CaseDetail history tab when present.

## Tests
`backend/tests/test_phase17_functional.py`
