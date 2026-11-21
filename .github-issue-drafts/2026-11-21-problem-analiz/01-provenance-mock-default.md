## Türkçe (kolay dil)

**Başlık önerisi:** Uzman ekranında kaynak bilgisi yoksa “sahte/demo” yazıyor — bu yanıltıcı

### Ne oluyor?
Uzman çalışma ekranında analizin gerçek mi yoksa demo/sahte mi olduğunu gösteren etikette, sunucu “kaynak türü” göndermezse sistem otomatik **mock (sahte)** yazıyor.

### Neden önemli?
Uzman gerçek bir modeli “demo” sanabilir veya tersine güven yanlış yerde oluşur. Klinik karar destek ekranında etiket yanlış olmamalı.

### Nerede?
- `src/pages/RadiologistWorkspace.tsx` — `source_kind || 'mock'`

### Ne yapalım?
1. Kaynak yoksa “mock” deme; **“bilinmiyor / doğrulanmadı”** göster.
2. Banner ve bulgular paneli aynı kuralı kullansın.
3. Eksik provenance için kısa bir uyarı metni ekle.

### Bitti sayılır
- [ ] `source_kind` boşken UI “mock/demo” iddiası yapmıyor
- [ ] Bilinmeyen durum ayrı, net bir etiket
- [ ] Gerçek `source_kind` geldiğinde doğru banner

---

## English (AI-agent optimized)

**Title:** Do not default missing analysis provenance to `mock` in RadiologistWorkspace

### Problem
In `RadiologistWorkspace.tsx`, when `backendFindings.source_kind` and `backendDraft.generation.source_kind` are absent, the UI falls back to `'mock'` for `ProvenanceBanner` and `AIFindingsPanel` (`analysisMode`). Missing provenance is treated as definitive mock/demo, which can mislabel real or mixed analyses.

### Evidence
```ts
c.backendFindings?.source_kind || c.backendDraft?.generation?.source_kind || 'mock'
```

### Acceptance criteria
1. Replace `'mock'` default with an explicit unknown/unverified provenance state (e.g. `unknown`) that does **not** claim mock or real.
2. `ProvenanceBanner` + `AIFindingsPanel` share one helper for provenance resolution.
3. Add a compact warning when provenance is missing.
4. Unit/UI test: missing `source_kind` ⇒ not labeled as mock/demo; present `real`/`mixed` still maps correctly.

### Out of scope
Changing backend generation of `source_kind` (may be follow-up).
