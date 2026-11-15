# VetMind — Kod Tabanlı Eksik Analizi

**Tarih:** 15 Kasım 2026 (güncelleme: aynı gün — uygulanabilir kapılar kapatıldı)  
**Kapsam:** Mevcut `main` kodu (`src/`, `backend/app/`, `e2e/`, CI, Docker). Eski durum/mimari Markdown dosyalarına bakılmadan hazırlandı.  
**Amaç:** Ürün / mühendislik eksiklerini kanıtlı (dosya + sembol) listelemek; klinik üretime geçmeden önce öncelik vermek.

### Bu oturumda kapatılanlar (kod)
- Demo-only API kapısı: `/dicom/demo/*`, `/dicom/fixtures/*`, `/payments/*` → `deployment_mode=protected` iken **403** (`require_demo_deployment`)
- Protected’ta SMTP yokken şifre sıfırlama token’ı **üretilmiyor** (`smtp_required` audit)
- Klinik modül: `clinicalModuleFromStudy` (Toraks / Nöroloji / Genel) — hardcode `Nöroloji` kaldırıldı
- `clinic_owner` menüsüne **Onaylı raporlar**
- Onay modalında kanıt görseli checklist uyarısı
- `CaseMessaging` i18n (TR/EN); `DicomUpload` / `NewCase` kritik form etiketleri i18n
- Vet → Messages Gate + `CAP_MESSAGES` (RBAC)
- Protected varsayılan: self-registration **kapalı**; demo klinik id ile self-reg → startup fail
- Opsiyonel Redis rate limiter (`build_rate_limiter` + `/health.rate_limit_backend`)
- `/health` dürüstlük alanları: `smtp_configured`, `demo_apis_enabled`, `self_registration_enabled`, `vlm_enabled`, `llm_provider`
- Fiction demotion: Dashboard `GpuChart` placeholder; SystemStatus `DEPLOYMENTS` tablosu kaldırıldı
- `docker-compose.protected.example.yml`
- CI: `npm run check:bundle`
- Testler: `test_demo_deployment_gates.py`, protected self-reg + Redis fallback (`test_auth_rate_limit.py`)

### Hâlâ dış bağımlılık / ürün kararı gerektirenler
- Gerçek PSP (Stripe/iyzico), gerçek malware scanner, S3 quarantine, ikinci klinik modül ürünleştirme, SMTP kurulumu, VLM/LLM prod anahtarları, canlı GPU/deploy telemetrisi API’si

---

## 1. Özet karar

VetMind, **nöroloji odaklı demo + yazılım hazırlık** seviyesinde güçlü bir iskelet: vaka yaşam döngüsü, DICOM karantina, VLM/LLM eklenebilirliği, uzman workspace, onaylı rapor/PDF, E2E/CI var.

Klinik / ticari üretime göre kritik boşluklar:

| Alan | Durum (kod) |
|------|-------------|
| Auth varsayılanı | Kapalı (`VETMIND_AUTH_ENABLED` → `False`) |
| LLM varsayılanı | `mock` |
| VLM | Kapalı; gerçek provider şart |
| Ödeme | Demo kart doğrulama (PSP yok) |
| Klinik modüller | Yalnızca Nöroloji “Aktif”; diğerleri UI kartı |
| Postgres | JSONB belge deposu; ilişkisel klinik şema değil |
| E-posta | SMTP yoksa reset linki sunucu loguna yazılıyor |

---

## 2. Mimari fotoğraf (koddan)

```
Vite/React (src/)  →  FastAPI (backend/app/)  →  SQLite | memory | Postgres(JSONB)
       │                      │
       │                      ├─ DICOM quarantine + ingest
       │                      ├─ Vision adapters (mock / HTTP / local torch / VLM)
       │                      ├─ LLM gateway (mock | openai-compatible | …)
       │                      ├─ RAG (lexical | embedding)
       │                      └─ Jobs: thread | RQ(+Redis)
       └─ Playwright E2E + Vitest + pytest CI
```

**Roller (FE `Role`):** `vet` | `expert` | `owner` | `clinic_owner` | `admin`  
**Backend RBAC ek:** `demo`, `service` (`backend/app/auth/rbac.py`)

---

## 3. Öncelikli eksikler (P0 / P1 / P2)

### P0 — Güvenlik & üretim varsayılanları

