# VetMind AI — Mimari ve Proje Dokümantasyonu

> **Sürüm:** Backend `0.2.0` · Bitirme projesi prototipi (CSE 401/402 · VRM Teknoloji)  
> **Uyarı:** Klinik üretim sistemi değildir. Gerçek eğitilmiş Vision AI / VLM, ücretli LLM, PACS veya klinik validasyon yoktur. Mock çıktılar `MOCK` / `SYNTHETIC` etiketlidir; uzman veteriner radyolog onayı zorunludur.

Bu belge, depo yapısını, hedef veri akışını, backend/frontend mimarisini, API’yi, kalıcılığı, güvenlik modelini, yapılandırmayı, demo akışını ve uzatma noktalarını tek yerde toplar.

İlgili kısa belgeler:

- [README.md](README.md) — hızlı başlangıç ve demo
- [backend/README.md](backend/README.md) — backend env / API özeti
- [backend/.env.example](backend/.env.example) — ortam değişkeni şablonu

---

## 1. Sistem bağlamı

VetMind AI, **multimodal / multi-model AI destekli veteriner teleradyoloji** platformunun bitirme projesi prototipidir. Platform radyoloğa yardımcı olur; otonom tanı koymaz.

| Katman | Teknoloji |
|--------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind, React Router |
| Backend | Python 3.11+, FastAPI, Pydantic, pydicom |
| Kalıcılık | memory / SQLite (varsayılan) / PostgreSQL JSON(B) |
| Jobs | Thread worker (varsayılan) veya RQ + Redis |
| RAG | Hash-embedding cosine (varsayılan) veya lexical |
| Auth | Opsiyonel JWT (HS256) + API key + RBAC |

**Mimari desen:** Modular monolith. Tüm bağımlılıklar `AppContainer` composition root’unda birleştirilir; HTTP katmanı ince router’lardır.

```text
┌─────────────┐     Vite proxy /api      ┌──────────────────┐
│  React UI   │ ───────────────────────► │  FastAPI :8000   │
│  :5173      │ ◄─────────────────────── │  /api/v1/*       │
└─────────────┘                          └────────┬─────────┘
                                                  │
                    ┌─────────────────────────────┼─────────────────────────────┐
                    ▼                             ▼                             ▼
             Quarantine disk               CaseRepository                 Job backend
          (data/quarantine/)          (memory|sqlite|postgres)         (thread | RQ)
                    │                             │
                    └────────────► AIOrchestrator ◄────────────┐
                                   Router → Vision → Fusion     │
                                   → LLM+RAG → Validator        │
                                                                │
                                                         Model registry
                                                      (mock + optional HTTP)
```

---

## 2. Hedef veri akışı (pipeline)

```text
Drag & Drop / Demo Upload
  → Upload API
  → Quarantine Storage          (byte’lar diskte; SHA256 + manifest)
  → File Type Detector
       ├─ DICOM Metadata Parser (pydicom; Study → Series → Instance)
       └─ PDF / JPG / PNG / Text Parser
  → Species / Modality / Body Region Classifier
  → Kullanıcı onayı (classification confirm) → CaseRecord
  → AI Model Router (capability + scenario policy)
       ├─ X-Ray Vision (mock)     ├─ CT 3D (mock)
       ├─ MRI (mock)              └─ Multimodal VLM (mock)
       └─ (opsiyonel) HttpRemoteVision
  → Structured Findings + Evidence (normalize / fuse)
  → LLM Gateway + Optional RAG → Draft Report (+ rag_citations)
  → Report Validator (yapısal)
  → Veteriner radyolog incelemesi (approve / reject / revision)
  → Onaylı rapor
```

### Adım adım (kod yolları)

