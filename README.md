# VetMind AI — Veteriner Teleradyoloji Platformu

Acıbadem Üniversitesi CSE 401/402 bitirme projesi · VRM Teknoloji iş birliğiyle.

**Multimodal / multi-model AI destekli veteriner teleradyoloji** prototipi. Platform radyoloğa yardımcı olur; otonom tanı koymaz.

| | |
|---|---|
| Backend sürüm | `0.2.0` |
| Frontend | React 18 · TypeScript · Vite 5 · Tailwind · React Router 6 |
| Backend | Python 3.11+ · FastAPI · Pydantic · pydicom |
| Kalıcılık | SQLite (varsayılan) · memory · PostgreSQL JSON(B) |
| Jobs | Thread worker (varsayılan) · opsiyonel RQ + Redis |
| Demo hazırlık | **GO** (sentetik veri) |
| Klinik üretim / gerçek AI | **NO-GO** |

> **Klinik sistem değildir.** Gerçek eğitilmiş Vision AI / VLM, ücretli LLM, PACS veya klinik validasyon yoktur. Varsayılan çıktılar `MOCK` / `SYNTHETIC` etiketlidir; uzman veteriner radyolog onayı zorunludur. Bu README hızlı başlangıç + ürün durumunun tek giriş noktasıdır; derinlik için [ARCHITECTURE.md](ARCHITECTURE.md) ve [docs/](docs/) belgelerine bakın.

---

## İçindekiler