| # | Eksik | Kanıt | Etki | Yön |
|---|--------|-------|------|-----|
| P0.1 | Auth varsayılan kapalı | `backend/app/settings.py` → `auth_enabled: bool = False`; `docker-compose.yml` → `VETMIND_AUTH_ENABLED:-0` | API’ye kimlik doğrulamasız erişim riski (deploy unutkanlığı) | Prod compose/env’de zorunlu `1`; startup’ta prod modunda auth=0 ise fail-fast |
| P0.2 | Sabit demo JWT secret | `backend/app/auth/security.py` → `DEFAULT_JWT_SECRET = "vetmind-demo-secret-change-me"`; compose aynı default | Token forge | Secret boşsa / default ise process start reddi |
| P0.3 | Şifre sıfırlama linki log’a düşüyor | `backend/app/auth/mailer.py` (`LogMailer`); `settings.smtp_host` default `None` | Reset token sızıntısı (log aggregator) | Prod’da SMTP zorunlu; LogMailer sadece `deployment_mode=demo` |
| P0.4 | Malware tarama no-op | `backend/app/storage/malware_scan.py` — “Always reports clean” | Zararlı upload’a kör | Gerçek scanner bağla veya quarantine + manuel gate |
| P0.5 | Demo ödeme gerçek PSP değil | `DemoPaymentStep.tsx`, `payments.py` `confirm-demo`, `payment_service.py` sabit demo kart | Sahte “ödeme tamam” hissi; muhasebe yok | Stripe/iyzico adapter + sandbox; UI’da DEMO rozeti zorunlu kalsın |

### P1 — Ürün kapsamı & klinik dürüstlük

| # | Eksik | Kanıt | Etki | Yön |
|---|--------|-------|------|-----|
| P1.1 | Tek aktif klinik modül | `src/data/mock.ts` `MODULES` (4× Planlanıyor); `Modules.tsx` salt kart | Kardiyoloji/ortopedi vb. yok | Modül registry + routing; veya UI’dan “plan”ı ayır |
| P1.2 | ~~Her vaka hardcode Nöroloji~~ | ~~`module: 'Nöroloji'`~~ → `clinicalModuleFromStudy` | Kapatıldı | — |
| P1.3 | LLM default mock | `settings.llm_provider = "mock"` | “AI rapor” çoğu kurulumda şablon | Ops runbook + readiness UI’da kırmızı/yeşil net |
| P1.4 | VLM kapalı + pixel opt-in deny | `vlm_enabled=False`, `pixel_analysis_opt_in=False`, `vision_transmit_pixels=False` | Gerçek görüntü analizi bilinçli kapalı | Klinik deploy checklist; feature flag paneli |
| P1.5 | Onay ≠ klinik sertifikasyon | `report_versioning.freeze_approved` → `clinically_validated = False` | Doğru dürüstlük; ürün dili karışabilir | UI’da “klinik sertifikasyon yok” sürekli görünür |
| P1.6 | Kanıt fotoğrafları kolay kaçıyor | Onay modalında checklist uyarısı eklendi; zorunlu gate hâlâ soft | Boş “Rapor görselleri” riski azalır | İstenirse hard-block |
| P1.7 | Self-register → demo klinik | Protected’ta self-reg default off + demo clinic fail-fast | Demo tenancy hâlâ demo modunda | Invite / gerçek klinik seçimi |
| P1.8 | Rate limit process-içi | ~~yalnızca memory~~ → opsiyonel `RedisRateLimiter` (`VETMIND_REDIS_URL`) | Redis yoksa memory fallback | Prod’da Redis URL zorunlu profil |

### P2 — UX / tutarlılık / operasyon

