## Türkçe (kolay dil)

**Başlık önerisi:** Mesajlar ve vaka listesi hâlâ “yapay zekâ ışıltılı” koyu panel; Expert AI sayfası klinik beyaza geçti — birleştir

### Ne oluyor?
Expert “AI’ya tekrar yolla” sayfası açık/klinik beyaz listeye alındı. Ama **Mesajlar**, **Vaka listesi**, **İnceleme kuyruğu** hâlâ koyu gece mavisi + teal/cyan ışık geçişleri kullanıyor. Aynı üründe iki dil: “AI oyuncağı” vs “klinik yazılım”.

### Neden önemli?
Marka ve güven duygusu parçalanıyor; kullanıcı “AI hissi” şikâyeti buradan geliyor.

### Nerede?
- `src/pages/Messages.tsx` — midnight rail + radial teal/sky
- `src/pages/CaseList.tsx`, `ReviewQueue.tsx` — midnight hero + teal radial
- Referans: `src/pages/ExpertAiResend.tsx` (beyaz / slate klinik)

### Ne yapalım?
1. Messages sol rayını ExpertAiResend klinik diline çek (glow yok, flat white/slate).
2. CaseList / ReviewQueue hero’dan radial teal’i kaldır; sade klinik başlık.
3. Ortak küçük stil kalıbı (rail/header) mümkünse paylaş.

### Bitti sayılır
- [ ] Messages’ta radial teal/cyan overlay yok
- [ ] CaseList/ReviewQueue “AI glow” hero yok
- [ ] Expert rolünde sayfalar aynı klinik dilde

---

## English (AI-agent optimized)

**Title:** Align Messages / CaseList / ReviewQueue chrome with clinical ExpertAiResend (remove midnight+teal AI glow)

### Problem
`ExpertAiResend` was redesigned to a flat white/slate clinical split view. `Messages.tsx` still uses `bg-[color:var(--vm-midnight)]` plus dual radial teal/sky overlays. `CaseList` / `ReviewQueue` still use midnight heroes with teal radial washes. Visual language is inconsistent and reads as “AI product chrome.”

### Acceptance criteria
1. Messages conversation rail: flat clinical (white/slate or flat navy without radial teal/cyan gradients); selected row matte, not neon teal gradient.
2. CaseList + ReviewQueue: remove decorative teal radial overlays; keep hierarchy with typography/spacing, not glow.
3. No new purple/glow aesthetics; match ExpertAiResend restraint.
4. Screenshot checklist for expert role: AI Resend, Messages, Cases, Review queue look like one product.
