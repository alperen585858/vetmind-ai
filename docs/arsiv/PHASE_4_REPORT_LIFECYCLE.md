# VetMind AI — Phase 4: Report Lifecycle & Expert Review Hardening

**Status:** Traceable report versions + hardened expert review, preserving print-to-PDF.  
**Not claimed:** Clinical certification, regulatory compliance, or EMR archival.

Payment and real AI integration remain out of scope. Existing PDF stack (`ApprovedReport` + `window.print()` + `@media print` + `CaseRecord.draft_report`) is preserved. No new PDF library and no server-side PDF generation.

## 1. Architecture

```
Pipeline draft
  → attach_pipeline_draft() → DraftReport.version + report_versions[]
  → Expert review (CaseService lock + CAP_REVIEW)
       approve           → freeze_approved()     (immutable snapshot)
       reject            → apply_reject_or_revision()
       request_revision  → apply_reject_or_revision() / fork after approve
  → GET /report?version=N  /  GET /report/versions[/{n}]
  → CaseDetail history + ApprovedReport?version=N → window.print()
```

| Concept | Role |
|---------|------|
| `draft_report` | Current working report (mutable unless approved) |
| `report_versions` | Append-only history of version snapshots |
| Approved snapshot | `immutable: true`; never silently overwritten |
| CaseService lock | Serializes analyze/review version writes |

Each revision is traceable via: report ID, version number, case ID, creation timestamp, author/source, review status, content snapshot, model provenance, revision notes.

## 2. Versioning rules

1. First pipeline draft → **version 1** (mutable).
2. Approve → freeze current version (`immutable: true`); `clinically_validated` stays **false** (expert approve ≠ clinical validation).
3. Reject / request revision on a mutable draft → update status + notes; version number unchanged unless content fork is required.
4. Request revision **after** approve → fork a **new** mutable version; prior approved snapshot remains in history.
5. Concurrent review/approve under lock → one success, others **409**.
6. Re-analyze while approved → **409** (no silent overwrite).

## 3. Expert review workflow

Authorized actions (backend-validated): **approve**, **reject**, **request_revision**.

Frontend `ExpertReview`:

- Shows report status, version, validation warnings, MOCK/SYNTHETIC provenance.
- Blocks approval UX when backend validation / unsupported AI gates fail.
- Persists actions via `/review` and re-hydrates case after action (survives refresh).
- Does **not** present mock approval as clinical validation.

## 4. Report history (CaseDetail)

Tab **İşlem Geçmişi / Rapor sürümleri** lists:

- Version number
- Creation date
- Review status
- Reviewer (when available)
- Revision notes
- Current vs previous indicator
- Immutable / locked badge for approved snapshots

Historical versions open in `ApprovedReport?version=N` for inspection/print. Approved snapshots are not editable.

## 5. Print / PDF consistency

Preserved from PDF audit:

- `ApprovedReport` + `window.print()` + `@media print`
- Correct patient metadata, real backend findings, expert review block
- MOCK/SYNTHETIC warnings, report version identifier, print-friendly layout
- No fabricated clinical content

Print uses the **selected persisted** report version (`?version=`), not a client-invented draft.

## 6. Security & integrity

- CAP_REVIEW and case ownership enforced server-side
- Report version GET scoped by case ID (no cross-case access)
- Immutable approved versions reject mutation paths
- Review actions stored on case/report history (auditable at app level)
- Avoid logging patient identifiers in versioning helpers
- Mock/real provenance rules preserved

## 7. Modified files

**Backend**

- `backend/app/schemas/report.py` — version fields, snapshots/summaries
- `backend/app/schemas/case.py` — `report_versions`
- `backend/app/services/report_versioning.py` — attach / freeze / reject-revision helpers
- `backend/app/services/case_service.py` — locked analyze/review integration
- `backend/app/api/reports.py` — version list/detail + `?version=`
- `backend/tests/test_report_versioning.py` — lifecycle tests

**Frontend**

- `src/types.ts`, `src/lib/backend.ts`, `src/lib/caseMapper.ts`, `src/lib/reportPrint.ts`
- `src/lib/reportPrint.test.ts` — version label / PDF regression fixtures
- `src/pages/CaseDetail.tsx` — history section
- `src/pages/ExpertReview.tsx` — status/warnings/persistence
- `src/pages/ApprovedReport.tsx` — version query + print provenance

**Docs**

- `docs/PHASE_4_REPORT_LIFECYCLE.md` (this file)

## 8. Test coverage (Phase 4 focus)

| Area | Covered by |
|------|------------|
| Version creation (v1) | `test_pipeline_creates_version_one` |
| Concurrent revision / approve | lock + 409 cases in versioning tests |
| Immutable approved versions | `test_approve_freezes_immutable_version` |
| Historical retrieval | versions list/detail assertions |
| Review state transitions | approve / reject / request_revision tests |
| Unauthorized approval | CAP_REVIEW / auth tests (existing suite) |
| Refresh persistence | FE hydrate after review + backend store |
| Selected version print | `reportPrint.test.ts` provenance `v\d+` |
| Missing report data | print/canExport guards |
| PDF audit regressions | `reportPrint.test.ts` + mapper merge tests |

## 9. Suite results (this delivery)

Commands run on host after freeing disk (Homebrew/npm caches):

| Command | Result |
|---------|--------|
| `npm test` | **PASS** — 6 files, **18** tests |
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS** — vite production build |
| `npm run backend:test` | **PASS** — **202** passed, **1** skipped, 0 failed |

Notes: Host previously hit `ENOSPC` (~17–39 Mi free). Cleared caches to ~187 Mi before the successful run. `pygments` was force-reinstalled in the backend venv after a partial package removal during disk recovery.

## 10. Known limitations

- Versions live on the case JSON document (no separate report table / WORM store)
- Review feedback has limited independent audit metadata
- Browser print page numbers / headers are engine-dependent
- Not a regulated healthcare records archive

## 11. Remaining production blockers

- JWT-bound reviewer identity (demo reviewer strings today)
- Backup / retention / export policy for version history
- Formal clinical validation process (explicitly out of scope)
- Host disk capacity for CI/local suites
- Real AI providers (Phase constraint: none)

## Non-claims

Traceable demo versioning and expert-review persistence are **not** healthcare records compliance, CE/FDA readiness, or clinical validation.
