# VetMind AI — Mimari ve Proje Dokümantasyonu

> **Sürüm:** Backend `0.2.0` · Bitirme projesi prototipi (CSE 401/402 · VRM Teknoloji)  
> **Uyarı:** Klinik üretim sistemi değildir. Gerçek eğitilmiş Vision AI / VLM, ücretli LLM, PACS veya klinik validasyon yoktur. Mock çıktılar `MOCK` / `SYNTHETIC` etiketlidir; uzman veteriner radyolog onayı zorunludur.

Bu belge, depo yapısını, hedef veri akışını, backend/frontend mimarisini, API’yi, kalıcılığı, güvenlik modelini, yapılandırmayı, demo akışını ve uzatma noktalarını tek yerde toplar.

İlgili kısa belgeler:

- [README.md](README.md) — hızlı başlangıç ve demo
- [docs/ARCHITECTURE_AND_LLM.md](docs/ARCHITECTURE_AND_LLM.md) — sistem + LLM/AI pipeline ve eksikler (detay)
- [docs/README.md](docs/README.md) — `docs/` dizini; tarihsel faz raporları ve denetimler `docs/arsiv/` altında
- [backend/README.md](backend/README.md) — backend env / API özeti
- [backend/.env.example](backend/.env.example) — ortam değişkeni şablonu

---

## 1. Sistem bağlamı

VetMind AI, **multimodal / multi-model AI destekli veteriner teleradyoloji** platformunun bitirme projesi prototipidir. Platform radyoloğa yardımcı olur; otonom tanı koymaz.

| Katman | Teknoloji |
|--------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind, React Router |
| Backend | Python 3.11+, FastAPI, Pydantic, pydicom |
| Kalıcılık | PostgreSQL (varsayılan, Alembic) / SQLite (yerel geliştirme) / memory (testler) |
| Jobs | Thread worker (varsayılan) veya RQ + Redis |
| RAG | bge-m3 anlamsal embedding (varsayılan; Ollama yoksa hash) + pgvector (PostgreSQL), veya lexical |
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

Diyagram koddan otomatik üretilir: **[docs/AI_MIMARISI.md](docs/AI_MIMARISI.md)** (varsayılan kurulum; kaynak `backend/app/services/architecture_status.py`, GitHub Action ile güncel tutulur). Çalışan sistemin canlı durumu admin panelinde **AI Mimarisi** sayfasındadır. Analiz adımları `orchestration/progress.py` içindeki `PIPELINE_STAGES` listesini izler; yeni adım ya da modalite eklenince diyagram kendiliğinden değişir.

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
│   ├── App.tsx              # Composition root: providers + feature routes
│   ├── main.tsx
│   ├── types.ts             # Facade → shared/types
│   ├── features/            # Domain ekranları (auth, cases, dicom, …) + routes.tsx
│   ├── shared/              # api, auth, ui, shell, types, demo seedler
│   ├── components/          # Uyumluluk re-export’ları + kalan UI
│   ├── context/AppContext.tsx  # auth / cases / kb / toast birleşimi
│   ├── lib/
│   │   ├── backend.ts       # Facade → shared/api
│   │   ├── auth.ts          # Demo localStorage + JWT saklama
│   │   ├── caseMapper.ts
│   │   ├── dicomPreview.ts
│   │   └── …
│   └── data/mock.ts         # Demo seed facade → shared/demo ve feature demo modülleri
└── backend/
    ├── README.md
    ├── .env.example
    ├── requirements.txt
    ├── requirements-optional.txt   # redis, rq, psycopg
    ├── pytest.ini
    ├── docker-compose.yml          # Redis 7 (Postgres kök compose'da)
    ├── migrations/                 # Alembic şema migration'ları
    ├── data/                       # runtime (gitignore): sqlite, quarantine, rag_index.json
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
| `services/` | `CaseService`, `DicomService`, `DocumentService`; `repository.py` Protocol + factory; `sqlite_repository.py` (`SqlCaseRepository`) |
| `storage/sql.py` | Tek veritabanı bağlantısı (Postgres/SQLite), Alembic migration'larını çalıştırır |
| `storage/` | `QuarantineStore` |
| `dicom/` | ingest, parser, validator, classifier, fixtures, placeholder |
| `ingest/` | dosya türü sniff, doküman metin çıkarma |
| `routing/` | capability tablosu, `ModelRouter`, `ScenarioRoutingPolicy` |
| `models/` | `ImagingModel` protokolü, mock Vision registry, VLM, yerel torch, HTTP remote, model input builder, normalizer |
| `orchestration/` | `AIOrchestrator.run()` |
| `llm/` | gateway + mock / stub / HTTP / OpenAI-uyumlu (Ollama, Gemini …) / Anthropic sağlayıcıları, hakem, KVKK maskeleme |
| `rag/` | corpus, lexical retriever, bge-m3 / hash embedding, pgvector (JSON ve ChromaDB seçenek), kaynak kartları, chunking |
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
| `vlm-vision-v1` | `VETMIND_VLM_ENABLED=1`: genel amaçlı VLM (ör. Gemini) görüntüleri yorumlar; `exclusive_real` politikasında mock'ların yerini alır, veterinerde valide değildir |
| `vet-xr-thorax-v1` (yapılandırılabilir) | `VETMIND_LOCAL_TORCH_*`: yerel PyTorch/MONAI röntgen modeli (insan verisiyle eğitilmiş demo) |
| `remote-vision-v1` (yapılandırılabilir) | `VETMIND_VISION_ENDPOINT` set ise `HttpRemoteVisionModel` |

