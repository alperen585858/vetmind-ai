# VetMind AI — Kod tabanlı problem analizi (21 Kasım 2026)

Bu belge **README / docs’a güvenmeden** `src/` ve `backend/app/` okunarak çıkarıldı. Amaç: ürünün “demo GO / klinik NO-GO” durumunu somut teknik borç ve risklerle bağlamak.

---

## 1. Genel tablo (kısa)

| Alan | Durum | Özet |
|------|--------|------|
| Demo ürün akışı | Çalışır | Vaka, inceleme, AI yeniden gönder, mesajlaşma uçtan uca var |
| Güvenlik varsayılanı | Açık kapı | Auth kapalıyken `demo` rolü `*` yetki; tenant izolasyonu yok |
| Protected mode | Yarım | Malware zorunlu ama tarayıcı stub → yükleme fiilen kırık |
| Klinik dürüstlük (UI) | Kırılgan | Eksik provenance → “mock” varsayımı; sessiz API hataları |
| Çok dil | Yarım | EN seçilince birçok toast/modal/tür hâlâ Türkçe |
| Görsel dil | Bölünmüş | Expert AI sayfası açık klinik; Mesajlar / Vaka listesi hâlâ “AI glow” |

---

## 2. Mimari gözlemler (koddan)

1. **Modular monolith** doğru kurulmuş: `AppContainer`, router’lar ince, adapter sınırları net.
2. **Auth iki dünya**: JWT açıkken ciddi RBAC testleri var; kapalıyken (varsayılan) tüm kapılar bypass.
3. **Frontend “dürüstlük” katmanı zayıf**: `source_kind` yoksa mock; worklist düşerse eski local cache; workspace’te `.catch(() => [])`.
4. **Domain modeli TR’ye gömülü**: `Priority` / `Severity` tip değerleri Türkçe string (`Acil`, `Yüksek`) → i18n ve API eşlemesi sürekli kırılgan.
5. **Tasarım drift**: ExpertAiResend beyaz klinik ray’a çekildi; Messages / CaseList / ReviewQueue midnight + radial teal’de kaldı.

---

## 3. Backend — öncelikli sorunlar

### B1. Auth kapalı = tam yetki (P0)
- `auth/deps.py`: `auth.enabled` false → `role="demo"`, `via="disabled"`.
- `rbac.py`: `demo` → `*`.
- Sonuç: admin retention, training export, kullanıcı reset vb. kimlik olmadan.

### B2. Protected malware stub (P0)
- `malware_scan.py`: `required=True` → `UnavailableScanner` her zaman `clean=False`.
- Protected açılınca DICOM yükleme pratikte ölür; operatör flag’i kapatıp korumasız kalabilir.

### B3. Training export tenant kontrolü yok (P1)
- `api/training_export.py`: `repo.get_case` / `list_cases` — `assert_case_access` yok.
- Expert başka kliniğin anotasyonunu JSONL’e dökebilir.

### B4. Public rapor linki yanlış sürüm (P1)
- `api/report_links.py`: token sürümü bulunamazsa **herhangi** onaylı immutable draft’a düşüyor.
- Sahip e-postasındaki “sürüm N” farklı metin görebilir.

### B5. `consume=false` sınırsız okuma (P1)
- Aynı public token TTL dolana kadar tekrar tekrar rapor okur; rate limit yok.

### B6. Görünürlük: radyolog alanları (P1)
- `visibility.py`: JWT değilse `can_see_radiologist_fields` → True.
- Auth off / API key ile `internal_notes` / `ai_chat` sızabilir.

### B7. RQ + SQLite yazım yarışı (P2)
- `CaseService` kilidi process-local; RQ ayrı process → case JSON overwrite riski.

### B8. Demo header sahteciliği (P2)
- `X-VetMind-Demo-Role/Subject` auth off iken kimlik uydurur.

---

## 4. Frontend — öncelikli sorunlar

### F1. Provenance eksikse “mock” (klinik risk)
- `RadiologistWorkspace.tsx`: `source_kind || 'mock'` → gerçek analiz DEMO gibi etiketlenir (veya tersi kafa karışıklığı).

### F2. ReviewQueue stale fallback
- API hata verince `AppContext.cases` ile eski liste; “sunucu mu local mi?” net değil.

### F3. Workspace sessiz hata
- Versiyon / worklist / prior: `.catch(() => set([]))` — uzman “yok” sanır.

### F4. CaseList i18n deliği
- Sync toast, silme modalı, tür filtreleri hardcoded TR.

### F5. ExpertAiResend arama / filtre
- `q` Enter’sız `load` tetiklemez; client `RESENDABLE_STATUSES` ile API sonucu yeniden kırpılır.

### F6. Messages sahte “okundu”
- Her giden mesajda `CheckCheck` — backend read state yok.

### F7. Login demo doldurulmuş
- `vet@demo.local` / `demo1234` varsayılan state — shared/protected ortamda risk.

### F8. Tasarım tutarsızlığı
- Messages / CaseList / ReviewQueue hâlâ AI glow; ExpertAiResend klinik light.

### F9. Shell i18n / a11y
- Sidebar `"Menü"`, Layout `"İçeriğe atla"` locale dinlemiyor.

### F10. regionLabel TR sabit
- `caseMapper.ts` EN locale’de de “Servikal / Beyin”.

---

## 5. Test boşlukları (kod taraması)

- Protected mode + gerçek upload path’i test edilmiyor (sadece env validate).
- Training export için cross-tenant test yok.
- RQ + SQLite concurrent case write yok.
- Default `auth_enabled=False` ile destructive admin route engeli yok.

---

## 6. Önerilen 10 issue (bu klasördeki dosyalar)

| # | Konu | Öncelik |
|---|------|---------|
| 01 | Provenance eksikse mock varsayma | Yüksek |
| 02 | Protected malware stub / upload kırığı | Yüksek |
| 03 | Training export klinik/tenant filtresi | Yüksek |
| 04 | Public rapor linki yanlış sürüm fallback | Yüksek |
| 05 | İnceleme kuyruğu + workspace sessiz/stale hata | Orta |
| 06 | CaseList ve shell i18n (EN kırık) | Orta |
| 07 | Mesajlar / vaka listesi AI glow → klinik UI | Orta |
| 08 | Expert AI arama-filtre tutarsızlığı | Orta |
| 09 | Mesajlarda sahte okundu tikleri | Düşük-Orta |
| 10 | Login demo doldurma + auth-off süper yetki netleştirme | Yüksek |

Her issue dosyasında: **Türkçe (kolay)** + **English (AI-agent optimized)** bölümleri var.