| # | Aşama | Nerede |
|---|--------|--------|
| 1 | Upload | `POST /api/v1/dicom/upload` veya `/demo/{kind}` → `DicomService`; doküman için `POST /api/v1/documents/upload` |
| 2 | Quarantine | `storage/quarantine.py` → `backend/data/quarantine/{ingest_id}/` + `manifest.json` |
| 3 | Parse / sniff | `dicom/parser.py`, `dicom/validator.py`; `ingest/filetype.py`, `ingest/documents.py` |
| 4 | Classify | `dicom/classifier.py` → `ClassificationSuggestion` |
| 5 | Confirm → Case | `POST .../ingestions/{id}/confirm` → `classification_confirmed=True`, `ImagingModelInput` |
| 6 | Analyze gate | `CaseService._assert_analyzable()` |
| 7 | Route | `routing/model_router.py` + `routing/scenario_policy.py` |
| 8 | Vision | `models/mock_vision.py` registry; opsiyonel `models/http_vision.py` |
| 9 | Fuse | `models/normalizer.py` → `StructuredFindings` |
| 10 | LLM + RAG | `llm/gateway.py` + `rag/*` → draft + `rag_citations` |
| 11 | Validate | `validation/report_validator.py` → `AWAITING_REVIEW` |
| 12 | Review | `POST /api/v1/cases/{id}/review` → `APPROVED` / reject / revision |

**Analyze modları:**

- Sync: `POST /api/v1/cases/{id}/analyze` (istek içinde orchestrator)
- Async: `POST /api/v1/cases/{id}/analyze/async` → job enqueue → `GET /api/v1/jobs/{job_id}` poll

Unsupported modality/region → `MANUAL_REVIEW`, AI draft üretilmez. Failed adapter → `analiz_basarisiz` benzeri outcome; onaylanabilir draft yok.

---

## 3. Depo düzeni

```text
veteriner/
├── README.md
├── ARCHITECTURE.md          ← bu dosya
├── package.json             # dev, build, typecheck, backend:dev, backend:test
├── vite.config.ts           # /api → http://127.0.0.1:8000
├── index.html
├── tailwind.config.js
├── tsconfig.json
├── vercel.json
├── public/
├── scripts/                 # build-share.mjs vb.
├── src/                     # React UI
│   ├── App.tsx              # Router + rol Gate
│   ├── main.tsx
│   ├── types.ts
│   ├── pages/               # Ekranlar
│   ├── components/          # Layout, DicomViewer, RagCitations, …
│   ├── context/AppContext.tsx
│   ├── lib/
│   │   ├── backend.ts       # FastAPI client
│   │   ├── auth.ts          # Demo localStorage + JWT saklama
│   │   ├── caseMapper.ts
│   │   ├── dicomPreview.ts
│   │   └── …
│   └── data/mock.ts         # Yerel seed vakalar / KB
└── backend/
    ├── README.md
    ├── .env.example
    ├── requirements.txt
    ├── requirements-optional.txt   # redis, rq, psycopg
    ├── pytest.ini
    ├── docker-compose.yml          # Postgres 16 + Redis 7
    ├── data/                       # runtime (gitignore): sqlite, quarantine, rag_index
    ├── scripts/mock_vision_server.py
    ├── app/                        # FastAPI uygulama
    └── tests/                      # pytest
```

---

## 4. Backend mimarisi

### 4.1 Composition root

| Dosya | Rol |
|-------|-----|
| `app/main.py` | `create_app()`: CORS, router mount, `GET /api/v1/health` |
| `app/container.py` | `AppContainer`: repo, quarantine, RAG, router, modeller, LLM, orchestrator, jobs, auth |
| `app/settings.py` | `load_settings()` — tüm `VETMIND_*` env okuması |

Uygulama girişi: `uvicorn app.main:app --port 8000`.

### 4.2 Paketler

| Paket | Amaç |
|-------|------|
| `api/` | HTTP router’lar: `auth`, `cases`, `analysis`, `reports`, `dicom`, `documents`, `rag`; `deps.py` |
| `auth/` | JWT / API key (`security.py`), `require_auth` / `require_capability`, `rbac.py` |
| `services/` | `CaseService`, `DicomService`, `DocumentService`; `repository.py` Protocol + factory; `sqlite_repository.py`, `postgres_repository.py` |
| `storage/` | `QuarantineStore` |
| `dicom/` | ingest, parser, validator, classifier, fixtures, placeholder |
| `ingest/` | dosya türü sniff, doküman metin çıkarma |
| `routing/` | capability tablosu, `ModelRouter`, `ScenarioRoutingPolicy` |
| `models/` | `ImagingModel` protokolü, mock Vision registry, HTTP remote, model input builder, normalizer |
| `orchestration/` | `AIOrchestrator.run()` |
| `llm/` | gateway + mock / stub provider |
| `rag/` | corpus, lexical retriever, hash embeddings, JSON vector store |
| `validation/` | yapısal report validator |
| `workers/` | `ThreadJobBackend`, `RqJobBackend`, RQ worker entry |
| `schemas/` | Pydantic: case, dicom, documents, findings, report, jobs, rag, enums, model_input |