1. [Proje özeti](#1-proje-özeti)
2. [Ne çalışıyor / ne yok](#2-ne-çalışıyor--ne-yok)
3. [Geliştirme fazları](#3-geliştirme-fazları)
4. [Hızlı başlangıç](#4-hızlı-başlangıç)
5. [Demo akışı](#5-demo-akışı)
6. [Sistem mimarisi](#6-sistem-mimarisi)
7. [Uçtan uca veri akışı](#7-uçtan-uca-veri-akışı)
8. [AI / Vision / LLM / RAG](#8-ai--vision--llm--rag)
9. [Rapor yaşam döngüsü](#9-rapor-yaşam-döngüsü)
10. [Auth, RBAC ve güvenlik](#10-auth-rbac-ve-güvenlik)
11. [Frontend](#11-frontend)
12. [API referansı](#12-api-referansı)
13. [Ortam değişkenleri](#13-ortam-değişkenleri)
14. [Opsiyonel altyapı](#14-opsiyonel-altyapı)
15. [Testler](#15-testler)
16. [Depo düzeni](#16-depo-düzeni)
17. [Swap-in noktaları](#17-swap-in-noktaları)
18. [Dokümantasyon indeksi](#18-dokümantasyon-indeksi)
19. [Uyarılar ve sonraki adımlar](#19-uyarılar-ve-sonraki-adımlar)

---

## 1. Proje özeti

VetMind AI, veteriner klinikleri ile uzman teleradyolog arasında köprü kurmayı hedefleyen bir **karar destek** prototipidir:

1. DICOM / doküman yükleme ve karantina  
2. Tür / modalite / bölge sınıflandırması + kullanıcı onayı  
3. Capability tabanlı model routing  
4. Vision adapter(lar) → yapılandırılmış bulgular  
5. Fusion / normalizasyon  
6. RAG destekli LLM taslak rapor  
7. Yapısal rapor doğrulama  
8. Uzman inceleme (approve / reject / revision) → immutable sürüm → print/PDF  

**Mimari desen:** Modular monolith. Tüm bağımlılıklar `backend/app/container.py` (`AppContainer`) içinde birleşir; HTTP katmanı ince router’lardır. Gerçek modeller adapter olarak eklenir; orchestrator yeniden yazılmaz.

---

## 2. Ne çalışıyor / ne yok

### Çalışan özellikler

| Alan | Durum |
|------|--------|
| **Frontend** | Landing, giriş/kayıt, DICOM sürükle-bırak + tarayıcı viewer (W/L, dilim, zoom/pan), işleme ekranı, vaka listesi/detay, uzman inceleme, onaylı rapor (print → PDF), RAG bilgi tabanı, sistem durumu, rol gate |
| **Backend API** | Case / Job / Findings / Report / Review / DICOM / Documents / Auth / RAG / Health |
| **Quarantine** | Yerel disk `backend/data/quarantine/{ingest_id}/` + SHA256 + `manifest.json`; path sanitization |
| **DICOM** | Metadata parse (pydicom), Study→Series→Instance, sınıflandırma önerisi + onay; demo fixture: Brain MRI, Cervical MRI, Brain CT, Thorax XR |
| **Doküman** | PDF / JPG / PNG / text sniff → quarantine → metin çıkarma → multimodal VLM stub |
| **AI pipeline** | Router → mock Vision (MRI/CT/XR/VLM) → fusion → mock/stub/HTTP LLM + RAG → validator |
| **Async analyze** | Thread (varsayılan) veya RQ+Redis; job poll, timeout alanları, cooperative cancel |
| **Rapor yaşam döngüsü** | Append-only versiyonlama, onayda immutable snapshot, reject / revision-after-approve, `?version=N` |
| **RAG** | Hash-embedding cosine (varsayılan) veya lexical; seed corpus; `rag_citations` UI |
| **Auth** | Opsiyonel JWT (HS256) + API key + RBAC + klinik/owner izolasyon; protected deployment mode |
| **Kalıcılık** | memory / SQLite / PostgreSQL JSON(B) — CaseRecord, jobs, ingestions |
| **Remote Vision** | `HttpRemoteVisionModel` + `scripts/mock_vision_server.py` iskeleti |
| **Provenance** | `source_kind` ∈ {mock, real, mixed}; UI’da DEMO/MOCK / REAL/MIXED banner’ları |
| **E2E** | Playwright tam klinik akış + negatif senaryolar; pytest Phase 6 journey suite |
| **Audit** | Append-only security audit JSONL (auth açık yolculuklarda) |

### Bilinçli olarak yok / ertelenmiş

| Yok | Açıklama |
|-----|----------|
| Eğitilmiş klinik Vision / VLM | Varsayılan: fixture mock; piksel analizi yok (`metadata_only`) |
| Ücretli / üretim LLM | Varsayılan `MockLLMProvider` |
| PACS / DICOMweb | Yok |
| OCR | Doküman metin stub |
| sentence-transformers / Qdrant | Hash embedding + JSON indeks |
| OAuth / SSO | Demo localStorage + opsiyonel JWT |
| Celery / K8s workers | Thread veya RQ |
| Encryption-at-rest / malware AV | Env bayrakları var; gerçek entegrasyon yok |
| Klinik validasyon | Validator `clinically_validated=True` engeller |
| Ödeme / faturalama | Gerçek tahsilat yok · demo ödeme (100 EUR) görüntüleme talebi öncesi — [docs/DEMO_PAYMENT_SUBMISSION_FLOW.md](docs/DEMO_PAYMENT_SUBMISSION_FLOW.md) |

Frontend rol kapıları **yalnızca UX**’tir. Gerçek veya korumalı veri için backend auth zorunludur.

---

## 3. Geliştirme fazları

| Faz | Belge | Konu | Sonuç |
|-----|-------|------|--------|
| 1–2 | [PHASE_1_1_AND_2.md](docs/PHASE_1_1_AND_2.md) | DICOM ingest, quarantine, sınıflandırma, vaka yönetimi | Stabil |
| 3 | [PHASE_3_AI_READINESS.md](docs/PHASE_3_AI_READINESS.md) | ImagingModelInput, execution policy, job cancel/timeout, LLM DTO | Adapter sözleşmeleri hazır; mock default |
| 4 | [PHASE_4_REPORT_LIFECYCLE.md](docs/PHASE_4_REPORT_LIFECYCLE.md) | Rapor versiyonlama, uzman inceleme sertleştirme, print-to-PDF | Immutable onaylı sürümler |
| 5 | [PHASE_5_SECURITY_PERFORMANCE.md](docs/PHASE_5_SECURITY_PERFORMANCE.md) | Auth/tenant, quarantine integrity, audit, retention hooks, concurrency | Protected mode kapıları |
| 6 | [PHASE_6_END_TO_END_READINESS.md](docs/PHASE_6_END_TO_END_READINESS.md) | Sentetik E2E + release readiness | Demo **GO** · klinik **NO-GO** |
| 6.1 | [PHASE_6_1_FULL_WORKFLOW_E2E.md](docs/PHASE_6_1_FULL_WORKFLOW_E2E.md) | Browser tam klinik workflow | Playwright yeşil |

---

## 4. Hızlı başlangıç

**Gereksinimler:** Node.js 18+ · Python 3.11+

### 4.1 Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 4.2 Frontend (ayrı terminal, repo kökü)

```bash
npm install
npm run dev
```

| Servis | URL |
|--------|-----|
| UI | http://localhost:5173 |
| OpenAPI | http://127.0.0.1:8000/docs |
| Health | http://127.0.0.1:8000/api/v1/health |

Vite `/api` → `http://127.0.0.1:8000` (`vite.config.ts`).  
Kalıcılık varsayılanı: SQLite → `backend/data/vetmind.sqlite3`.

### 4.3 npm script’leri

| Script | Ne yapar |
|--------|----------|
| `npm run dev` | Vite UI (`--open`) |
| `npm run build` | `tsc` + üretim build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest |
| `npm run backend:dev` | uvicorn (`.venv`) |
| `npm run backend:test` | pytest |
| `npm run e2e` | Playwright (sistem Chrome; browser indirmez) |
| `npm run e2e:ui` | Playwright UI mode |
| `npm run build:share` | Paylaşım build (`dist-share`) |

---

## 5. Demo akışı

### Hesaplar

Şifre hepsi: `demo1234`

| E-posta | Rol | Tipik kullanım |
|---------|-----|----------------|
| `vet@demo.local` | Veteriner hekim | DICOM yükle, vaka oluştur, analiz başlat |
| `expert@demo.local` | Uzman hekim (VRM) | İnceleme / onay / red / revizyon |
| `owner@demo.local` | Klinik sahibi | Rapor okuma |
| `admin@demo.local` | Admin | Bilgi tabanı, sistem durumu, RAG admin |

### Önerilen senaryo (5–10 dk)

1. `vet@demo.local` ile giriş → otomatik **`/dicom-yukle`**.  
2. **Demo · Brain MRI** (veya CT / Thorax XR) veya `.dcm` sürükle.  
3. Viewer’da dilim gez (`Im: n/m`); W/L / zoom / pan isteğe bağlı.  
4. Metadata sınıflandırma önizlemesini onayla → **Demo analize devam et**.  
5. İşleme ekranında `DEMO / MOCK ANALYSIS` ve job alanlarını gör.  
6. **Vakalar → Backend’den yenile** (SQLite kalıcılık; restart sonrası da kalır).  
7. Vaka detay → **Bulgular** → mock / SYNTHETIC provenance.  
8. Üst barda rolü **Uzman Hekim (VRM)** yap → inceleme → **Onayla ve Yayınla**.  
9. Vaka geçmişinde sürüm / immutable; **Raporlar** → onaylı rapor; **PDF olarak indir**.  
10. İsteğe bağlı: Admin → **Bilgi Tabanı** (RAG search), **Sistem Durumu** (`/health`).

Alternatif: **Yeni Vaka** ile sentetik senaryolar (`ct_brain_suspected`, `xr_thorax_suspected`, `document_context`, …) veya eski yerel prototip pipeline.

---

## 6. Sistem mimarisi

```text
┌──────────────────────────────┐
│  React UI (Vite :5173)       │  Landing, Login, DICOM, Processing,
│  AppContext + backend.ts     │  CaseDetail, ExpertReview, RAG KB
└──────────────┬───────────────┘
               │  /api → proxy
               ▼
┌──────────────────────────────┐
│  FastAPI (:8000) /api/v1/*   │  İnce HTTP router’lar
│  Auth (opsiyonel JWT+API key)│
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  AppContainer (DI root)      │  settings → repo, quarantine,
│  backend/app/container.py    │  router, models, LLM, RAG, jobs
└──────────────┬───────────────┘
               │
     ┌─────────┼─────────┬────────────────┐
     ▼         ▼         ▼                ▼
 Quarantine  CaseRepo  JobBackend    AIOrchestrator
   disk     mem/sqlite  thread|RQ     ↓
            /postgres              Router → Vision → Fusion
                                   → LLM+RAG → Validator
```

### Backend paketleri

| Paket | Amaç |
|-------|------|
| `api/` | HTTP: auth, cases, analysis, reports, dicom, documents, rag; `deps.py` |
| `auth/` | JWT / API key, `require_auth` / `require_capability`, RBAC |
| `services/` | `CaseService`, `DicomService`, `DocumentService`; repository Protocol + sqlite/postgres |
| `storage/` | `QuarantineStore` |
| `dicom/` | ingest, parser, validator, classifier, fixtures |
| `ingest/` | dosya türü sniff, doküman metin çıkarma |
| `imaging/` | metadata-only preparation pipeline (Phase 3) |
| `routing/` | capabilities, `ModelRouter`, scenario + execution policy |
| `models/` | `ImagingModel` protokolü, mock registry, HTTP remote, normalizer, pixel authz |
| `orchestration/` | `AIOrchestrator.run()` |
| `llm/` | gateway + mock / stub / HTTP provider |
| `rag/` | corpus, lexical, hash embeddings, JSON vector store |
| `validation/` | yapısal report validator |
| `workers/` | Thread / RQ job backend |
| `security/` | audit logger, retention hooks |
| `schemas/` | Pydantic DTO’lar ve enum’lar |

### Kalıcılık

| Backend | Env | Not |
|---------|-----|-----|
| memory | `VETMIND_STORAGE=memory` | Test / ephemeral |
| sqlite | `sqlite` (varsayılan) | `backend/data/vetmind.sqlite3` — JSON blob’lar |
| postgres | `postgres` | JSONB; `VETMIND_DATABASE_URL` gerekir |

Saklanan başlıca varlıklar: `CaseRecord`, `AnalysisJob`, `DicomIngestionRecord`, `DocumentIngestionRecord`, `report_versions[]`.

### Quarantine

- Yerel disk; AV / S3 yok.  
- Kök: `backend/data/quarantine/{ingest_id}/`  
- Manifest + dosya hash’leri ingestion ve case üzerinde tutulur.  
- `ingest_id` doğrulama + path resolve (traversal engeli).

### Jobs

| Backend | Env | Not |
|---------|-----|-----|
| thread | `VETMIND_JOB_BACKEND=thread` | Daemon thread + `VETMIND_ASYNC_DELAY_MS` |
| rq | `rq` | Redis (`VETMIND_REDIS_URL`); `python -m app.workers.rq_worker`; memory storage ile kullanılmaz |

Job alanları (özet): `status`, `outcome`, `cancel_requested`, `idempotency_key`, `timeout_s`, `routed_model_versions`, `analysis_mode`.

---

## 7. Uçtan uca veri akışı

```text
Drag & Drop / Demo Upload
  → Upload API
  → Quarantine Storage          (byte’lar diskte; SHA256 + manifest)
  → File Type Detector
       ├─ DICOM Metadata Parser (pydicom; Study → Series → Instance)
       └─ PDF / JPG / PNG / Text Parser
  → Species / Modality / Body Region Classifier
  → Kullanıcı onayı (classification confirm) → CaseRecord
  → AI Model Router (capability + scenario + execution policy)
       ├─ X-Ray Vision (mock)     ├─ CT 3D (mock)
       ├─ MRI (mock)              └─ Multimodal VLM (mock)
       └─ (opsiyonel) HttpRemoteVision
  → Structured Findings + Evidence (normalize / fuse)
  → LLM Gateway + Optional RAG → Draft Report (+ rag_citations)
  → Report Validator (yapısal)
  → Veteriner radyolog incelemesi (approve / reject / revision)
  → Onaylı immutable rapor sürümü → print / PDF
```

### Kod yolları

| # | Aşama | Nerede |
|---|--------|--------|
| 1 | Upload | `POST /api/v1/dicom/upload` veya `/demo/{kind}`; doküman: `POST /api/v1/documents/upload` |
| 2 | Quarantine | `storage/quarantine.py` |
| 3 | Parse / sniff | `dicom/parser.py`, `ingest/filetype.py`, `ingest/documents.py` |
| 4 | Classify | `dicom/classifier.py` → `ClassificationSuggestion` |
| 5 | Confirm → Case | `POST .../ingestions/{id}/confirm` → `classification_confirmed=True` |
| 6 | Analyze gate | `CaseService._assert_analyzable()` |
| 7 | Route | `routing/model_router.py` + `scenario_policy.py` + `execution_policy.py` |
| 8 | Vision | `models/mock_vision.py`; opsiyonel `models/http_vision.py` |
| 9 | Fuse | `models/normalizer.py` → `StructuredFindings` |
| 10 | LLM + RAG | `llm/gateway.py` + `rag/*` |
| 11 | Validate | `validation/report_validator.py` → `AWAITING_REVIEW` |
| 12 | Review | `POST /api/v1/cases/{id}/review` → `APPROVED` / reject / revision |

### Analyze modları

- **Sync:** `POST /api/v1/cases/{id}/analyze`  
- **Async:** `POST /api/v1/cases/{id}/analyze/async` → enqueue → `GET /api/v1/jobs/{job_id}` poll  
- **Cancel:** `POST /api/v1/jobs/{id}/cancel` (cooperative)

Unsupported modality/region → `MANUAL_REVIEW`, AI draft üretilmez.  
Adapter failure → onaylanabilir draft yok.  
Frontend poll abort **backend işini iptal etmez**; ayrı cancel gerekir.

### Vaka durumları (özet)

```text
CREATED / AWAITING_CLASSIFICATION_CONFIRMATION
  → classification confirm
  → ANALYZING (job RUNNING)
  → AWAITING_REVIEW  |  MANUAL_REVIEW  |  FAILED / PARTIAL
  → APPROVED  (uzman approve sonrası)
```

Frontend `caseStatusMap.ts` backend durumlarını UI etiketlerine map eder.

---

## 8. AI / Vision / LLM / RAG

### 8.1 Orchestrator

`AIOrchestrator.run(case, job)` sırası:

1. `ensure_model_input` / `build_imaging_model_input`  
2. `ModelRouter.route` → `ScenarioRoutingPolicy` → `ModelExecutionPolicy`  
3. Seçilen adapter’lar için `analyze(case)`  
4. `normalize_outputs` (fusion + conflict hints)  
5. `LLMGateway.generate_draft` (+ RAG) — LLM fail’de **mock fallback yok**  
6. `ReportValidator.validate`  
7. Case / job status güncelleme  

### 8.2 Vision model registry (mock)

| `model_id` | Rol |
|------------|-----|
| `mock-brain-mri-v1` | Beyin MR |
| `mock-brain-mri-alt-v1` | Çatışma demosu |
| `mock-cervical-mri-v1` | Servikal MR |
| `mock-ct-3d-v1` | Beyin CT |
| `mock-xr-vision-v1` | Toraks XR |
| `mock-multimodal-vlm-v1` | Doküman / multimodal stub |
| `manual-review` | Desteklenmeyen rota |
| `remote-vision-v1` (yapılandırılabilir) | `VETMIND_VISION_ENDPOINT` set ise HTTP |

Mock’lar: `source_kind=MOCK`, `Finding.synthetic=True`.  
Pixel: default-deny; bugün hiçbir capability `allows_pixel_analysis=True` değil.

### 8.3 LLM

| `VETMIND_LLM_PROVIDER` | Sınıf | Davranış |
|------------------------|--------|----------|
| `mock` (default) | `MockLLMProvider` | Şablon taslak |
| `stub` / `deterministic` | `DeterministicStubLLMProvider` | Test çıktısı |
| `http` | `HttpLLMProvider` | `VETMIND_LLM_ENDPOINT` zorunlu |
| `openai` / `ollama` / `vllm` | `OpenAICompatibleProvider` | Gerçek model; bkz. [docs/LLM_KATMANI.md](docs/LLM_KATMANI.md) |
| `anthropic` | `AnthropicProvider` | Gerçek model (Claude) |

Dışarıya tam `CaseRecord` gitmez → minimal `LLMGenerationInput` (opaque `case_id`, findings, RAG pasajları).

### 8.4 RAG

| Mod | Env | Mekanizma |
|-----|-----|-----------|
| embedding (varsayılan) | `VETMIND_RAG=embedding` | Hash n-gram + cosine; `JsonVectorStore` → `data/rag_index.json` |
| lexical | `lexical` | Token overlap |

Seed: `rag/corpus.py`. Admin: `POST /rag/reindex`, `POST /rag/documents`.  
**Klinik kural:** RAG klinik kanıt sayılmaz; draft’ta `rag_note` uyarısı vardır; validator klinik validasyon bayrağını engeller.

Derin AI dokümantasyonu: [docs/ARCHITECTURE_AND_LLM.md](docs/ARCHITECTURE_AND_LLM.md).

---

## 9. Rapor yaşam döngüsü

```text
Pipeline draft
  → attach_pipeline_draft() → DraftReport.version + report_versions[]
  → Expert review (CaseService lock + CAP_REVIEW)
       approve           → freeze_approved()     (immutable)
       reject            → apply_reject_or_revision()
       request_revision  → fork after approve if needed
  → GET /report?version=N  /  GET /report/versions[/{n}]
  → CaseDetail history + ApprovedReport → window.print() / PDF
```

| Kural | Davranış |
|-------|----------|
| İlk pipeline draft | version 1 (mutable) |
| Approve | `immutable: true`; `clinically_validated` false kalır |
| Reject / revision (mutable) | status + notes; gerekirse aynı sürüm |
| Revision after approve | Yeni mutable sürüm; önceki onaylı snapshot kalır |
| Concurrent review | Lock → biri 200, diğeri **409** |
| Re-analyze while approved | **409** (sessiz overwrite yok) |

PDF: sunucu tarafı PDF kütüphanesi yok; `ApprovedReport` + `@media print` + `window.print()` (E2E’de Chromium `page.pdf()` ile doğrulanır).

---

## 10. Auth, RBAC ve güvenlik

### Auth modları

| Mod | Env | Davranış |
|-----|-----|----------|
| Demo (varsayılan) | `VETMIND_AUTH_ENABLED=0` | Principal `demo`, capability `*` |
| Auth açık | `VETMIND_AUTH_ENABLED=1` | Bearer JWT ve/veya `X-API-Key` |
| Protected | `VETMIND_DEPLOYMENT_MODE=protected` | Auth zorunlu + non-default JWT secret; fail-closed startup |

### RBAC (özet)

| Rol | Yetenekler (özet) |
|-----|-------------------|
| `demo` / `service` / `admin` | `*` |
| `vet` | cases write/read, analyze, dicom, documents, rag:search |
| `expert` | cases read, analyze, review, rag:search, dicom (demo) |
| `owner` | cases read, rag:search |

Capability sabitleri: `backend/app/auth/rbac.py` (`cases:write`, `review`, `rag:admin`, …).

### Frontend ↔ backend auth

1. UI oturumu: `src/lib/auth.ts` → localStorage (`vetmind.demo.session`)  
2. API JWT: login/register/rol değişiminde `backendLogin` → `vetmind.backend.jwt`; `backend.ts` `Authorization: Bearer` ekler  
3. Çıkışta IndexedDB DICOM önbelleği temizlenir (Phase 5)

### Güvenlik notları (dürüst)

- Varsayılan auth kapalı; internete açık deploy için **uygun değil**.  
- Demo JWT secret ve şifreler bilinir.  
- Frontend hesapları localStorage’da demo amaçlı tutulur.  
- Quarantine yerel diskte; üretim AV / şifreleme yok.  
- Tenant isolation auth açık + `tenant_isolation` ile anlamlıdır.  
- AI çıktıları tanı değildir; UI disclaimer’ları bilinçlidir.

---

## 11. Frontend

### Rotalar

| Rota | Sayfa | Roller | Backend kullanımı |
|------|-------|--------|-------------------|
| `/` | Landing / Dashboard | misafir / tümü | — |
| `/giris` | Login | — | `POST /auth/login` |
| `/kayit` | Register | — | localStorage + best-effort JWT |
| `/dicom-yukle` | DicomUpload | vet | upload, confirm, async analyze, fixtures |
| `/vakalar/yeni` | NewCase | vet | create+analyze veya yerel prototip |
| `/vakalar` | CaseList | vet, expert | list / refresh |
| `/vakalar/:id` | CaseDetail | vet, expert | case, findings, history, RAG |
| `/vakalar/:id/isleme` | Processing | vet, expert | job poll |
| `/vakalar/:id/inceleme` | ExpertReview | expert | review submit (+ hydrate) |
| `/kuyruk` | ReviewQueue | expert | kuyruk UI |
| `/raporlar`, `/raporlar/:id` | Report* | vet, owner, expert | onaylı rapor + print |
| `/moduller` | Modules | admin | — |
| `/bilgi-tabani` | KnowledgeBase | admin | `rag/search` |
| `/sistem` | SystemStatus | admin | `GET /health` |

Rol gate: `App.tsx` → `<Gate roles={[...]}>`.

### Önemli bileşenler / lib

| Dosya | Amaç |
|-------|------|
| `components/DicomViewer.tsx` + `lib/dicomPreview.ts` | Tarayıcı viewer (klinik PACS değil) |
| `components/RagCitations.tsx` | `rag_citations` paneli |
| `components/AIDisclaimer.tsx` | Klinik olmayan çıktı uyarısı |
| `lib/backend.ts` | `/api/v1` client, async poll |
| `lib/caseMapper.ts` | Backend record → UI `VetCase` |
| `lib/auth.ts` | Demo session + JWT saklama |
| `context/AppContext.tsx` | Seed + backend hydrate / refresh |

---

## 12. API referansı

Önek: `/api/v1`. Canlı şema: http://127.0.0.1:8000/docs

| Method | Path | Amaç |
|--------|------|------|
| GET | `/health` | Canlılık + storage / rag / jobs / auth / vision bayrakları |
| GET | `/auth/status` | Auth zorunlu mu? |
| POST | `/auth/login` | Demo JWT |
| GET | `/auth/me` | Principal |
| POST | `/cases` | Sentetik vaka oluştur |
| GET | `/cases` | Vaka listesi |
| GET | `/cases/{id}` | Tam vaka kaydı |
| POST | `/cases/{id}/model-input` | ImagingModelInput üret / yenile |
| GET | `/cases/{id}/model-input` | Model input getir |
| GET | `/cases/{id}/findings` | Structured findings |
| POST | `/cases/{id}/analyze` | Sync pipeline |
| POST | `/cases/{id}/analyze/async` | Async enqueue (202) |
| GET | `/jobs/{id}` | Job durumu / outcome |
| POST | `/jobs/{id}/cancel` | Cooperative iptal |
| GET | `/cases/{id}/report` | Draft / sürüm (`?version=`) |
| GET | `/cases/{id}/report/versions` | Sürüm listesi |
| GET | `/cases/{id}/report/versions/{n}` | Belirli sürüm |
| POST | `/cases/{id}/review` | Uzman inceleme |
| POST | `/dicom/upload` | Multipart DICOM → quarantine |
| POST | `/dicom/demo/{kind}` | `brain_mri` \| `cervical_mri` \| `brain_ct` \| `thorax_xr` |
| GET | `/dicom/fixtures/{kind}/{index}` | Viewer için `.dcm` |
| GET | `/dicom/ingestions/{id}` | Ingestion kaydı |
| POST | `/dicom/ingestions/{id}/confirm` | Sınıflandırma onayı → case |
| POST | `/documents/upload` | PDF/JPG/PNG/text |
| GET | `/documents/ingestions/{id}` | Doküman ingestion |
| POST | `/documents/ingestions/{id}/confirm` | Onay → case |
| GET | `/rag/search?q=&top_k=` | RAG arama |
| POST | `/rag/reindex` | İndeks yenile (admin) |
| POST | `/rag/documents` | Özel pasaj ekle (admin) |

Backend özeti: [backend/README.md](backend/README.md).

---

## 13. Ortam değişkenleri

Şablon: [`backend/.env.example`](backend/.env.example) · okuma: `backend/app/settings.py`.

### Temel

| Değişken | Varsayılan | Anlam |
|----------|------------|--------|
| `VETMIND_STORAGE` | `sqlite` | `memory` \| `sqlite` \| `postgres` |
| `VETMIND_SQLITE_PATH` | `./data/vetmind.sqlite3` | SQLite yolu |
| `VETMIND_DATABASE_URL` / `DATABASE_URL` | — | Postgres DSN |
| `VETMIND_QUARANTINE_ROOT` | `./data/quarantine` | Karantina kökü |
| `VETMIND_ASYNC_DELAY_MS` | `400` | Async yapay gecikme (0–10000) |

### Jobs

| Değişken | Varsayılan | Anlam |
|----------|------------|--------|
| `VETMIND_JOB_BACKEND` | `thread` | `thread` \| `rq` |
| `VETMIND_REDIS_URL` | — | RQ Redis URL |
| `VETMIND_RQ_QUEUE` | `vetmind` | Kuyruk adı |

### RAG / Vision / LLM

| Değişken | Varsayılan | Anlam |
|----------|------------|--------|
| `VETMIND_RAG` | `embedding` | `embedding` \| `lexical` |
| `VETMIND_RAG_INDEX_PATH` | `./data/rag_index.json` | Vektör indeks |
| `VETMIND_VISION_ENDPOINT` | — | Remote Vision HTTP |
| `VETMIND_VISION_MODEL_ID` | `remote-vision-v1` | Remote model id |
| `VETMIND_VISION_API_KEY` | — | Bearer |
| `VETMIND_VISION_MODALITIES` / `_REGIONS` | — | Endpoint set ise zorunlu capability beyanı |
| `VETMIND_VISION_EXECUTION_POLICY` | `exclusive_real` | `exclusive_real` \| `mixed` |
| `VETMIND_LLM_PROVIDER` | `mock` | `mock` \| `stub` \| `http` |
| `VETMIND_LLM_ENDPOINT` | — | HTTP LLM URL |

### Auth / güvenlik

| Değişken | Varsayılan | Anlam |
|----------|------------|--------|
| `VETMIND_AUTH_ENABLED` | `0` | `1` → JWT/API key zorunlu |
| `VETMIND_API_KEY` | — | `X-API-Key` |
| `VETMIND_JWT_SECRET` | demo secret | Auth açıkken değiştirin |
| `VETMIND_JWT_TTL_SECONDS` | `43200` | Token TTL |
| `VETMIND_DEPLOYMENT_MODE` | `demo` | `demo` \| `protected` |
| `VETMIND_TENANT_ISOLATION` | off | Klinik/owner izolasyon |
| `VETMIND_ALLOW_INSECURE_DEMO` | off | Protected’da demo secret’a izin (yalnızca bilinçli) |
| `VETMIND_AUDIT_LOG_PATH` | `./data/audit/security.jsonl` | Audit JSONL |
| `VETMIND_MAX_CONCURRENT_ANALYZE` | `8` | Eşzamanlı analiz limiti |

---

## 14. Opsiyonel altyapı

### PostgreSQL + Redis (RQ)

```bash
cd backend
docker compose -f docker-compose.yml up -d
export VETMIND_STORAGE=postgres
export VETMIND_DATABASE_URL=postgresql://vetmind:vetmind@localhost:5432/vetmind
pip install -r requirements-optional.txt
export VETMIND_JOB_BACKEND=rq
export VETMIND_REDIS_URL=redis://127.0.0.1:6379/0
# terminal A
uvicorn app.main:app --reload --port 8000
# terminal B
python -m app.workers.rq_worker
```

### Mock remote Vision

```bash
cd backend
python scripts/mock_vision_server.py   # :8090/infer
export VETMIND_VISION_ENDPOINT=http://127.0.0.1:8090/infer
# + modality/region capability env’leri (settings / .env.example)
```

### Geçici (test) storage

```bash
export VETMIND_STORAGE=memory
```

---

## 15. Testler

### Envanter (Phase 6 baseline)

| Katman | Konum | Not |
|--------|-------|-----|
| Frontend unit | `src/lib/*.test.ts` | Vitest |
| Backend | `backend/tests/` | ~238 pytest (+1 skip tipik) |
| Phase 6 API journeys | `test_phase6_e2e_journey.py` | DICOM→approve→versions, authz, persistence, … |
| Browser E2E | `e2e/*.spec.ts` | Tam workflow + negatives + smoke |
| Typecheck / build | `npm run typecheck` · `npm run build` | |

### Komutlar

```bash
npm test
npm run typecheck
npm run build
npm run backend:test
# veya: cd backend && pytest

npm run e2e
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 — sistem Google Chrome (channel: chrome)

# Postgres entegrasyonu (opsiyonel):
VETMIND_DATABASE_URL=postgresql://vetmind:vetmind@localhost:5432/vetmind \
  pytest tests/test_postgres_repo.py -q
```

### Browser E2E kapsamı

| Dosya | Senaryo |
|-------|---------|
| `e2e/full-workflow.spec.ts` | Login → Brain MRI demo → viewer/slice → confirm+analyze → findings → expert approve → versions → print/PDF |
| `e2e/negative.spec.ts` | Geçersiz DICOM, yetkisiz inceleme, refresh kalıcılık, timeout, cancel, backend down |
| `e2e/demo-journey.spec.ts` | Login / logout (desktop + mobil viewport) |

Playwright izole sqlite kullanır (`e2e/.data/`); üretim `backend/data/` dokunulmaz.

### Backend test odakları (örnek)

`test_api`, `test_dicom`, `test_ct_xr`, `test_documents`, `test_quarantine`, `test_orchestrator`, `test_router`, `test_mock_vision`, `test_http_vision`, `test_llm`, `test_rag` / `test_embedding_rag`, `test_async_analyze`, `test_report_versioning`, `test_auth` / `test_rbac`, `test_phase3_ai_readiness`, `test_phase5_security`, `test_phase6_e2e_journey`, `test_hardening_p0`, …

---

## 16. Depo düzeni

```text
veteriner/
├── README.md                      ← bu dosya (giriş noktası)
├── ARCHITECTURE.md                genel mimari (derinlik)
├── package.json
├── playwright.config.ts
├── vite.config.ts                 /api → :8000
├── vitest.config.ts
├── vercel.json
├── index.html
├── public/
├── scripts/                       build-share.mjs vb.
├── src/
│   ├── App.tsx                    Router + Gate
│   ├── main.tsx
│   ├── types.ts
│   ├── pages/                     Landing, Login, DicomUpload, Processing,
│   │                              CaseList, CaseDetail, ExpertReview,
│   │                              ApprovedReport, KnowledgeBase, SystemStatus, …
│   ├── components/                Layout, DicomViewer, RagCitations, …
│   ├── context/AppContext.tsx
│   ├── lib/                       backend.ts, auth.ts, caseMapper.ts, …
│   └── data/mock.ts               Yerel seed vakalar / KB
├── e2e/
│   ├── full-workflow.spec.ts
│   ├── negative.spec.ts
│   ├── demo-journey.spec.ts
│   └── helpers/
├── docs/
│   ├── ARCHITECTURE_AND_LLM.md
│   ├── PHASE_*.md
│   └── audits/
└── backend/
    ├── README.md
    ├── .env.example
    ├── requirements.txt
    ├── requirements-optional.txt  # redis, rq, psycopg
    ├── docker-compose.yml         # Postgres 16 + Redis 7
    ├── pytest.ini
    ├── scripts/                   mock_vision_server, bench_dicom_synthetic
    ├── data/                      runtime (gitignore)
    ├── app/
    │   ├── main.py
    │   ├── container.py
    │   ├── settings.py
    │   ├── api/
    │   ├── auth/
    │   ├── services/
    │   ├── storage/
    │   ├── dicom/
    │   ├── ingest/
    │   ├── imaging/
    │   ├── routing/
    │   ├── models/
    │   ├── orchestration/
    │   ├── llm/
    │   ├── rag/
    │   ├── validation/
    │   ├── workers/
    │   ├── security/
    │   └── schemas/
    └── tests/
```

---

## 17. Swap-in noktaları

Gerçek modeller / altyapı eklerken orchestrator’ı yeniden yazmak gerekmez:

| Katman | Dosyalar |
|--------|----------|
| Vision | `models/mock_vision.py`, `models/http_vision.py`, `models/interfaces.py` |
| LLM | `llm/mock_provider.py`, `llm/http_provider.py`, `llm/interfaces.py`, `llm/factory.py` |
| RAG | `rag/embedding_retriever.py`, `rag/vector_store.py` |
| Repo | `services/repository.py` (+ sqlite/postgres) |
| Jobs | `workers/job_backend.py` |
| Wiring | `container.py` (yalnızca bağlama) |
| Capabilities | `routing/capabilities.py`, `routing/remote_config.py` |

| Katman | Varsayılan (demo) | Gerçek şekilli | Klinik üretim |
|--------|-------------------|----------------|---------------|
| Vision | Mock fixture | HTTP remote adapter | Validate edilmiş GPU model + pixel pipeline |
| LLM | Mock | HTTP provider | Vendor LLM + privacy + audit |
| RAG | Hash / lexical seed | Aynı yüzey | Gerçek embed + vector DB |
| Jobs | Thread | RQ + Redis | Managed queue / K8s |
| Auth | Kapalı | JWT + API key | OAuth/SSO IdP |

---

## 18. Dokümantasyon indeksi

| Belge | Amaç |
|-------|------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Mimari, API, kalıcılık, frontend, güvenlik, demo |
| [docs/INTEGRATION_PLAYBOOK.md](docs/INTEGRATION_PLAYBOOK.md) | AI/LLM/veri gelince bağlama (basit Türkçe) |
| [docs/HEDEF_MIMARI_GAP_ISSUE_LISTESI.md](docs/HEDEF_MIMARI_GAP_ISSUE_LISTESI.md) | Hedef mimari gap / issue listesi |
| [docs/PHASE_20_FINAL_AI_READINESS.md](docs/PHASE_20_FINAL_AI_READINESS.md) | İlk gerçek model için 8 adım |
| [docs/ARCHITECTURE_AND_LLM.md](docs/ARCHITECTURE_AND_LLM.md) | AI/LLM pipeline, mock↔real, eksikler |
| [docs/PHASE_1_1_AND_2.md](docs/PHASE_1_1_AND_2.md) | DICOM + vaka yönetimi |
| [docs/PHASE_3_AI_READINESS.md](docs/PHASE_3_AI_READINESS.md) | Model adapter hazırlığı |
| [docs/PHASE_4_REPORT_LIFECYCLE.md](docs/PHASE_4_REPORT_LIFECYCLE.md) | Rapor sürümleri + inceleme |
| [docs/PHASE_5_SECURITY_PERFORMANCE.md](docs/PHASE_5_SECURITY_PERFORMANCE.md) | Güvenlik / performans |
| [docs/PHASE_6_END_TO_END_READINESS.md](docs/PHASE_6_END_TO_END_READINESS.md) | GO / NO-GO readiness |
| [docs/PHASE_6_1_FULL_WORKFLOW_E2E.md](docs/PHASE_6_1_FULL_WORKFLOW_E2E.md) | Browser E2E detayı |
| [docs/audits/01_AI_ARCHITECTURE.md](docs/audits/01_AI_ARCHITECTURE.md) | AI audit (F1–F14) |
| [docs/audits/02_DICOM_PHASE1_AUDIT.md](docs/audits/02_DICOM_PHASE1_AUDIT.md) | DICOM audit |
| [docs/audits/03_PDF_BACKEND_AUDIT.md](docs/audits/03_PDF_BACKEND_AUDIT.md) | PDF / rapor audit |
| [backend/README.md](backend/README.md) | Backend env + API kısa özet |
| [backend/.env.example](backend/.env.example) | Ortam şablonu |

Davranış çelişkisi varsa kaynak kod esas alınır (`container.py`, `orchestrator.py`, API router’lar).

---

## 19. Uyarılar ve sonraki adımlar

**Kullanım uyarısı:** Bitirme prototipidir. Klinik karar, tanı veya tedavi önerisi olarak kullanılamaz. Korumalı klinik veri için auth, izolasyon, şifreleme, AV ve model validasyonu tamamlanmadan deploy edilmemelidir.

**Olası sonraki adımlar:**

1. Gerçek şirket Vision / GPU serving (HTTP adapter üzerinde)  
2. Sentence-transformers + Qdrant / pgvector  
3. OAuth / SSO IdP  
4. Object storage quarantine + malware scan  
5. K8s / managed queue  
6. Daha zengin ilişkisel klinik şema (JSONB’den çıkış)  
7. Klinik validasyon ve regülasyon süreci (bu deponun dışında)  

---

*Son güncelleme: 2026-10-22 · Backend `0.2.0` · Phase 6 / 6.1 demo readiness*
