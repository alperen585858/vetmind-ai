# VetMind AI — PDF Report / Backend Integration Audit

**Date:** 2026-10-22  
**Scope:** Existing report PDF/export feature only.  
**Constraint:** Do not rebuild PDF stack; fix confirmed defects only. No payment / real AI.

---

## 1. Existing PDF architecture

VetMind does **not** use a PDF generation library (no jsPDF, html2pdf, react-pdf, ReportLab, WeasyPrint for reports).

**Export mechanism:** browser **print-to-PDF** via `window.print()` on the approved report page.

```
Expert approve (or seed approved case)
  → navigate /raporlar/:id
  → ApprovedReport.tsx renders HTML article
  → user clicks "PDF olarak indir"
  → window.print() + CSS @media print
  → OS/browser “Save as PDF”
```

`pypdf` in the backend is used only for **document ingest text extraction** (`backend/app/ingest/documents.py`), not report PDF export.

---

## 2. Exact file paths

| Path | Role |
|------|------|
| `src/pages/ApprovedReport.tsx` | Report UI + **PDF olarak indir** → `window.print()` |
| `src/index.css` (`@media print`, `.no-print`, `@page`) | Print layout / hide chrome |
| `src/components/Layout.tsx` | `print:pl-0` / `print:p-0` |
| `src/components/Sidebar.tsx`, `Topbar.tsx`, `Toasts.tsx` | `.no-print` |
| `src/pages/ReportList.tsx` | Lists `status === 'onaylandi'` → open report |
| `src/pages/ExpertReview.tsx` | Approve → navigate to `/raporlar/:id` |
| `src/lib/reportPrint.ts` | Print sections + MOCK/REAL provenance helpers (**added**) |
| `src/lib/caseMapper.ts` | `recordToVetCase` / `mergeBackendCases` → report body for print |
| `src/lib/backend.ts` | `getBackendCase`, `submitBackendReview`, `draftToSections` |
| `backend/app/api/reports.py` | `GET /cases/{id}/report`, `POST /cases/{id}/review` |
| `backend/app/schemas/report.py` | `DraftReport` persistence shape |
| `backend/app/services/case_service.py` | Approve/reject/revision; saves `draft_report` on case |
| `backend/app/services/sqlite_repository.py` | Case JSON blob (includes draft_report) |

**Function names (export path):**

- Frontend: `ApprovedReport` default export; button `onClick={() => window.print()}`
- Helpers: `printSectionsForCase`, `reportProvenance`, `canExportApprovedReport` (`reportPrint.ts`)
- Backend: **no** report-PDF endpoint

---

## 3. Frontend / backend / hybrid classification

| Classification | Verdict |
|----------------|---------|
| **Frontend-generated** | **Yes** — HTML + `window.print()` |
| Backend-generated PDF bytes | **No** |
| Hybrid (FE print of BE data) | **Intended** after hydrate; was broken for `case-*` refresh |

---

## 4. Actual PDF data source

| Scenario | Data source |
|----------|-------------|
| Seed demo cases (`c-duman`, etc.) | In-memory `SEED_CASES` / local `VetCase.report` |
| Backend-approved cases | Persisted `CaseRecord.draft_report` (+ findings) via `GET /api/v1/cases/{id}` → `recordToVetCase` |

PDF file itself is **not** stored. Content is regenerated on demand from in-memory/`draft_report` HTML.

---

## 5. Backend integration status (verified)

