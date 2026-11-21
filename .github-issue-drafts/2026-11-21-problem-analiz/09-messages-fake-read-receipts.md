## Türkçe (kolay dil)

**Başlık önerisi:** Mesajlarda “okundu” gibi çift tik var ama gerçek okundu bilgisi yok

### Ne oluyor?
Gönderdiğin her mesajın yanında çift tik (`CheckCheck`) çıkıyor. Bu WhatsApp’taki “iletilidi/okundu” gibi duruyor ama arka planda okundu durumu tutulmuyor — hep basılıyor.

### Neden önemli?
Kullanıcı karşı tarafın okuduğunu sanır; güven ve iletişim hatası.

### Nerede?
- `src/pages/Messages.tsx` — `mine && <CheckCheck …>`

### Ne yapalım?
1. Ya tikleri kaldır / sadece “gönderildi” saati bırak.
2. Ya gerçek `read_at` / delivered alanı ekle (backend + UI).

### Bitti sayılır
- [ ] Sahte okundu affordanı yok **veya** gerçek read state’e bağlı
- [ ] Kısa UX notu (gönderildi vs okundu)

---

## English (AI-agent optimized)

**Title:** Remove fake WhatsApp-style read receipts in Messages (or wire real read state)

### Problem
`Messages.tsx` renders `<CheckCheck>` on every outbound (`mine`) message. There is no backend-driven delivered/read flag — the icon implies read receipts that do not exist.

### Acceptance criteria
**Option A (preferred short-term):** Remove `CheckCheck`; keep timestamp only.  
**Option B:** Persist `delivered_at`/`read_at` (or equivalent) and render checks only from that state.

1. No UI element that looks like read-receipt without data.
2. If Option B: API contract + migration + UI binding + test.
3. Document compose rules (`canCompose = isOwner`) separately if changing later — out of scope unless needed.
