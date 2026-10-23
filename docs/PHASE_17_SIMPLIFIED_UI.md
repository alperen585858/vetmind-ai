# Phase 17 — Simplified UI/UX

## Goal

Make VetMind AI easier to use: fewer nav items, clearer primary actions, role-focused dashboards, less visual clutter — without removing features.

## Changes

### Navigation
- Role menus grouped (İş akışı / Sonuçlar / Yönetim / Gelişmiş).
- Owner: Ana sayfa · Hayvanlarım · DICOM yükle · Raporlarım.
- Vet: Ana sayfa · Başvuru onayı · Vaka kuyruğu · DICOM yükle · Onaylı raporlar.
- Radiologist: Ana sayfa · İş listesi (badge).
- Clinic owner: Genel bakış · Vakalar · Başvurular · Raporlar.
- Admin: Kullanıcılar first; modüller / bilgi tabanı / sistem under **Gelişmiş**.

### Dashboards
- Owner: four large action tiles (pets, upload, requests, reports) + ready reports list.
- Vet: three stats + compact case queue + primary CTAs.
- Radiologist: queue-focused home → worklist.
- Clinic owner: four KPIs + staff list.
- Admin: management tiles (no GPU chart on home; chart remains on Sistem durumu).

### Progressive disclosure
- Radiologist worklist: search first; modality/priority/assignment under **Gelişmiş filtreler**.
- Radiologist workspace: clinical context + AI findings collapsed; larger DICOM + report editor.
- Case list: removed duplicate status chip strip (dropdown filters kept).

### Labels & layout
- Clearer Turkish titles (DICOM yükle, Başvuru onayı, Vaka kuyruğu, İş listesi).
- Narrower sidebar (`w-60`), calmer content width (`max-w-6xl`), lighter topbar.

## Preserved
- All routes and backend APIs (DICOM, submissions, cases, reports, admin).
- Dark DICOM viewer; light clinical chrome.
- Role gates and capabilities unchanged.

## Verify
```bash
npm run typecheck
npm run build
npm test
```