| Question | Answer |
|----------|--------|
| Uses persisted backend case data? | **Yes, after hydrate** for `case-*` ids. Seed cases are local-only. |
| Structured findings in PDF body? | Findings appear as **LLM draft section text** from `draft_report.findings`, not a separate finding table. Structured findings drive provenance (`source_kind`, model id). |
| Expert review status? | Case lifecycle `approved` + `review_history` → `approvedBy`; draft `expert_review_status`. |
| Report saved in DB? | **Yes** — `draft_report` on case JSON (sqlite/memory/postgres). |
| Generated PDF persisted? | **No** — print only. |
| MOCK / SYNTHETIC labeled? | **Yes after fix** — printable banner + provenance block. |
| Report versions? | **No** — single `draft_report`; overwrite on edit/approve. |
| Works after page refresh? | **Yes after fix** — `ApprovedReport` hydrates `case-*`; merge preserves hydrated draft. |
| Fails safely if backend down? | **Yes after fix** — loading/error empty states; no fake success. |

### End-to-end flow (backend path)

`DICOM/demo → confirm → analyze → draft_report → POST /review approve → CaseRecord.status=approved → FE hydrate → ApprovedReport → window.print()`

Unauthorized review remains enforced by `CAP_REVIEW` (vet 403) — unchanged.

---

## 6. Identified issues (pre-fix)

1. **P0 — No hydrate on ApprovedReport** for `case-*` → refresh lost report body.  
2. **P0 — `mergeBackendCases` wiped hydrated drafts** when list sync replaced rows with summaries.  
3. **P1 — Fabricated `ayiriciTanilar` section** printed for backend drafts (`draftToSections` placeholder).  
4. **P1 — MOCK/SYNTHETIC not visible on print** (only generic demo footnote).  
5. **P1 — Backend patient age/sex defaults (0 / Erkek)** printed as if real.  
6. **P2 — ExpertReview** updated local state without re-hydrate after approve.  
7. **P2 — RAG block was `no-print`** (hidden from PDF).  
8. **Limitation — no report versioning / no server PDF / no reliable CSS page numbers across browsers.**

---

## 7. Minimal fixes performed

| Fix | Where |
|-----|--------|
| Hydrate `case-*` on ApprovedReport; safe loading/error | `ApprovedReport.tsx` |
| Print only persisted 4 backend sections | `reportPrint.ts` |
| Printable MOCK/REAL/MIXED banner + provenance | `ApprovedReport.tsx`, `reportPrint.ts` |
| Map `review_history` → `approvedBy` / `reportNo` | `caseMapper.ts` |
| Preserve hydrated report across list merge | `mergeBackendCases` |
| Hide non-persisted patient extras for backend cases | `ApprovedReport.tsx` |
| Re-hydrate after backend review | `ExpertReview.tsx` |
| Include RAG in print (labeled non-clinical) | `ApprovedReport.tsx` |
| Unit tests for print binding / merge / Turkish text | `reportPrint.test.ts` |

**Not done (by design):** new PDF library, new PDF API, UI redesign, report versioning system.

---

## 8. Tests executed and results

| Command | Result |
|---------|--------|
| `npm test` | **Pass** — 6 files, 18 tests (incl. `reportPrint.test.ts`) |
| `npm run typecheck` | **Pass** |
| `npm run build` | **Pass** |
| `npm run backend:test` | **Pass** (existing approve/review suite; no new PDF endpoint) |

Frontend coverage added:

- Approved backend record → printable sections + MOCK banner + Turkish chars  
- Export refused when not approved / missing body  
- Merge preserves hydrated draft for print after list sync  

Browser print dialog / multi-page OS PDF cannot be asserted in Vitest; HTML content + CSS print path verified by code + unit tests.

---

## 9. Remaining limitations

- Export quality depends on the browser print engine (margins, headers, page numbers).  
- No immutable report version history.  
- No server-side PDF artifact or audit hash of the printed bytes.  
- Seed demo PDFs still use local mock content (correctly labeled as local prototype).  
- Owner ACL for backend cases is route-role based, not per-owner PHI isolation.  
- Disk space on the host was critically low during this audit; keep build caches clean when re-running suites.

---

## Non-claims

This audit does **not** claim clinical validation, certified PDF archival, or that print-to-PDF equals a hospital EMR export. It verifies and strengthens the **existing** print-PDF feature’s binding to persisted backend reports.