### 4.3 Orchestrator özeti

`AIOrchestrator` sırası:

1. `ensure_model_input(case)`
2. `ScenarioRoutingPolicy.apply(case, ModelRouter.route(case))`
3. Seçilen model id’leri için adapter `analyze(case)`
4. `normalize_outputs(...)` → structured findings
5. `LLMGateway.generate_draft(...)` (RAG pasajları ile)
6. `ReportValidator.validate(...)`
7. Case / job status güncelleme (`AWAITING_REVIEW`, `UNSUPPORTED`, failed, …)

Gerçek modeller adapter olarak eklenir; orchestrator yeniden yazılmaz.

### 4.4 Vision model registry (mock)

| Model id | Rol |
|----------|-----|
| `mock-brain-mri-v1` | Beyin MR |
| `mock-cervical-mri-v1` | Servikal MR |
| `mock-ct-3d-v1` | Beyin CT |
| `mock-xr-vision-v1` | Toraks XR |
| `mock-multimodal-vlm-v1` | Doküman / multimodal stub |
| `remote-vision-v1` (yapılandırılabilir) | `VETMIND_VISION_ENDPOINT` set ise `HttpRemoteVisionModel` |

Provenance: findings üzerinde `source_kind` ∈ {`mock`, `real`, `mixed`}.

### 4.5 Kalıcılık (`CaseRepository`)

| Backend | Env | Not |
|---------|-----|-----|
| memory | `VETMIND_STORAGE=memory` | Test / ephemeral |
| sqlite | `sqlite` (varsayılan) | `backend/data/vetmind.sqlite3` — JSON blob’lar |
| postgres | `postgres` | JSONB; `VETMIND_DATABASE_URL` gerekir |

Saklanan başlıca varlıklar: `CaseRecord`, `AnalysisJob`, `DicomIngestionRecord`, `DocumentIngestionRecord`.

### 4.6 Quarantine

- Yerel disk; AV taraması / S3 yoktur.
- Varsayılan kök: `backend/data/quarantine/{ingest_id}/`
- Manifest + dosya hash referansları ingestion ve case üzerinde tutulur.

### 4.7 Jobs

| Backend | Env | Not |
|---------|-----|-----|
| thread | `VETMIND_JOB_BACKEND=thread` | Daemon thread + `VETMIND_ASYNC_DELAY_MS` |
| rq | `rq` | Redis (`VETMIND_REDIS_URL`); worker: `python -m app.workers.rq_worker`; memory storage ile kullanılmaz |

### 4.8 RAG

| Mod | Env | Mekanizma |
|-----|-----|-----------|
| embedding (varsayılan) | `VETMIND_RAG=embedding` | Hash embedding + cosine; `JsonVectorStore` → `data/rag_index.json` |
| lexical | `lexical` | Token overlap; vektör indeks yok |

Seed: `rag/corpus.py`. Admin: `POST /rag/reindex`, `POST /rag/documents`. Draft üzerinde `rag_citations` + `rag_note`.

### 4.9 Auth ve RBAC

Auth **varsayılan kapalı** (`VETMIND_AUTH_ENABLED=0`): principal `demo`, capability `*`.

Açıkken: `Authorization: Bearer <JWT>` ve/veya `X-API-Key`.

| Rol | Özet yetenekler |
|-----|-----------------|
| `demo` / `service` / `admin` | `*` |
| `vet` | cases write/read, analyze, dicom, documents, rag:search |
| `expert` | cases read, analyze, review, rag:search, dicom (demo) |
| `owner` | cases read, rag:search |

Capability sabitleri: `auth/rbac.py` (`cases:write`, `review`, `rag:admin`, …).

Demo kullanıcılar (backend `auth/security.py` + frontend seed): şifre `demo1234`

| E-posta | Rol |
|---------|-----|
| `vet@demo.local` | vet |
| `expert@demo.local` | expert |
| `admin@demo.local` | admin |
| `owner@demo.local` | owner |

---

## 5. API referansı (`/api/v1`)

