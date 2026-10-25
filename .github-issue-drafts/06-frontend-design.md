## Özet

Frontend şu an **demo/prototip seviyesinde**: rol bazlı sayfalar ve akış iskeleti var, ama ürün kalitesinde **görsel tasarım, tutarlılık, boş durumlar, mobil UX ve “gerçek ürün” hissi** çok eksik. Bu issue, FE’yi bitirme demosunun ötesine taşıyacak **tasarım + UX geliştirme** işini tanımlar.

**Kapsam:** `src/` (React 18 · Vite · Tailwind · React Router)  
**Öncelik:** P1 (ürün algısı / jüri & demo deneyimi)  
**Bağımlılık:** Backend API sözleşmesi değişmez; immutable rapor / provenance kuralları korunur.

---

## Mevcut durum (kısa)

| Alan | Durum |
|------|--------|
| Rotalar / roller | Gate ile vet / expert / owner / clinic_owner / admin — çalışır |
| Landing | Kısmen polish’li (`Landing.tsx` + motion) |
| App shell | Sidebar + Topbar + Card/StatCard — jenerik dashboard hissi |
| Tasarım sistemi | Tailwind `navy`/`teal` + Inter/Outfit; bileşenler tutarsız |
| Veri | Çok yerde `data/mock.ts`, fiction pipeline (`pipeline.ts`) |
| Phase 13 UX | Skip-link, breadcrumbs, provenance banner — temel a11y var |
| Mobil | Stack/scroll; radyolog workspace desktop öncelikli |
| Görsel kimlik | Landing ≠ app içi dil; kart/gölge/spacing dağınık |

---

## Sorunlar (neden “çok eksik”)

### 1. Görsel dil dağınık
- Landing (sky gradient, rounded-full CTA) ile app shell (slate-50, soft cards) **aynı ürün gibi hissettirmiyor**.
- `Card` / `StatCard` / `Button` / `input` stilleri sayfalar arası drift ediyor.
- Tipografi: display font landing’de; app’te çoğunlukla Inter — hiyerarşi zayıf.
- İkon + renk + badge kullanımı (StatusBadge, PriorityBadge) her ekranda farklı yoğunlukta.

### 2. Dashboard / listeler “şablon dashboard”
- Stat strip + tablo + filtre kalıbı tekrar ediyor; klinik iş akışı görsel olarak anlatılmıyor.
- Boş / loading / hata durumları yer yer `EmptyState`, yer yer düz metin.
- Admin `SystemStatus` mock GPU/queue kartları ürün yanılsaması yaratıyor.

### 3. Kritik journey ekranları ham
- **DICOM yükleme** uzun, bilgi yoğun, adımlar görsel olarak zayıf ayrılmış.
- **Processing** fiction log’ları backend gerçekliğiyle karışabiliyor (`pipeline.ts`).
- **CaseDetail / ExpertReview / RadiologistWorkspace** bilgi yoğun; panel düzeni, sticky viewer, focus mode yetersiz.
- **Mesajlar / Başvurular / Ödeme** yeni eklendi; görsel olgunluk düşük.

### 4. Mobil & responsive
- Sidebar overlay var ama workspace / dual-panel (viewer + findings) mobilde kullanışsız.
- Form alanları, tablolar, sticky CTA’lar küçük ekranda kırılıyor veya scroll cehennemi.

### 5. Micro-UX eksikleri
- Skeleton / shimmer yok (veya seyrek).
- Toast / inline validation tutarsız.
- Onay modalları var ama destructive aksiyon görsel hiyerarşisi zayıf.
- Print/PDF dışı “rapor sunumu” ekranı klinik ürün gibi değil.

### 6. Tasarım sistemi yok (token + bileşen kitabı)
- Spacing, radius, elevation, semantic color (success/warn/danger/info) tek kaynakta değil.
- Storybook / UI kit / Figma eşlemesi yok.
- Dark mode yok (bilinçli olabilir) ama light theme bile token’lanmamış.

---

## Hedef (ne “güzel” sayılır)

1. **Tek görsel kimlik:** Landing ↔ Login ↔ App shell aynı brand dili (renk, tipografi, radius, motion).
2. **Klinik iş odaklı layout:** Dashboard “istatistik duvarı” değil; sıradaki aksiyon + kuyruk + acil vakalar.
3. **Journey polish:** Upload → Confirm → Analyze → Review → Approve adımları görsel progress + net CTA.
4. **Dense ama okunabilir workspace:** Viewer + findings + report üçlüsü; collapsible paneller; focus mode.
5. **Dürüst demo:** MOCK/SYNTHETIC/provenance her yerde; fiction pipeline “DEMO FICTION” etiketi.
6. **Mobil kabul:** En azından vet upload + case list + owner submissions kullanılabilir.