Provenance: findings üzerinde `source_kind` ∈ {`mock`, `real`, `mixed`}.

### 4.5 Kalıcılık (`CaseRepository`)

| Backend | Env | Not |
|---------|-----|-----|
| postgres (varsayılan) | `VETMIND_STORAGE=postgres` | Bütün store'lar tek veritabanında, JSONB belgeler; şema `backend/migrations` (Alembic) |
| sqlite | `sqlite` | Yerel geliştirme: aynı tablolar tek dosyada |
| memory | `memory` | Test / ephemeral |

Eski SQLite yan dosyalarını ve JSONL kayıtlarını taşımak: `backend/scripts/migrate_sqlite_to_postgres.py` (README §6).

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
| embedding (varsayılan) | `VETMIND_RAG=embedding` | Hash/bge-m3 embedding + cosine; `PgVectorStore` → PostgreSQL `rag_chunks` (#117); PostgreSQL yoksa `data/rag_index.json`; `VETMIND_RAG_STORE=chroma` isteğe bağlı |
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
| `clinic_owner` | cases read, rag:search, clinic manage, dicom (okuma) |

Capability sabitleri: `auth/rbac.py` (`cases:write`, `review`, `rag:admin`, …).

Demo kullanıcılar (backend `auth/security.py` + frontend seed): şifre `demo1234`

| E-posta | Rol |
|---------|-----|
| `vet@demo.local` | vet |
| `expert@demo.local` | expert |
| `admin@demo.local` | admin |
| `clinic-owner@demo.local` | clinic_owner |

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
  1. UI oturumu: `src/shared/auth/session.ts` → localStorage (`vetmind.demo.session`)
  2. API JWT: login/register/rol değişiminde `backendLogin` → `vetmind.backend.jwt`; `src/shared/api/*` `Authorization: Bearer` ekler
- Durum: `AppContext` — seed vakalar + backend senkron (`refreshBackendCases`, `hydrateBackendCase`, `caseMapper.ts`).

### 6.2 Rotalar ve roller

| Rota (TR; EN karşılığı da var) | Sayfa (aksi yazmadıkça `src/features/…`) | Roller | Backend kullanımı |
|------|-------|--------|-------------------|
| `/` | `shared/shell/Landing.tsx` (misafir) / `src/app/Dashboard.tsx` | misafir / tümü | — |
| `/giris`, `/kayit` | `auth/Login.tsx`, `auth/Register.tsx` | — | `POST /auth/login`, `POST /auth/register` (yalnız veteriner, admin onayıyla) |
| `/sifremi-unuttum`, `/sifre-sifirla` | `auth/ForgotPassword.tsx`, `auth/ResetPassword.tsx` | — / tümü | `POST /auth/password/forgot`, `/reset` |
| `/ayarlar` | `auth/Settings.tsx` | vet, expert, clinic_owner, admin | ayarlar, şifre değiştir |
| `/vakalar/yeni` | `cases/NewCase.tsx` | vet | vaka aç → tetkik yükleme (DICOM) → analiz |
| `/vakalar` | `cases/CaseList.tsx` | vet, expert, clinic_owner | liste; `?durum=onaylandi` onaylı raporlar |
| `/vakalar/:id` | `cases/CaseDetailPage.tsx` | vet, expert, clinic_owner | vaka, bulgular, geçmiş, RAG |
| `/vakalar/:id/isleme` | `analysis/Processing.tsx` | vet, expert | job poll |
| `/vakalar/:id/calisma` | `expert/RadiologistWorkspace.tsx` | expert | review submit (+ hydrate) |
| `/vakalar/:id/inceleme` | yönlendirme → `/calisma` | expert | eski bağlantı |
| `/kuyruk`, `/ai-tekrar` | `expert/ReviewQueue.tsx`, `expert/ExpertAiResend.tsx` | expert | kuyruk, AI'ye yeniden gönderme |
| `/raporlar/:id` | `reports/ApprovedReport.tsx` | vet, expert, clinic_owner | onaylı rapor + PDF |
| `/raporlar` | yönlendirme → `/vakalar?durum=onaylandi` | — | eski bağlantı (#81) |
| `/rapor-baglanti` | `reports/ReportLink.tsx` | herkes (bağlantıyla) | paylaşılan rapor |
| `/dicom-yukle` | yönlendirme → `/vakalar/yeni` | — | eski bağlantı (#79); test build'inde eski sayfa |
| `/mesajlar` | `messaging/Messages.tsx` | vet, expert, clinic_owner, admin | mesajlaşma |
| `/ai-dersleri` | `rag-admin/AiLessons.tsx` | expert, admin | `/lessons` |
| `/moduller`, `/bilgi-tabani` | `rag-admin/Modules.tsx`, `rag-admin/KnowledgeBase.tsx` | admin | `rag/*` |
| `/kullanicilar`, `/radyologlarim` | `admin/AdminUsers.tsx`, `admin/AdminRadiologists.tsx` | admin | kullanıcı yönetimi |
| `/sistem`, `/model-performansi` | `admin/SystemStatus.tsx`, `admin/ModelPerformance.tsx` | admin | `GET /health`, değerlendirme sonuçları |

Rotalar her feature'ın `routes.tsx` dosyasında; `src/App.tsx` bunları bağlar. Rol kapısı: `src/shared/shell/routing.tsx` → `<Gate roles={[...]}>`.

### 6.3 Önemli UI bileşenleri

| Bileşen / lib | Amaç |
|---------------|------|
| `src/shared/dicom/DicomViewer.tsx` + `src/shared/lib/dicomPreview.ts` | Tarayıcıda W/L, dilim, zoom/pan (klinik PACS değil) |
| `src/shared/ui/RagCitations.tsx` | Backend `rag_citations` gösterimi |
| `src/shared/api/*` | Domain’lere ayrılmış `/api/v1` istemcisi |
| `src/shared/lib/caseMapper.ts` | Backend record → UI `VetCase` |

### 6.4 Feature modules

Frontend domain modülleri `src/features/<domain>/` altında, paylaşılan kod `src/shared/` altında yaşar.

- Composition root: `src/App.tsx` (providers + route mount).
- Import kuralı: bir feature başka bir feature’ı import etmez; yalnızca `shared/` ve kendi klasörü.
- Domain haritası ve migrasyon kuralları: [docs/modularization.md](docs/modularization.md).

Hedef domain’ler: `auth`, `cases`, `dicom`, `analysis`, `reports`, `expert`, `submissions`, `messaging`, `rag-admin`, `admin`.

---

## 7. Ortam değişkenleri

Kaynak: `backend/app/settings.py` ve `backend/.env.example`.

| Değişken | Varsayılan / not |
|----------|------------------|
| `VETMIND_STORAGE` | `postgres` (varsayılan) \| `sqlite` \| `memory` |
| `VETMIND_DATABASE_URL` / `DATABASE_URL` | Postgres DSN (varsayılan `postgresql://vetmind:vetmind@localhost:5432/vetmind`) |
| `VETMIND_SQLITE_PATH` | `./data/vetmind.sqlite3` (yalnızca `sqlite`) |
| `VETMIND_QUARANTINE_ROOT` | `./data/quarantine` |
| `VETMIND_ASYNC_DELAY_MS` | `400` (0–10000) |
| `VETMIND_JOB_BACKEND` | `thread` \| `rq` |
| `VETMIND_REDIS_URL` | RQ için gerekli |
| `VETMIND_RQ_QUEUE` | `vetmind` (worker) |
| `VETMIND_RAG` | `embedding` \| `lexical` |
| `VETMIND_RAG_STORE` | `auto` (PostgreSQL varsa `pgvector`, yoksa `json`) \| `pgvector` \| `json` \| `chroma` (isteğe bağlı) |
| `VETMIND_CHROMA_PATH` / `VETMIND_CHROMA_URL` | Yalnızca `RAG_STORE=chroma`: `./data/chroma` / — |
| `VETMIND_RAG_INDEX_PATH` | `./data/rag_index.json` (taşıma kaynağı) |
| `VETMIND_VISION_ENDPOINT` | Remote infer URL |
| `VETMIND_VISION_MODEL_ID` | `remote-vision-v1` |
| `VETMIND_VISION_API_KEY` | Opsiyonel Bearer |
| `VETMIND_AUTH_ENABLED` | `0` |
| `VETMIND_API_KEY` | Servis anahtarı |
| `VETMIND_JWT_SECRET` | Demo secret |
| `VETMIND_JWT_TTL_SECONDS` | `43200` |

### Opsiyonel altyapı

```bash
# PostgreSQL (varsayılan depo) + Redis (RQ)
docker compose up -d db
docker compose -f backend/docker-compose.yml up -d
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
2. **Yeni Vaka** → tetkik yükleme adımında `.dcm` sürükle (demo build'inde hazır Brain MRI / CT / Thorax XR örnekleri).
3. Metadata sınıflandırmasını onayla → async mock analiz (poll).
4. **Vakalar → Backend’den yenile** (PostgreSQL kalıcılık).
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
| bge-m3 / hash RAG + pgvector | Klinik onaylı bilgi bankası, reranking |
| JWT + API key + RBAC | OAuth/SSO; UI localStorage auth |
| Thread / opsiyonel RQ | Celery / K8s autoscaled workers |
| PDF/text extract stub, browser viewer | OCR, klinik PACS viewer |
| SQLite / Postgres JSON store | Tam ilişkisel klinik şema |

**Birincil swap-in dosyaları:**

- Vision: `models/mock_vision.py`, `models/http_vision.py`
- LLM: `llm/mock_provider.py`, `llm/interfaces.py`
- RAG: `rag/embedding_retriever.py`, `rag/vector_store.py`
- Repo: `services/repository.py` → `SqlCaseRepository` (`storage/sql.py`)
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
| `test_sql_stores.py`, `test_postgres_app.py` | Bütün store'lar SQLite'ta; `VETMIND_TEST_DATABASE_URL` ile Postgres'te de (CI `backend-postgres` işi) |
| `test_auth.py`, `test_rbac.py` | JWT + RBAC |
| `test_ai_contracts.py` | Registry, multi-model, provenance |

```bash
cd backend && pytest
# Postgres:
VETMIND_TEST_DATABASE_URL=postgresql://vetmind:vetmind@localhost:5432/vetmind_test \
  pytest -m postgres tests/test_sql_stores.py tests/test_postgres_app.py -q
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
| DICOM | `backend/app/dicom/*`, `backend/app/services/dicom_service.py`, `src/features/dicom/` |
| Cases API | `backend/app/api/cases.py`, `backend/app/services/case_service.py` |
| Analysis / reports | `backend/app/services/analysis_application.py`, `backend/app/services/report_application.py` |
| Messaging | `backend/app/services/messaging_facade.py`, `src/features/messaging/api.ts` |
| Auth | `backend/app/auth/*`, `src/shared/auth/` |
| UI router | `src/App.tsx` mounts `src/features/*/routes.tsx` (`src/pages/` removed) |
| Screens | `src/features/`, `src/shared/shell/` |
| API client | `src/shared/api/*` |
| Demo auth | `src/shared/auth/`, `src/shared/auth/session.ts`, seeds `src/shared/demo/users.ts` |
| Demo seeds | `src/shared/demo/`, `src/features/rag-admin/demoKb.ts`, `src/features/admin/demoInfra.ts` |
| Case state | `src/features/cases` (state: `src/shared/shell/AppContext.tsx`) |
| Modularization | `docs/modularization.md` |

---

*Bu belge proje ile birlikte güncellenmelidir. Davranış çelişkisi varsa kaynak kod (`container.py`, `orchestrator.py`, API router’lar) esas alınır.*