OpenAPI: http://127.0.0.1:8000/docs

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
| GET | `/cases/{id}/report` | Draft rapor |
| POST | `/cases/{id}/review` | Uzman inceleme |
| POST | `/dicom/upload` | Multipart DICOM → quarantine + sınıflandırma |
| POST | `/dicom/demo/{kind}` | `brain_mri` \| `cervical_mri` \| `brain_ct` \| `thorax_xr` |
| GET | `/dicom/fixtures/{kind}/{index}` | Viewer için `.dcm` indir |
| GET | `/dicom/ingestions/{id}` | Ingestion kaydı |
| POST | `/dicom/ingestions/{id}/confirm` | Sınıflandırma onayı → case |
| POST | `/documents/upload` | PDF/JPG/PNG/text |
| GET | `/documents/ingestions/{id}` | Doküman ingestion |
| POST | `/documents/ingestions/{id}/confirm` | Onay → case |
| GET | `/rag/search?q=&top_k=` | RAG arama |
| POST | `/rag/reindex` | İndeks yenile (admin) |
| POST | `/rag/documents` | Özel pasaj ekle (admin) |

---

## 6. Frontend mimarisi

### 6.1 Çalışma modeli

- Vite dev server `:5173`, `/api` → `:8000` proxy (`vite.config.ts`).
- **Çift katmanlı auth:**
  1. UI oturumu: `src/lib/auth.ts` → localStorage (`vetmind.demo.session`)
  2. API JWT: login/register/rol değişiminde `backendLogin` → `vetmind.backend.jwt`; `src/lib/backend.ts` `Authorization: Bearer` ekler
- Durum: `AppContext` — seed vakalar + backend senkron (`refreshBackendCases`, `hydrateBackendCase`, `caseMapper.ts`).

### 6.2 Rotalar ve roller

| Rota | Sayfa | Roller | Backend kullanımı (özet) |
|------|-------|--------|---------------------------|
| `/giris` | `Login.tsx` | — | `POST /auth/login` |
| `/kayit` | `Register.tsx` | — | localStorage + best-effort JWT |
| `/` | `Dashboard.tsx` | tümü | — |
| `/dicom-yukle` | `DicomUpload.tsx` | vet | upload, confirm, async analyze, fixtures |
| `/vakalar/yeni` | `NewCase.tsx` | vet | create+analyze veya yerel prototip |
| `/vakalar` | `CaseList.tsx` | vet, expert | list / refresh |
| `/vakalar/:id` | `CaseDetail.tsx` | vet, expert | get case, findings, RAG panel |
| `/vakalar/:id/isleme` | `Processing.tsx` | vet, expert | pipeline animasyonu / job bilgisi |
| `/vakalar/:id/inceleme` | `ExpertReview.tsx` | expert | `submitBackendReview` |
| `/kuyruk` | `ReviewQueue.tsx` | expert | kuyruk UI |
| `/raporlar`, `/raporlar/:id` | Report* | vet, owner, expert | onaylı rapor + RAG |
| `/moduller` | `Modules.tsx` | admin | — |
| `/bilgi-tabani` | `KnowledgeBase.tsx` | admin | `rag/search` |
| `/sistem` | `SystemStatus.tsx` | admin | `GET /health` + mock GPU kartları |

Rol gate: `App.tsx` → `<Gate roles={[...]}>`.

### 6.3 Önemli UI bileşenleri

| Bileşen / lib | Amaç |
|---------------|------|
| `DicomViewer.tsx` + `dicomPreview.ts` | Tarayıcıda W/L, dilim, zoom/pan (klinik PACS değil) |
| `RagCitations.tsx` | Backend `rag_citations` gösterimi |
| `AIDisclaimer.tsx` | Klinik olmayan çıktı uyarısı |
| `backend.ts` | Tüm `/api/v1` çağrıları, async poll helper |
| `caseMapper.ts` | Backend record → UI `VetCase` |

---

## 7. Ortam değişkenleri

Kaynak: `backend/app/settings.py` ve `backend/.env.example`.

