## Türkçe (kolay dil)

**Başlık önerisi:** Sahibe giden rapor linki bazen yanlış sürümü açıyor

### Ne oluyor?
E-posta / public rapor linkindeki sürüm numarası bulunamazsa sistem “neyse, başka onaylı sürüm var” deyip **farklı bir onaylı metni** gösterebiliyor.

### Neden önemli?
Sahip yanlış klinik metni okur; hukuki/iletişim riski.

### Nerede?
- `backend/app/api/report_links.py` — token sürümü yoksa approved draft fallback

### Ne yapalım?
1. Fallback’i kaldır; sürüm yoksa 404.
2. Test: token v2, snapshot yok → 404 (v3 gösterme).

### Bitti sayılır
- [ ] Yanlış sürüm asla dönülmez
- [ ] Pytest regresyonu var

---

## English (AI-agent optimized)

**Title:** Remove public report-view fallback to a different approved version

### Problem
In `backend/app/api/report_links.py`, if the token’s `report_version` has no matching immutable snapshot, the handler falls back to any immutable `APPROVED` draft. Owners can see clinical text from a different version than the link promised.

### Evidence
`elif draft is not None and draft.immutable and draft.status == ReportStatus.APPROVED:` fallback after missing version-matched snaps.

### Acceptance criteria
1. If `rec.report_version` does not match an immutable snapshot (or matching draft version), return 404 `report_not_available`.
2. Never substitute another approved version.
3. Pytest: token for version N with only version M approved ⇒ 404; exact match ⇒ 200 with version N.

### Optional follow-up
Rate-limit / remove `consume=false` unlimited peek (separate issue if needed).
