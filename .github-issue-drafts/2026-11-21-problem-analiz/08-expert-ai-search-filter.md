## Türkçe (kolay dil)

**Başlık önerisi:** Expert AI sayfasında arama Enter’sız çalışmıyor; liste sayısı filtreyle uyuşmayabiliyor

### Ne oluyor?
1. Arama kutusu yazınca liste yenilenmiyor; Enter veya yenile lazım.
2. Sunucudan gelen satırlar bir de tarayıcıda “yeniden gönderilebilir durumlar” ile tekrar eleniyor — “tümü” / sayaç kafa karıştırır.

### Neden önemli?
Uzman vakayı bulamaz veya “35 vaka” derken ekranda daha az görür.

### Nerede?
- `src/pages/ExpertAiResend.tsx` — `useEffect([status, modality])` (q yok); `RESENDABLE_STATUSES` client filter

### Ne yapalım?
1. Arama için debounce’lu `load` veya net “ara” UX.
2. Client ikinci filtreyi kaldır veya sunucu filtresiyle hizala; sayaç = görünen.

### Bitti sayılır
- [ ] Arama beklenen şekilde sonuç getirir
- [ ] Sayaç ile satır sayısı tutarlı
- [ ] Status “tümü” davranışı belgelenmiş/net

---

## English (AI-agent optimized)

**Title:** Fix ExpertAiResend search (q) reload and double-filtering that skews case counts

### Problem
In `ExpertAiResend.tsx`:
1. `useEffect` reloads on `status`/`modality` only — `q` requires Enter or manual refresh.
2. After fetch, `display` re-filters with `RESENDABLE_STATUSES`, so UI count/list can disagree with API when status filter implies broader results.

### Acceptance criteria
1. Searching updates results via debounce (300–400ms) and/or explicit search control; document Enter behavior.
2. Single source of truth for “resendable” filtering (server query **or** client, not conflicting both); case count equals visible rows.
3. Add a small test or e2e assertion for filter+search consistency if feasible.

### Files
`src/pages/ExpertAiResend.tsx`, related worklist API query params if server-side search is used.
