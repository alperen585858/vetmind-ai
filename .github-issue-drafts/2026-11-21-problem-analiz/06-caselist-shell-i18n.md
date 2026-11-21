## Türkçe (kolay dil)

**Başlık önerisi:** İngilizce seçilince vaka listesi ve menü hâlâ Türkçe çıkıyor

### Ne oluyor?
Dil EN olsa bile:
- Vaka listesinde eşitleme toast’ları, silme onay penceresi, “Köpek/Kedi” filtreleri Türkçe
- Kenar menüde “Menü”, “İçeriğe atla” Türkçe
- Anatomi bölge adları mapper’da sabit Türkçe (“Servikal”, “Beyin”)

### Neden önemli?
Çift dil ürün iddiası bozulur; demo/EN kullanıcılar TR metin görür.

### Nerede?
- `src/pages/CaseList.tsx`
- `src/components/Sidebar.tsx`, `Layout.tsx`
- `src/lib/caseMapper.ts` — `regionLabel`

### Ne yapalım?
1. Hardcoded string’leri `t()` / locale key’lere taşı.
2. `regionLabel` locale alsın veya kod + i18n map kullansın.
3. EN smoke: CaseList sync/delete + sidebar.

### Bitti sayılır
- [ ] EN locale’de CaseList kritik diyaloglar İngilizce
- [ ] Skip link / Menü locale’ye uyuyor
- [ ] Bölge etiketleri EN’de İngilizce

---

## English (AI-agent optimized)

**Title:** Localize CaseList toasts/modals, shell chrome, and `regionLabel` for EN locale

### Problem
Despite `useLocale()`, several user-visible strings remain hardcoded Turkish:
- `CaseList.tsx`: sync toasts, delete modal, species `<option>` values
- `Sidebar.tsx` / `Layout.tsx`: `"Menü"`, skip link `"İçeriğe atla"`
- `caseMapper.regionLabel()`: always returns TR labels (`Servikal`, `Beyin`, …)

### Acceptance criteria
1. Move listed strings to `i18n/tr.json` + `i18n/en.json` and use `t()`.
2. `regionLabel` must respect locale (or return stable codes mapped in UI via `t()`).
3. Manual: set EN → CaseList sync failure toast, delete modal, species filter, sidebar section label, skip link are English.
4. Prefer not changing backend wire formats; localize at presentation layer.