| # | Eksik | Kanıt | Etki | Yön |
|---|--------|-------|------|-----|
| P2.1 | Admin SystemStatus mock servisler | `DEPLOYMENTS` kaldırıldı; `SERVICES` hâlâ TEMSİLÎ şeritli; `/health` genişletildi | SERVİCES hâlâ illustrative | Gerçek dependency probe |
| P2.2 | Knowledge Base seed + mock etiket | `KnowledgeBase.tsx` ← `getKbSources` | Demo içerik / lisans karmaşası | Yalnızca API corpus; seed’i ayır |
| P2.3 | Dashboard GPU/deployment mock | Sahte GPU eğrisi → placeholder; deployment listesi SystemStatus’tan çıkarıldı | Canlı GPU API yok | Telemetri bağlanınca doldur |
| P2.4 | i18n delikleri | CaseMessaging + DicomUpload klinik panel + NewCase hasta/klinik adımları `t()` | Neuro form / payment hâlâ TR ağırlıklı | Kalan hardcoded satırlar |
| P2.5 | clinic_owner ince yüzey | Onaylı raporlar menüde | Mesaj / kullanıcı yönetimi sınırlı | Nav netleştir |
| P2.6 | Vet mesajlaşması yok | Gate + `CAP_MESSAGES` vet için açıldı | Inbox UX ürünleştirme | — |
| P2.7 | Postgres “tam DB” değil | `postgres_repository.py` docstring: JSONB document store | SQL analitiği / FK / migration zayıf | İhtiyaç varsa normalize şema + Alembic |
| P2.8 | Job default thread | `job_backend: "thread"` | Process ölçeği yok | Prod’da RQ + Redis zorunlu profil |
| P2.9 | VHS neuro üründe | `DicomViewer` `vhsEnabled`; `lib/vhs.ts` | Toraks XR aracı; modül nöroloji | Modality/region gate + rapor bölümüne bağlama |
| P2.10 | RAG corpus sınırlı | `backend/app/rag/corpus.py` (~238 satır) + `breed_morphotypes.json` | Atıf kalitesi düşük | Lisanslı KB ingest pipeline |

---

## 4. Rol bazlı boşluklar

### 4.1 Veteriner (`vet`)
- **Var:** DICOM yükleme, yeni vaka, iş listesi, başvurular, onaylı rapor listesi, Messages Gate + `CAP_MESSAGES`.
- **Eksik:** Ödeme akışı demo; gerçek faturalama/entiye entegrasyonu yok.
- **Kanıt:** `App.tsx` Gate; `Sidebar` vet menüsü; `DemoPaymentStep.tsx`.

### 4.2 Uzman radyolog (`expert`)
- **Var:** Kuyruk, workspace, AI tekrar, AI dersleri, onay/revizyon, VHS, kanıt kabul/PDF’e ekle, onay sonrası foto ekle.
- **Eksik:** Atama/SLA ürünleşmesi sınırlı; `ExpertWorklistTable` var ama klinik kapasite/takvim yok.
- **Eksik:** Training verify (`CAP_TRAINING_VERIFY`) UI keşfedilebilirliği zayıf olabilir (API var: `training_export`).
- **Kanıt:** `rbac.py`, `api/training_export.py`, workspace.

### 4.3 Pet sahibi (`owner`)
- **Var:** Hayvanlar, görüntüleme başvurusu, mesajlar, raporlarım.
- **Eksik:** Ödeme demo; SMTP yoksa şifre/akış e-postasız.
- **Eksik:** Başvuru → klinik routing sabit demo klinik.

### 4.4 Klinik sahibi (`clinic_owner`)
- **Var:** Dashboard, vakalar, başvurular, onaylı raporlar (nav); RBAC’te `clinic:manage` + sınırlı DICOM okuma.
- **Eksik:** Kullanıcı yönetimi UI / mesaj yüzeyi sınırlı olabilir.
- **Eksik:** Vet yazma yetkileri yok (`cases:write` clinic_owner’da yok) — bilinçli ama “klinik admin” beklentisiyle çatışabilir.
- **Kanıt:** `Sidebar.tsx` `clinic_owner`; `rbac.py`.

### 4.5 Admin
- **Var:** Kullanıcılar, radyolog ödemeleri (ledger), modüller (kart), KB, sistem, model performansı.
- **Eksik:** Modüller/SystemStatus büyük ölçüde fiction/mock.
- **Eksik:** Founder/lisans rolü FE `Role` tipinde yok (yalnızca 5 rol).

---

## 5. AI pipeline eksikleri

### 5.1 Vision / VLM
- Adapter ailesi: mock, remote HTTP, local torch, OpenAI-compatible VLM (`vlm_vision.py`).
- VLM gerçek provider ister; mock ile açılmaz (`VETMIND_VLM_ENABLED` + mock → hata).
- Çalışma zamanı bütçesi: `vlm_max_images`, `vlm_max_total_frames` — büyük MR çalışmalarında örnekleme; coverage honesty var ama kullanıcı “tüm kesitler bakıldı” sanabilir.
- Ontology / alias / conflict hardening mevcut; model uydurma kodları hâlâ bakım gerektirir.

### 5.2 LLM rapor
- Gateway: provider hata sonrası **mock’a sessiz düşmez** (iyi).
- Default mock → çoğu local/docker kurulumunda şablon rapor.
- `llm_verify` citation geçişi opsiyonel ekstra çağrı.
- Dil: `llm_report_language` tr|en.