| Değişken | Varsayılan / not |
|----------|------------------|
| `VETMIND_STORAGE` | `sqlite` \| `memory` \| `postgres` |
| `VETMIND_SQLITE_PATH` | `./data/vetmind.sqlite3` |
| `VETMIND_DATABASE_URL` / `DATABASE_URL` | Postgres DSN |
| `VETMIND_QUARANTINE_ROOT` | `./data/quarantine` |
| `VETMIND_ASYNC_DELAY_MS` | `400` (0–10000) |
| `VETMIND_JOB_BACKEND` | `thread` \| `rq` |
| `VETMIND_REDIS_URL` | RQ için gerekli |
| `VETMIND_RQ_QUEUE` | `vetmind` (worker) |
| `VETMIND_RAG` | `embedding` \| `lexical` |
| `VETMIND_RAG_INDEX_PATH` | `./data/rag_index.json` |
| `VETMIND_VISION_ENDPOINT` | Remote infer URL |
| `VETMIND_VISION_MODEL_ID` | `remote-vision-v1` |
| `VETMIND_VISION_API_KEY` | Opsiyonel Bearer |
| `VETMIND_AUTH_ENABLED` | `0` |
| `VETMIND_API_KEY` | Servis anahtarı |
| `VETMIND_JWT_SECRET` | Demo secret |
| `VETMIND_JWT_TTL_SECONDS` | `43200` |

### Opsiyonel altyapı

```bash
# Postgres + Redis
docker compose -f backend/docker-compose.yml up -d
export VETMIND_STORAGE=postgres
export VETMIND_DATABASE_URL=postgresql://vetmind:vetmind@localhost:5432/vetmind
export VETMIND_JOB_BACKEND=rq
export VETMIND_REDIS_URL=redis://127.0.0.1:6379/0
pip install -r backend/requirements-optional.txt
# terminal A: uvicorn …  |  terminal B: python -m app.workers.rq_worker

# Mock remote Vision
python backend/scripts/mock_vision_server.py   # :8090/infer
export VETMIND_VISION_ENDPOINT=http://127.0.0.1:8090/infer
```

---

## 8. Çalıştırma ve demo

### 8.1 Kurulum

```bash
# Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend (repo kökü)
cd ..
npm install
npm run dev
```

Kök script kısayolları:

| Script | Komut |
|--------|--------|
| `npm run dev` | Vite UI |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run backend:dev` | uvicorn (`.venv`) |
| `npm run backend:test` | pytest |
| `npm run build` | üretim build |

- UI: http://localhost:5173  
- API: http://127.0.0.1:8000/docs  
- Health: http://127.0.0.1:8000/api/v1/health  

### 8.2 Önerilen demo akışı

1. `vet@demo.local` / `demo1234` ile giriş (JWT best-effort).
2. **DICOM Yükle** → Demo Brain MRI / CT / Thorax XR (veya `.dcm` sürükle).
3. Metadata sınıflandırmasını onayla → async mock analiz (poll).
4. **Vakalar → Backend’den yenile** (SQLite kalıcılık).
5. Rolü **Uzman Hekim** yap → incele / onayla (`rag_citations` panelleri).
6. Admin rolü → **Sistem Durumu** (`/health`), **Bilgi Tabanı** (RAG search).

Alternatif: **Yeni Vaka** ile sentetik senaryolar (`ct_brain_suspected`, `xr_thorax_suspected`, `document_context`, …) veya eski yerel prototip pipeline.

---

## 9. Gerçek vs mock / uzatma noktaları

| Gerçek / üretim-şekilli | Mock / demo |
|-------------------------|-------------|
| REST API, Pydantic şemalar, case/job/ingestion kalıcılığı | Klinik bulgu içeriği, piksel tanısı |
| Quarantine (yerel disk) | Virus scan, S3/GCS |
| DICOM **metadata** parse/classify | PACS, klinik piksel arşivi |
| Capability router + orchestrator | Eğitilmiş GPU Vision |
| `ImagingModel` / `LLMProvider` protokolleri | Ücretli veterinary LLM |
| `HttpRemoteVisionModel` HTTP sözleşmesi | Varsayılan mock Vision çıktıları |
| Hash-embedding RAG + JSON indeks | sentence-transformers, Qdrant/pgvector |
| JWT + API key + RBAC | OAuth/SSO; UI localStorage auth |
| Thread / opsiyonel RQ | Celery / K8s autoscaled workers |
| PDF/text extract stub, browser viewer | OCR, klinik PACS viewer |
| SQLite / Postgres JSON store | Tam ilişkisel klinik şema |

**Birincil swap-in dosyaları:**

- Vision: `models/mock_vision.py`, `models/http_vision.py`
- LLM: `llm/mock_provider.py`, `llm/interfaces.py`
- RAG: `rag/embedding_retriever.py`, `rag/vector_store.py`
- Repo: `services/repository.py` (+ sqlite/postgres)
- Jobs: `workers/job_backend.py`
- Wiring: `container.py` (yalnızca bağlama)

---

## 10. Test stratejisi

Konum: `backend/tests/`. Fixture: `conftest.py` — memory repo, tmp quarantine, `TestClient`.

| Dosya | Odak |
|-------|------|
| `test_api.py` | HTTP smoke |
| `test_schemas.py` | Pydantic sözleşmeler |
| `test_validator.py` | Report validator |
| `test_hardening_p0.py` | Güvenlik / sertleştirme |
| `test_dicom.py` | Parse, ingest, classifier, upload/confirm |
| `test_ct_xr.py` | CT/XR fixture + API |
| `test_documents.py` | Doküman ingest |
| `test_quarantine.py` | Quarantine store |
| `test_model_input.py` | ImagingModelInput |
| `test_router.py` | ModelRouter + scenario policy |
| `test_orchestrator.py` | Pipeline outcome’ları |
| `test_mock_vision.py` | Mock adapter’lar |
| `test_http_vision.py` | Remote HTTP adapter |
| `test_llm.py` | LLM gateway |
| `test_rag.py`, `test_embedding_rag.py`, `test_vector_store.py` | RAG |
| `test_async_analyze.py` | Async analyze |
| `test_persistence.py` | SQLite kalıcılık |
| `test_postgres_repo.py` | Postgres (URL gerekir) |
| `test_auth.py`, `test_rbac.py` | JWT + RBAC |
| `test_ai_contracts.py` | Registry, multi-model, provenance |

```bash
cd backend && pytest
# Postgres:
VETMIND_DATABASE_URL=postgresql://vetmind:vetmind@localhost:5432/vetmind \
  pytest tests/test_postgres_repo.py -q
