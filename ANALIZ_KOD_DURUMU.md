# VetMind AI — Kod Tabanlı Durum Analizi

> Kaynak: uygulama kodu (`backend/app`, `src`, `ml`, `evaluation`, `benchmarks`). Eski mimari/faz MD belgelerine dayanılmaz.  
> Tarih: 2026-11-06 · Dal: `main` @ `3aa9de2`

---

## 1. Tek cümlelik verdict

**Uçtan uca teleradyoloji demo ürünü çalışıyor** (yükle → sınıflandır → analiz → LLM taslak → uzman onay → PDF). **Klinik üretim sistemi değil:** varsayılan Vision mock, RAG/ödeme/AV/şifreleme iskelet veya simülasyon; auth kapalıyken herkes “demo” principal.

---

## 2. Ne var? (kodda gerçekten bağlı)

### Ürün akışı (frontend + API)

| Akış | Durum | Nerede |
|------|--------|--------|
| Roller: vet / expert / owner / clinic_owner / admin | UI gate + opsiyonel backend RBAC | `src/App.tsx`, `backend/app/auth/rbac.py` |
| DICOM upload, quarantine, metadata parse, confirm | Gerçek | `dicom/*`, `storage/quarantine.py`, `DicomUpload.tsx` |
| Async analyze (thread; RQ opsiyonel) | Gerçek | `workers/job_backend.py`, `Processing.tsx` |
| Rapor versiyonlama, approve / reject / revision | Gerçek | `report_versioning.py`, `RadiologistWorkspace.tsx` |
| PDF indirme | Gerçek | `pdf_report.py`, `ApprovedReport.tsx` |
| Case messaging + support threads | Gerçek API | `messaging_*`, `CaseMessaging.tsx`, `Messages.tsx` |
| Demo ödeme (submission öncesi) | Simüle | `payment_service.py`, `DemoPaymentStep.tsx` |
| Bildirimler, user settings | Gerçek | `notifications*`, `Settings.tsx` |
| Admin: kullanıcılar, radyolog payout, sistem durumu | Kısmen gerçek | `AdminUsers`, `AdminRadiologists`, `SystemStatus` |
| DICOM viewer (W/L, pan/zoom, measure, overlay, ≤96 frame) | Client-side gerçek | `DicomViewer.tsx` |
| TR/EN rota + i18n | Çalışıyor; bazı stringler hardcode | `i18n/*`, Sidebar/KB/ödeme |

### AI / altyapı katmanı

| Katman | Varsayılan | Swap-in |
|--------|------------|---------|
| **Vision** | `MockVision` (metadata-only senaryolar) | HTTP remote (`http_vision.py`) veya local Torch (`local_torch.py` + MONAI entrypoints) |
| **LLM** | `mock` | OpenAI-uyumlu / Ollama / Anthropic / Gemini — `llm/factory.py` |
| **Bu makinedeki `.env`** | Gemini LLM + `VETMIND_VLM_ENABLED=1` | Yüklenen görüntüler Gemini VLM’e gider; mock Vision `exclusive_real` ile elenir |
| **RAG** | Hash-embedding + JSON indeks veya lexical | Protokol hazır; gerçek embedding/vektör DB yok |
| **OCR** | PDF/metin extract; görüntü stub | HTTP OCR endpoint iskeleti |
| **Persistans** | SQLite (varsayılan) | memory / Postgres JSONB |
| **Auth** | Kapalı → `role=demo` | JWT + API key + RBAC; kullanıcılar hâlâ demo dizini |
| **Eval** | Offline paket (`evaluation/`, `benchmarks/`) | Runtime’a otomatik bağlı değil; admin “latest eval” dosya okur |

### Mimari güçler (korunmalı)

- Modular monolith: her şey `AppContainer`’da birleşiyor — adapter değiştirmek orchestrator’ı bozmuyor.
- Provenance bilinci: mock vs real ayrımı, health endpoint’te görünür.
- Protected mode dürüstlüğü: sahte encryption claim’i ile ayağa kalkmıyor; malware zorunluysa scanner yoksa fail-closed.
- Test yüzeyi geniş (`backend/tests` + Playwright e2e iskeleti).

---

## 3. Ne eksik? (öncelik sırasıyla)

### P0 — Ürün dürüstlüğü / bitirme demosu için kritik

1. **Vision hâlâ mock** — LLM gerçek olsa bile bulgular senaryo üretir; rapor “gerçek AI” gibi durabilir ama kaynak mock. Pixel opt-in + XR demo ağırlıkları veya remote vision şart.
2. **Auth varsayılan kapalı** — Frontend role gate UX; backend enforcement yok. Demo için OK, jüri/korumalı gösterimde `protected` + auth açılmalı.
3. **Register sunucuya kullanıcı yazmıyor** — Sadece `localStorage`; kullanıcı sanır ki hesap oluşturuldu (`Register.tsx`).
4. **Admin “Modüller” + dashboard GPU/deploy grafikleri** — `src/data/mock.ts` kozmetik; canlı health ile karışıyor.
5. **`markReportDelivered` API var, UI yok** — “Klinik teslim aldı” adımı yarım.

### P1 — Klinik değere yaklaşmak için

6. **Veteriner-doğrulanmış görüntü modeli yok** — XR entrypoint insan TorchXRayVision; MR/CT entrypoint’ler iskelet. `ml/` eğitim pipeline’ı runtime’a bağlı değil.
7. **RAG kalitesi düşük** — Hash embedding + küçük seed corpus; klinik KB yönetimi zayıf (admin UI hybrid/fallback).
8. **OCR yok** — Referans mektubu / laboratuvar PDF görselleri anlamlı metne dönmüyor.
9. **PACS / DICOMweb yok** — Sadece quarantine disk; klinik entegrasyon yok.
10. **Ölçüm / 3D / MPR yok** — Viewer 2D + frame limiti (96).