### 5.3 RAG
- Backend seçilebilir: lexical | embedding.
- Corpus küçük / demo ağırlıklı; admin KB UI seed’lerle karışık.
- Klinik kaynak lisansı ve sürümleme ürünleşmemiş.

### 5.4 Orkestrasyon
- Capability route + mock scenario + REAL/MOCK execution policy (`orchestrator.py`).
- Job: thread (default) veya RQ; Redis opsiyonel.
- Analiz coverage / skipped files PDF’ten çıkarıldı (onaylı sayfa parity) — teknik teşhis UI’da CaseDetail’de kalmalı.

---

## 6. Veri & depolama eksikleri

| Konu | Kod | Boşluk |
|------|-----|--------|
| Case store | memory / sqlite / postgres JSONB | İlişkisel klinik model, migration framework yok |
| Quarantine | lokal disk `quarantine_root` | Object storage (S3) yok; çok instance paylaşımı yok |
| Evidence | working + `_report_evidence` paket | TTL/cleanup vs immutable paket ayrımı var; ops runbook zayıf |
| Soft-delete | `hidden_for` / onaylıda hide | Gerçek silme vs KVKK unutulma talebi net değil |
| Audit | event emit noktaları | Merkezi SIEM/export ürün ekranı yok |
| Users/settings/payments/messages | ayrı SQLite store’lar | Son dönemde kilit iyileştirmeleri var; dağıtık tek DB değil |

---

## 7. Frontend yüzey eksikleri

### 7.1 Mock / fiction bağımlılığı (kaldırılmalı veya şeritlenmeli)
- `Modules.tsx` → `MODULES` (TEMSİLÎ şerit var)
- `SystemStatus.tsx` → `SERVICES` (şeritli); ~~`DEPLOYMENTS`~~ kaldırıldı
- `Dashboard.tsx` → ~~`GPU_SERIES` eğrisi~~ placeholder; deployment fiction demoted
- `KnowledgeBase.tsx` → `getKbSources` seed
- `NewCase.tsx` / `Processing.tsx` / `DicomUpload.tsx` → `CLINIC` mock
- `DemoPaymentStep.tsx` → demo kart

### 7.2 Raporlar
- Onaylı liste: arama, kategori (bölge), modalite, tür, teslimat, toplu silme — mevcut.
- PDF ↔ ekran parity yakın zamanda hizalandı; baskı (`window.print`) ile sunucu PDF hâlâ iki yol.
- VHS skorunun onaylı rapor bölümüne otomatik yazımı net ürün kuralı olarak kodda zayıf bağlanmış olabilir (viewer’da “rapora ekle” callback’e bağlı).

### 7.3 Viewer
- WW/WL, pan, zoom, measure, angle, ROI, annotate, VHS.
- Overlay tıklama koordinat düzeltmeleri yakın commit’lerde.
- Eksik: tam PACS (C-STORE/Q/R), çok serili hangar UX, hangı kesitin “canonical” olduğu klinik kural seti.

### 7.4 Erişilebilirlik / mobil
- Modal focus trap iyileştirilmiş; Playwright mobile projesi CI’da.
- Birçok form hâlâ küçük dokunma hedefleri / eksik `aria` (özellikle NewCase).
- Hardcoded TR → ekran okuyucu EN’de Türkçe duyar.

---

## 8. API yüzeyi — yarım / demo uçlar

| API | Durum |
|-----|--------|
| `/api/v1/auth/*` | Login/register/reset var; SMTP/rate-limit/prod secret eksik |
| `/api/v1/payments/*` | `confirm-demo` — üretim PSP değil |
| `/api/v1/radiologist-payouts/*` | Ledger/mark-paid — banka entegrasyonu yok |
| `/api/v1/admin/retention` | Plan/apply — politika ürünleşmesi sınırlı |
| `/api/v1/models/readiness` | Readiness — FE SystemStatus mock ile karışıyor |
| DICOM `/demo/{kind}` | Fixture yolu — prod’da kapatılmalı |
| Training export | Verify RBAC’li — operasyonel UI ince |

---

## 9. Test & CI durumu

**İyi:**
- Frontend: typecheck + vitest + build
- Backend: P0 regression gate + full pytest
- E2E: desktop + mobile + `E2E_PROTECTED`
- Son dönemde SQLite kilit / VHS / Playwright yeşile çekme

