# Phase 18 — User Workflow Expansion

Adds missing daily workflows for pet owner, veterinarian, and radiologist **without** changing navigation or overall UI design.

## Delivered

### Pet owner
- Extra DICOM/documents on open submissions via `POST /submissions/{id}/attachments` (primary ingest preserved; extras in `attachments[]`).
- Reply to vet info requests (`OPEN` → `ANSWERED`) with required-actions banner on Başvurular.
- Status + actions surfaced on the existing submissions list.
- Prior studies/reports via existing pet medical history (`/hayvanlar`).

### Veterinarian
- Custom missing-info text; structured `info_requests` with OPEN / ANSWERED / CLOSED.
- Review owner replies; close answered requests.
- Append-only clinical notes on cases (`POST /cases/{id}/clinical-notes`) — prior `clinical_history` kept.
- Attach documents to an **existing** case (`POST /cases/{id}/documents`) — never creates a duplicate case.
- Pet imaging history panel on case overview.

### Radiologist
- Case info request to veterinarian; internal notes (hidden from vet/owner on GET).
- Worklist prev/next saves draft before navigate.
- Prior approved reports for the same pet in the workspace context panel.

### Shared
- Persistent attachments, notes, info requests; Phase 17 notifications for open/answered/closed/attachment/clinical updates.
- RBAC + tenant isolation unchanged; immutable approved reports untouched.

## Key APIs
- `POST /api/v1/submissions/{id}/attachments`
- `POST /api/v1/submissions/{id}/info-requests/{rid}/reply|close`
- `POST /api/v1/cases/{id}/clinical-notes`
- `POST /api/v1/cases/{id}/internal-notes`
- `POST /api/v1/cases/{id}/info-requests` (+ reply/close)
- `POST /api/v1/cases/{id}/documents`

## Tests
`backend/tests/test_phase18_workflows.py`

## Limits
- Clinic vet notification for expert→vet requests still uses directory/demo recipients when case `owner_subject` is the pet owner.
- Multi-DICOM extras are listed as attachments; only the primary ingest is confirmed onto the case on accept.
