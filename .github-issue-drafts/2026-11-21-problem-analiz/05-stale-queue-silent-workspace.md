## Türkçe (kolay dil)

**Başlık önerisi:** İnceleme listesi API düşünce eski veriyi gösteriyor; çalışma alanında hatalar gizleniyor

### Ne oluyor?
1. **İnceleme kuyruğu:** Sunucu listesi gelmezse ekran eski yerel vakaları gösteriyor; “bu eski veri” net değil.
2. **Uzman çalışma alanı:** Rapor sürümleri / yan liste / önceki raporlar hata verince sessizce boş liste — uzman “hiç yok” sanıyor.

### Neden önemli?
Yanlış iş listesi veya “geçmiş yok” yanılgısı klinik iş akışını bozar.

### Nerede?
- `src/pages/ReviewQueue.tsx` — `localFallback`
- `src/pages/RadiologistWorkspace.tsx` — `.catch(() => set…([]))`

### Ne yapalım?
1. Hata durumunda stale fallback’i ya kaldır ya da kırmızı/amber “eski veri” bandı koy.
2. Workspace’te toast + boş durum ayır (hata vs gerçekten boş).
3. Mümkünse `toastErrorBody` kullan.

### Bitti sayılır
- [ ] API hatası ≠ sessiz boş başarı
- [ ] Kullanıcı stale / error’ı ayırt edebiliyor
- [ ] EN/TR toast metinleri i18n’den

---

## English (AI-agent optimized)

**Title:** Surface worklist/workspace API failures — stop silent empty arrays and opaque stale fallback

### Problem
1. `ReviewQueue.tsx` falls back to `AppContext.cases` filtered to `uzman_incelemesinde` when the worklist API errors — stale data presented as the queue.
2. `RadiologistWorkspace.tsx` uses `.catch(() => setVersions([])|setWorklist([]))` for versions/worklist/priors — failures look like “no data”.

### Acceptance criteria
1. ReviewQueue: on API error, show explicit error state; if showing cached local cases, banner must say data may be stale/offline.
2. Workspace: on list/version fetch failure, toast via `toastErrorBody` / i18n and distinguish empty vs error UI.
3. No silent swallow of network/4xx/5xx for these loads.
4. Manual check: kill backend → user sees error, not a convincing empty history.
