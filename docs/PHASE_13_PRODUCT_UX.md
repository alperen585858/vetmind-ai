# Phase 13 — Product Integration & UX Polish

Extends Phase 1–12 workflows. No backend redesign; APIs and immutable reports unchanged.

## Improvements

| Area | Change |
|------|--------|
| **Shell** | Skip link, focus-visible rings, labeled topbar/sidebar controls, demo notification toast |
| **Navigation** | Shared `Breadcrumbs` + `PageHeader.crumbs` on case journey pages |
| **Dashboards** | Role panels for vet / radiologist / owner / admin; expert CTAs → worklist/workspace |
| **Case journey** | NewCase demo actions collapsed; expert opens `/calisma`; duplicate AI tab removed |
| **Workspace** | Sticky viewer on desktop, approve confirm modal, clearer case context cards |
| **UX states** | EmptyState on queues/reports; actionable sync/error copy |
| **AI transparency** | Shared `ProvenanceBanner` (MOCK / SYNTHETIC / MIXED / REAL / NOT CONFIGURED) |
| **A11y** | Modal dialog role, Escape, focus trap; form labels; readable contrast on banners |

## Key files

- `src/components/{Breadcrumbs,ProvenanceBanner,Modal,PageHeader,Layout,Topbar,Sidebar}.tsx`
- `src/pages/{Dashboard,ReviewQueue,CaseDetail,RadiologistWorkspace,NewCase,CaseList,ApprovedReport,ReportList}.tsx`
- `src/index.css` — focus + skip-link

## Verify

```bash
npm run typecheck && npm run build && npm run test
cd backend && pytest tests/test_phase12_reporting.py -q
```

## Limitations

- Notifications remain demo (no push channel).
- Frontend role switch is demo UX; backend RBAC when auth enabled.
- Medical viewer usability prioritized on desktop; mobile is scroll/stack, not multi-monitor hanging.
- Browser print PDF only.