```

---

## 11. Yaşam döngüsü durumları (özet)

Backend enum’lar (`schemas/enums.py`) üzerinden tipik akış:

```text
CREATED / AWAITING_CLASSIFICATION_CONFIRMATION
  → classification confirm
  → ANALYZING (job RUNNING)
  → AWAITING_REVIEW  |  MANUAL_REVIEW (unsupported)  |  failed
  → APPROVED  (uzman approve sonrası)
```

Rapor: draft → validation → `AWAITING_REVIEW` → `APPROVED` (veya reject / revision).

Frontend `caseStatusMap.ts` backend durumlarını UI etiketlerine (`uzman_incelemesi`, `onaylandi`, …) map eder.

---

## 12. Güvenlik ve uyumluluk notları (demo)

- Varsayılan auth kapalıdır; demo için uygundur, internete açık deploy için **uygun değildir**.
- JWT secret ve demo şifreler sabit / bilinen değerlerdir.
- Frontend hesapları localStorage’da **düz metin** şifre ile tutulur (yalnızca demo).
- Quarantine yerel diskte; silme politikası / AV / şifreleme yok.
- AI çıktıları tanı değildir; UI disclaimer’ları bilinçli olarak bırakılmıştır.

---

## 13. Olası sonraki adımlar

1. Gerçek şirket Vision / GPU serving (`HttpRemoteVision` yerine veya üzerinde).
2. Sentence-transformers + Qdrant / pgvector.
3. OAuth / SSO IdP.
4. K8s / managed queue ve object storage quarantine.
5. Daha zengin ilişkisel klinik şema (Postgres JSONB’den çıkış).

---

## 14. Hızlı dosya indeksi

| İhtiyaç | Dosya |
|---------|--------|
| App factory | `backend/app/main.py` |
| DI / wiring | `backend/app/container.py` |
| Env | `backend/app/settings.py`, `backend/.env.example` |
| Pipeline | `backend/app/orchestration/orchestrator.py` |
| DICOM | `backend/app/dicom/*`, `backend/app/services/dicom_service.py` |
| Cases API | `backend/app/api/cases.py`, `services/case_service.py` |
| Auth | `backend/app/auth/*` |
| UI router | `src/App.tsx` |
| API client | `src/lib/backend.ts` |
| Demo auth | `src/lib/auth.ts` |
| Case state | `src/context/AppContext.tsx` |

---

*Bu belge proje ile birlikte güncellenmelidir. Davranış çelişkisi varsa kaynak kod (`container.py`, `orchestrator.py`, API router’lar) esas alınır.*