---

## Kabul kriterleri

### A. Tasarım sistemi
- [ ] `src/` altında semantic token’lar (CSS variables veya Tailwind extend): `surface`, `border`, `accent`, `danger`, `success`, `warning`.
- [ ] Paylaşılan primitive’ler güncellenir: `Button`, `Card`, `Input`, `Badge`, `PageHeader`, `EmptyState`, `Skeleton`.
- [ ] Tipografi skalası (display / title / body / caption) dokümante + uygulanmış.
- [ ] Spacing/radius/shadow 3–4 kademeden fazla çeşitlenmesin.

### B. Shell & navigasyon
- [ ] Sidebar/Topbar brand ile hizalı; aktif rota, badge (mesaj/kuyruk sayısı) tutarlı.
- [ ] Breadcrumb + sayfa başlığı tüm ana journey sayfalarında.
- [ ] Rol değişimi demo ise görsel olarak “Demo rol” chip’i ile belirtilsin.

### C. Sayfa bazlı polish (minimum)
- [ ] **Dashboard** (vet/expert/owner/admin): aksiyon-öncelikli; gereksiz chart/mock kart azaltılsın veya “demo” etiketlensin.
- [ ] **DicomUpload / NewCase:** adım göstergesi, drag-drop zone görsel kalitesi, hata/progress state.
- [ ] **Processing:** backend job vs local fiction net ayrımı + progress UI.
- [ ] **CaseDetail:** tab/panel düzeni sadeleştirilsin; AI disclaimer + provenance üstte sabit.
- [ ] **RadiologistWorkspace / ExpertReview:** sticky viewer (desktop), approve/reject görsel hiyerarşi, confirm modal.
- [ ] **Messages / Submissions:** konuşma/liste boş durumları, okunmamış vurgusu, mobil layout.
- [ ] **Landing / Login / Register:** app shell ile aynı kimlik; form validation görseli.

### D. States & a11y
- [ ] Loading skeleton; empty; error (retry CTA) — list/detail için standart.
- [ ] Focus-visible, kontrast, modal focus trap korunur / iyileşir.
- [ ] Touch target ≥ 44px kritik CTA’larda.

### E. Kalite kapısı
- [ ] `npm run typecheck && npm run build && npm run test` yeşil.
- [ ] Playwright smoke: login → upload/list → case detail (mevcut E2E kırılmasın).
- [ ] Kısa “before/after” ekran görüntüsü veya not (PR açıklamasında).

---

## Önerilen uygulama sırası

1. Token + primitive refactor (Button/Card/Input/Badge)  
2. Shell (Sidebar/Topbar/Layout) brand hizası  
3. Journey sayfaları (Upload → Processing → Detail → Review)  
4. Messages / Submissions / Payment polish  
5. Dashboard sadeleştirme + mock/fiction etiketleri  
6. Mobil geçiş (vet + owner kritik path)

---

## Out of scope

- Gerçek Vision/LLM bağlama (backend BOUNDARY)
- PACS-grade DICOM viewer / multi-monitor hanging protocol
- Tam design system ürünü (Storybook nice-to-have, zorunlu değil)
- Dark mode (ayrı issue olabilir)
- Backend API yeniden yazımı

---

## Referans dosyalar

- `src/App.tsx`, `src/components/{Layout,Sidebar,Topbar,Card,Button}.tsx`
- `src/pages/{Landing,Dashboard,DicomUpload,Processing,CaseDetail,RadiologistWorkspace,Messages,Submissions}.tsx`
- `src/lib/pipeline.ts` (fiction)
- `src/data/mock.ts`
- `docs/PHASE_13_PRODUCT_UX.md`
- `docs/HEDEF_MIMARI_GAP_ISSUE_LISTESI.md` → ISS-FE-01 / ISS-FE-02

---

## Not

Bu iş “renk değiştirmek” değil; **ürünün frontend yüzünü** demo iskeletinden **güven veren klinik UI** seviyesine çıkarmak. Backend hazırlık seviyesi FE algısını boğmamalı — tasarım dürüst provenance ile birlikte güzelleşmeli.