**Eksik / risk:**
- CI Vision extras “optional/skip” — gerçek VLM/torch yolu CI’da sürekli doğrulanmıyor.
- E2E backend script LLM’i mock’a zorluyor (`scripts/e2e-backend.mjs`) — gerçek AI regresyonu yok.
- Postgres repo için test dosyası var (`test_postgres_repo.py`) ama CI job’u Postgres servisi kaldırmıyor (yalnızca pip `requirements.txt`).
- Bundle budget (`check:bundle`) CI frontend job’unda yok (script var, workflow’da çağrı yok).

---

## 10. Ops / dağıtım eksikleri

- `docker-compose.yml`: tek komut demo; auth off, JWT demo, LLM mock.
- Nginx reverse proxy var (`docker/nginx.conf`) — TLS/cert otomasyonu yok.
- Observability: structured audit emit var; Prometheus/OpenTelemetry/dashboard yok.
- Backup: volume `vetmind_data` — backup job kodda yok.
- `vercel.json` mevcut; API/DICOM için static FE hosting klinik stack’i karşılamaz (bilinçli ayrım gerekir).

---

## 11. Önerilen yol haritası (kod boşluklarına göre)

### Faz A — “Prod kapısı” (1–2 sprint)
1. Auth zorunlu + JWT secret fail-fast  
2. SMTP zorunlu (veya reset endpoint prod’da kapalı)  
3. Demo DICOM/payment endpoint’lerini `deployment_mode=demo` arkasına al  
4. SystemStatus/Modules/Dashboard mock şeritlerini kaldır veya “fiction” kilidi  
5. Compose prod overlay (`auth=1`, `llm` gerçek, secret’tan oku)

### Faz B — “Klinik dürüst AI”
1. VLM+LLM readiness paneli (FE gerçek `/models/readiness`)  
2. Onay öncesi evidence checklist  
3. Coverage / örnekleme kullanıcıya açık metin  
4. Ontology drift için golden set CI (mevcut testleri genişlet)

### Faz C — “Çok klinik / ticari”
1. Klinik tenancy + self-register invite  
2. Gerçek ödeme adapter  
3. Object storage quarantine  
4. RQ worker + Redis rate limit  
5. İkinci klinik modül (ör. toraks XR + VHS’yi kardiyo/toraks modülüne taşı)

### Faz D — “Veri modeli”
1. Postgres normalize veya bilinçli “document DB” kararı dokümante  
2. KVKK silme/export API  
3. Audit export

---

## 12. Bilinçli olarak “eksik değil” sayılanlar

Bunlar kodda **kasıtlı kısıt** gibi duruyor; bug değil, ürün kararı — ama paydaşla netleştirilmeli:

- Expert approve → `clinically_validated=False`  
- Pixel/VLM default kapalı  
- LLM hata sonrası mock’a düşmeme  
- Onaylı rapor soft-hide (tıbbi kayıt silinmez)  
- Nöroloji-first modül kartları  

---

## 13. Hızlı dosya indeksi (bu analizin dayanakları)

| Konu | Dosya |
|------|--------|
| Settings / flags | `backend/app/settings.py` |
| RBAC | `backend/app/auth/rbac.py` |
| JWT default | `backend/app/auth/security.py` |
| Mailer | `backend/app/auth/mailer.py` |
| Container / adapters | `backend/app/container.py` |
| Orchestrator | `backend/app/orchestration/orchestrator.py` |
| VLM | `backend/app/models/vlm_vision.py` |
| Payments | `backend/app/api/payments.py`, `src/components/DemoPaymentStep.tsx` |
| Routes / Gate | `src/App.tsx` |
| Nav | `src/components/Sidebar.tsx` |
| Module fiction | `src/pages/Modules.tsx`, `src/data/mock.ts` |
| Case module hardcode | `src/lib/caseMapper.ts` |
| CI | `.github/workflows/ci.yml` |
| Compose | `docker-compose.yml` |

---

## 14. Sonuç

Kod, **demo-dürüst + uzman onaylı nöroloji radyoloji asistanı** için ileri bir noktada. Eksiklerin çoğu “özellik yok” değil; **üretim varsayılanları, gerçek AI açıkken operasyon, çok-modül/çok-klinik, gerçek ödeme ve mock UI temizliği**.

En yüksek kaldıraç sırası: **(1) auth/secret/SMTP prod kapısı → (2) mock fiction UI temizliği → (3) VLM/LLM readiness + evidence checklist → (4) tenancy/ödeme/storage ölçeği.**
