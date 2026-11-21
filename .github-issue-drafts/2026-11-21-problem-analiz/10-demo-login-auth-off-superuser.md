## Türkçe (kolay dil)

**Başlık önerisi:** Giriş formu demo şifreyle dolu geliyor; auth kapalıyken API herkese süper yetki veriyor

### Ne oluyor?
1. **Giriş ekranı** e-posta/şifre alanlarını `vet@demo.local` / `demo1234` ile dolduruyor — yanlışlıkla gerçek ortama taşınırsa risk.
2. **Auth kapalıyken** (varsayılan) her istek `demo` rolü alıyor ve bu rol **tüm yetkilere** (`*`) sahip; klinik ayırma da yok.

### Neden önemli?
Demo rahatlığı “herkese açık admin API” ye dönüşüyor. Bitirme demosu için anlaşılır; dışarı açık sunucuda tehlikeli.

### Nerede?
- `src/pages/Login.tsx` — prefilled credentials
- `backend/app/auth/deps.py`, `rbac.py` — `via=disabled`, `demo` → `*`
- `backend/app/auth/tenancy.py` — disabled → her şeye erişim

### Ne yapalım?
1. Login’de alanları boş bırak; demo hesapları ayrı “Demo ile doldur” butonuyla.
2. Auth kapalıyken yıkıcı/admin uçlarını kapat **veya** sadece localhost; protected’ta auth zorunlu olsun (runtime).
3. Health dışındaki “açık kapı”yı net logla / uyar.

### Bitti sayılır
- [ ] Login varsayılanı boş (veya yalnız açık demo bayrağıyla dolu)
- [ ] Auth off + dış erişimde admin/training/retention kapalı veya fail-closed
- [ ] Dokümante edilmiş güvenli demo profili

---

## English (AI-agent optimized)

**Title:** Stop prefilling demo credentials; constrain auth-disabled “demo” principal with `*` capabilities

### Problem
1. Frontend `Login.tsx` initializes `email`/`password` to `vet@demo.local` / `demo1234`.
2. Backend when `auth_enabled=False`: every request is `AuthPrincipal(role="demo", via="disabled")`; `ROLE_CAPABILITIES["demo"]` includes `*`; tenancy short-circuits for `via=="disabled"`. Default deployment is effectively open admin API for anyone who can reach the host.

### Acceptance criteria
1. Login fields empty by default; optional “Fill demo account” control only when `deployment_mode=demo` / auth status says demo.
2. When auth is disabled: either (a) allow only a documented safe capability set (no training export apply retention admin), or (b) bind demo open mode to loopback / explicit `VETMIND_ALLOW_INSECURE_DEMO=1` with loud logs.
3. `deployment_mode=protected` must refuse to serve mutating/admin routes without real auth at request time (not only startup checklist).
4. Tests: default settings cannot call destructive admin capability without credentials; login UI has no prefilled secret in production/demo-safe build.

### Notes
Keep local bitirme demo DX — but make the dangerous path explicit, not the silent default.