### P2 — Üretim / güvenlik

11. Encryption-at-rest implementasyonu yok (bilinçli red).
12. Gerçek malware scanner yok (Noop vs Unavailable).
13. Ödeme PSP yok (demo kart).
14. OIDC/SSO / gerçek kullanıcı dizini yok.
15. Postgres JSONB → normalize klinik şema yok.
16. RQ worker her job’da container rebuild — ölçek için bakılmalı.

### FE kalite borçları

- i18n delikleri: Sidebar (“Menü”), ödeme sihirbazı, KB önerileri, bazı messaging/hata stringleri.
- Founder rolü kodda yok (`Role` tipi 5 rol).
- Büyük vaka UI’ları (`CaseDetail`, `RadiologistWorkspace`) bakım maliyeti yüksek.

---

## 4. Ne yapabiliriz? (tartışma menüsü)

Aşağıdakiler “hepsini yapalım” listesi değil; **yön seçimi** için.

### A) Bitirme / jüri demosu güçlendir (1–2 hafta)

| İş | Neden |
|----|--------|
| Vision’ı görünür şekilde bağla (XR opt-in veya remote stub + UI’da REAL/MIXED banner) | “LLM yazıyor ama bulgular fake” eleştirisini keser |
| Auth `protected` + seed hesaplarla kilitli demo | Rol spoof / “herkese açık API” riskini kapatır |
| Register’ı ya kaldır ya da backend user create’e bağla | Güven kırığı |
| Mock dashboard/modülleri “örnek veri” diye etiketle veya kaldır | Ürün dürüstlüğü |
| Teslim (`markReportDelivered`) UI veya API’yi temizle | Workflow tamamlanmış hissi |
| i18n + kopya polish turu | Sunum kalitesi |

### B) AI derinleştir (araştırma değeri yüksek)

| İş | Swap-in noktası |
|----|-----------------|
| Veteriner toraks XR fine-tune / transfer (`ml/` → `artifacts/` → `backend:dev:vision`) | `local_torch` + entrypoints |
| MR/CT için en azından kaliteli mock→semi-real veya remote VLM | `http_vision` sözleşmesi |
| Gerçek embedding (sentence-transformers) + curated vet radiology corpus | `rag/embeddings.py`, `JsonVectorStore` |
| Classification + LLM eval’i CI’ya / Model Performance sayfasına düzenli bağla | `evaluation/` + `api/llm_feedback.py` |
| Expert feedback → dataset export → prompt/model iyileştirme döngüsü | `feedback/`, `llm/feedback.py` |

### C) Ürün / iş modeli iskeleti

| İş | Not |
|----|-----|
| Clinic_owner lisans / personel yönetimi (founder branch’te izler var, main’de rol yok) | Ürün hikâyesi |
| Gerçek ödeme entegrasyonu (iyzico/Stripe sandbox) | Demo karttan çıkış |
| SLA / kuyruk önceliği UI’ını güçlendir | `review_sla.py` var |
| Owner portal: pet timeline + onaylı rapor paylaşımı | OwnerPets + ReportList genişletme |

### D) Bilinçli olarak şimdi yapmayalım

- PACS, KMS encryption, ClamAV, Celery/K8s, OAuth IdP — mimari kapılar hazır; bitirme kapsamını şişirir.
- “Klinik CE/FDA validasyon” — kodla çözülmez; eval framework (`evaluation/`) bunun için zemin, ürün iddiası değil.

---

## 5. Önerilen odak (tartışma başlangıç noktası)

**Öneri:** Bitirme hedefi = **A (dürüst demo) + B’den tek bir AI kanıtı** (ör. XR real + Gemini LLM + Model Performance ekranında ölçüm).

```
Bugün:   [DICOM] → [Mock Vision] → [Gemini LLM] → [Uzman] → [PDF]
Hedef:   [DICOM] → [XR Real / etiketi açık] → [Gemini + RAG] → [Uzman + feedback] → [PDF + teslim]
```

Karar soruları:

1. Jüriye **Vision’ı da gerçek** mi göstereceğiz, yoksa “LLM karar destek + mock bulgu” dürüst mü anlatılacak?
2. Auth kapalı demo mu, korumalı hesaplı demo mu?
3. Son sprint’te öncelik **UI polish** mi, **model/eval** mi, **iş akışı (ödeme/teslim)** mı?

---

## 6. Hızlı dosya haritası (inceleme için)

```
backend/app/container.py      # tüm bağımlılık birleşimi
backend/app/orchestration/    # vision → fusion → LLM → validate
backend/app/models/           # mock | http | local_torch
backend/app/llm/              # gateway, prompts, grounding, chat
backend/app/auth/             # RBAC, tenancy, demo users
src/App.tsx                   # rotalar + Gate
src/lib/backend.ts            # tek API client
src/pages/*                   # rol bazlı ekranlar
src/data/mock.ts              # kozmetik / seed veri (dikkat)
evaluation/ + benchmarks/     # offline klinik metrik iskeleti
ml/                           # eğitim; runtime import etmez
```

---

## 7. Sonraki adım

Bu dosyayı birlikte okuyup **A / B / C**den bir sprint paketi seçelim. Seçim netleşince görevleri issue’lara veya küçük PR’lara bölebiliriz.
