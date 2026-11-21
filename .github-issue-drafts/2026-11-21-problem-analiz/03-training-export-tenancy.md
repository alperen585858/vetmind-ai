## Türkçe (kolay dil)

**Başlık önerisi:** Eğitim verisi dışa aktarma başka kliniklerin vakalarını da alabiliyor

### Ne oluyor?
“Training export” (eğitim için veri indirme) uç noktası vakaları doğrudan depodan çekiyor. Klinik / sahip erişim kontrolü (`assert_case_access`) yok. Uzman rolü başka kliniğin onaylı notlarını da indirebilir.

### Neden önemli?
Hasta/klinik verisi karışır; KVKK ve çok kiracılı güvenlik bozulur.

### Nerede?
- `backend/app/api/training_export.py` — `repo.get_case` / `list_cases` döngüsü

### Ne yapalım?
1. Her vaka için erişim kontrolü uygula.
2. `list_cases` yerine kullanıcının görebileceği vakalar.
3. Cross-tenant test ekle.

### Bitti sayılır
- [ ] Başka klinik case_id ile export → 403 / atlanır
- [ ] Export yalnız yetkili vakaları içerir
- [ ] Pytest cross-tenant senaryosu yeşil

---

## English (AI-agent optimized)

**Title:** Training export API must enforce case/tenant ACL (no raw `list_cases` dump)

### Problem
`POST` training export in `backend/app/api/training_export.py` loads cases via `repo.get_case(cid)` / `repo.list_cases()` without `assert_case_access` / tenancy filters. An expert with `CAP_TRAINING_VERIFY` can export verified annotations across clinics when auth+isolation are on (and everything when auth is off).

### Acceptance criteria
1. Filter every exported case with the same access rules as case GET (clinic/owner/expert scope).
2. Unknown or unauthorized `case_ids` are skipped or 403 — never silently included.
3. Default export without `case_ids` only iterates accessible cases, not global `list_cases()`.
4. Pytest: expert clinic A cannot export clinic B case; admin/global behavior documented.

### Related
PHI scrub for `patient_name` already exists — keep it; this issue is ACL, not scrubbing.
