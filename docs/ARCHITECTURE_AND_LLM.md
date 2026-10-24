# VetMind AI — Sistem Mimarisı, LLM/AI Pipeline ve Eksikler

> **Sürüm:** Backend `0.2.0` · Bitirme projesi prototipi (CSE 401/402 · VRM Teknoloji)  
> **Tarih:** 2026-10-22  
> **Uyarı:** Bu sistem klinik üretim değildir. Varsayılan Vision/LLM çıktıları `MOCK` / `SYNTHETIC` etiketlidir; otonom tanı koymaz. Uzman veteriner radyolog onayı zorunludur.

Bu belge, şu ana kadarki **ürün mimarisini**, **AI/LLM pipeline’ını**, **mock ↔ gerçek adapter modelini** ve **bilinçli eksikleri** tek yerde toplar.

İlgili belgeler:

| Belge | Amaç |
|--------|------|
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Genel ürün mimarisi, API, depo, demo |
| [docs/PHASE_1_1_AND_2.md](PHASE_1_1_AND_2.md) | DICOM 1.1 + vaka yönetimi (ödeme yok) |
| [docs/audits/01_AI_ARCHITECTURE.md](audits/01_AI_ARCHITECTURE.md) | AI güvenlik/swap-in audit bulguları (F1–F14) |
| [docs/audits/02_DICOM_PHASE1_AUDIT.md](audits/02_DICOM_PHASE1_AUDIT.md) | Phase 1 DICOM audit |
| [backend/README.md](../backend/README.md) | Backend env / API özeti |
| [backend/.env.example](../backend/.env.example) | Ortam değişkeni şablonu |

---

## 1. Sistem bağlamı

VetMind AI, **multimodal / multi-model AI destekli veteriner teleradyoloji** platformunun bitirme prototipidir.

**Ne yapar (hedef ürün):**

1. DICOM / doküman yükleme ve karantina  
2. Tür / modalite / bölge sınıflandırması + kullanıcı onayı  
3. Capability tabanlı model routing  
4. Vision adapter(lar) → yapılandırılmış bulgular  
5. Fusion / normalizasyon  
6. RAG destekli LLM taslak rapor  
7. Yapısal rapor doğrulama  
8. Uzman inceleme (approve / reject / revision)

**Ne yapmaz (bilinçli sınır):**

- Eğitilmiş klinik Vision / VLM modeli yok (varsayılan: fixture mock)  
- Ücretli / üretim LLM zorunlu değil (varsayılan: mock provider)  
- PACS / DICOMweb entegrasyonu yok  
- Piksel seviyesinde çıkarım yok (`metadata_only=True`)  
- Klinik validasyon bayrağı validator tarafından engellenir  

---

## 2. Katmanlı genel mimari

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

| Katman | Teknoloji | Konum |
|--------|-----------|--------|
| Frontend | React 18, TS, Vite, Tailwind, React Router | `src/` |
| API | FastAPI, Pydantic | `backend/app/api/` |
| Composition root | `AppContainer` | `backend/app/container.py` |
| Kalıcılık | memory \| sqlite (default) \| postgres JSON(B) | `backend/app/services/repository.py` |
| Karantina | yerel disk + SHA256 + manifest | `backend/app/storage/quarantine.py` |
| Jobs | Thread (default) veya RQ + Redis | `backend/app/workers/` |
| Auth | Opsiyonel JWT HS256 + API key + RBAC | `backend/app/auth/` |

**Mimari desen:** Modular monolith. Bağımlılıklar `AppContainer`’da birleşir; HTTP katmanı ince kalır.

---

## 3. Uçtan uca veri akışı

```text
Upload (DICOM / PDF-JPG-PNG-Text / synthetic demo)
  → QuarantineStore          (byte’lar diskte; SHA256 + manifest)
  → Parse / sniff            (pydicom metadata; document extract)
  → Classifier               (species / modality / body region önerisi)
  → Kullanıcı confirm        → CaseRecord (classification_confirmed=True)
  → ImagingModelInput        (metadata paketi; pixel auth özeti)
  → Analyze (sync | async)
       AIOrchestrator.run()
         1. ModelRouter.route(case)
         2. ScenarioRoutingPolicy.apply(...)
         3. ModelExecutionPolicy.apply(...)   # exclusive_real | mixed
         4. ImagingModel.analyze × N
         5. normalize_outputs (fusion)
         6. LLMGateway.generate_draft (+ RAG)
         7. ReportValidator.validate
  → Case status: AWAITING_REVIEW | MANUAL_REVIEW | FAILED | …
  → Expert review → APPROVED / reject / revision
```

### Kod yolları (özet)

| # | Aşama | Dosya / endpoint |
|---|--------|------------------|
| 1 | Upload | `POST /api/v1/dicom/upload`, `/demo/{kind}`, `POST /api/v1/documents/upload` |
| 2 | Quarantine | `storage/quarantine.py` → `backend/data/quarantine/{ingest_id}/` |
| 3 | Parse | `dicom/parser.py`, `ingest/filetype.py`, `ingest/documents.py` |
| 4 | Classify | `dicom/classifier.py` |
| 5 | Confirm → Case | `POST .../ingestions/{id}/confirm` |
| 6 | Analyze gate | `CaseService._assert_analyzable()` |
| 7 | Route | `routing/model_router.py` + `scenario_policy.py` + `execution_policy.py` |
| 8 | Vision | `models/mock_vision.py` (+ opsiyonel `models/http_vision.py`) |
| 9 | Fuse | `models/normalizer.py` |
| 10 | LLM + RAG | `llm/gateway.py` + `rag/*` |
| 11 | Validate | `validation/report_validator.py` |
| 12 | Review | `POST /api/v1/cases/{id}/review` |

**Analyze modları:**

- **Sync:** `POST /api/v1/cases/{id}/analyze`  
- **Async:** `POST /api/v1/cases/{id}/analyze/async` → job → `GET /api/v1/jobs/{job_id}`

Unsupported → `MANUAL_REVIEW`, AI draft yok. Adapter failure → draft yok / onaylanamaz.

---

## 4. AI / LLM mimarisi (detay)

### 4.1 Orchestrator

**Sınıf:** `AIOrchestrator` — `backend/app/orchestration/orchestrator.py`  
**Metot:** `run(case, job) -> PipelineResult`

Sıra:

1. `case.model_input` yoksa `build_imaging_model_input(case, capabilities=router.list_capabilities())`  
2. Route → scenario policy → execution policy  
3. Her seçilen adapter için `analyze(case)`; `ImagingAdapterError` yakalanır  
4. `normalize_outputs(...)`  
5. Outcome `UNSUPPORTED` / `FAILED` değilse `LLMGateway.generate_draft`  
6. LLM hatalarında **mock fallback yok** — pipeline fail  
7. `ReportValidator.validate`; status / job outcome set edilir  

Adapter’lar case’i mutate etmez; `require_model_input(case)` okur. Input yazma sorumluluğu orchestrator’dadır.

### 4.2 Routing ve registry

```text
CaseRecord
  → ModelRouter.route          # capability match (modality/region/species)
  → ScenarioRoutingPolicy      # demo senaryoları (UNSUPPORTED, CONFLICTING, …)
  → ModelExecutionPolicy       # exclusive_real (default) | mixed
  → model_registry[model_id].analyze
```

| Bileşen | Dosya | Rol |
|---------|--------|-----|
| `ModelCapability` | `routing/capabilities.py` | modality, region, species, priority, `source_kind`, `allows_pixel_analysis` |
| `default_capabilities()` | aynı | Mock adapter yetenek matrisi |
| `ModelRouter` | `routing/model_router.py` | Eşleşme; yoksa `manual-review` |
| `ScenarioRoutingPolicy` | `routing/scenario_policy.py` | Demo senaryo override |
| `ModelExecutionPolicy` | `routing/execution_policy.py` | REAL eşleşince mock’ları düşürme |
| `remote_capability_from_settings` | `routing/remote_config.py` | Env’den REAL capability |
| `validate_registry_capabilities` | `routing/registry_validation.py` | Startup tutarlılık (F8) |

### 4.3 Vision katmanı

**Protokol:** `ImagingModel` — `backend/app/models/interfaces.py`  
`analyze(case) -> StructuredFindings`

#### Mock registry (`default_model_registry`)

| `model_id` | Sınıf | Amaç |
|------------|--------|------|
| `mock-brain-mri-v1` | `MockBrainMriModel` | Beyin MR fixture |
| `mock-brain-mri-alt-v1` | `MockBrainMriAltModel` | Çatışma demosu |
| `mock-cervical-mri-v1` | `MockCervicalMriModel` | Servikal MR |
| `mock-ct-3d-v1` | `MockCt3dModel` | CT 3D |
| `mock-xr-vision-v1` | `MockXrVisionModel` | X-Ray |
| `mock-multimodal-vlm-v1` | `MockMultimodalVlmModel` | Multimodal VLM stub |
| `manual-review` | `ManualReviewStub` | Desteklenmeyen rota |

Mock’lar: `source_kind=MOCK`, `Finding.synthetic=True`, senaryo fixture’ları.

#### Remote (üretim şekilli, eğitilmiş model değil)

- `HttpRemoteVisionModel` — `models/http_vision.py`  
- Wire: `RemoteVisionResponse` (strict `execution_status`)  
- Env ile açılır: `VETMIND_VISION_ENDPOINT` + zorunlu modalities/regions  
- Yerel test sunucusu: `backend/scripts/mock_vision_server.py`  
- Sync `httpx`, sabit timeout; retry/backoff yok (**F14 açık**)

#### Model input ve pixel politikası

- `ImagingModelInput` — `schemas/model_input.py`  
- Builder: `models/model_input_builder.py`  
- Pixel: `models/pixel_authorization.py` — **default-deny**; yetki ≠ piksel yükleme  
- Bugün hiçbir capability `allows_pixel_analysis=True` değil  

#### Fusion

- `normalize_outputs`, `detect_potential_conflicts` — `models/normalizer.py`  
- Evidence UID doğrulama: `models/evidence_validation.py`  
- Çatışma tespiti hâlâ büyük ölçüde location string’e dayalı (**F9 açık**)

### 4.4 LLM katmanı

```text
StructuredFindings
  → LLMGateway.generate_draft
       → RagRetriever.retrieve(query)
       → build_generation_input(...)   # minimal DTO, CaseRecord değil
       → LLMProvider.generate(LLMRequest)
  → DraftReport (+ rag_citations, GenerationMetadata)
```

| Parça | Dosya |
|-------|--------|
| Gateway | `llm/gateway.py` |
| Protocol / DTO / hatalar | `llm/interfaces.py` |
| Factory | `llm/factory.py` |
| Mock | `llm/mock_provider.py` |
| Deterministic stub | `llm/stub_provider.py` |
| HTTP | `llm/http_provider.py` |

**Provider seçimi (`VETMIND_LLM_PROVIDER`):**

| Değer | Sınıf | Davranış |
|-------|--------|----------|
| `mock` (default) | `MockLLMProvider` | Şablon taslak; `source_kind=MOCK` |
| `stub` / `deterministic` | `DeterministicStubLLMProvider` | Deterministik test çıktısı |
| `http` | `HttpLLMProvider` | `VETMIND_LLM_ENDPOINT` zorunlu; VetMind wire contract |
| `openai` / `ollama` / `vllm` / … | `OpenAICompatibleProvider` | Gerçek model, Chat Completions + JSON şema |
| `anthropic` | `AnthropicProvider` | Gerçek model (Claude), zorunlu tool call |

Gerçek sağlayıcılar, prompt ve grounding doğrulaması: [LLM_KATMANI.md](LLM_KATMANI.md).

**Güvenlik tasarımı (F11/F12):**

- Dışarıya tam `CaseRecord` gitmez → `LLMGenerationInput` (opaque `case_id`, findings, RAG)  
- Typed hatalar: timeout / malformed / unavailable / config  
- Orchestrator LLM fail’de mock’a düşmez  

### 4.5 RAG katmanı

**Protokol:** `RagRetriever.retrieve(query, top_k=4)`

| Backend | Sınıf | Env |
|---------|--------|-----|
| Embedding (default) | `EmbeddingRagRetriever` + `JsonVectorStore` | `VETMIND_RAG=embedding` |
| Lexical | `LexicalRagRetriever` | `VETMIND_RAG=lexical` |

- Embedding: `HashEmbeddingBackend` (hashed n-gram; torch yok)  
- Corpus: `rag/corpus.py` (`SEED_CORPUS`)  
- API: `GET /rag/search`, `POST /rag/reindex`, `POST /rag/documents`  

**Klinik kural:** RAG klinik kanıt sayılmaz. Validator `clinically_validated=True` engeller; draft’ta `rag_note` uyarısı vardır. Skor/note semantiği kısmen yanıltıcı kalabilir (**F13 açık**).

### 4.6 Rapor validasyonu

`ReportValidator` — `validation/report_validator.py`

Kontroller (yapısal):

- Bölümler boş olmamalı  
- Finding ID atıfları tutarlı olmalı  
- `clinically_validated=True` yasak  
- MOCK/MIXED uyarıları  
- `no_findings_returned` vs findings listesi çelişkisi  

Validasyon fail → `ReportStatus.VALIDATION_FAILED`; orchestrator outcome `PARTIAL` olabilir, yine de review kuyruğuna düşebilir.

### 4.7 Provenance modeli

| Alan | Anlam |
|------|--------|
| `source_kind` | `MOCK` \| `REAL` \| `MIXED` |
| `Finding.synthetic` | Mock/fixture çıktısı (default False; mock’lar True set eder) |
| `GenerationMetadata` | LLM provider/model/version + source_kind |
| `rag_citations` | Bilgi tabanı pasajları; klinik kanıt değil |

---

## 5. Mock vs gerçek swap-in matrisi

| Katman | Varsayılan (demo) | Gerçek şekilli swap-in | Gerçek klinik üretim |
|--------|-------------------|-------------------------|----------------------|
| Vision | Mock fixture sınıfları | `HttpRemoteVisionModel` + vendor endpoint | Eğitilmiş, validate edilmiş model + pixel pipeline |
| Routing | Mock capabilities | + remote capability env | Capability registry + SLA |
| Execution | Sadece mock | `exclusive_real` mock’ları gizler | Multi-model policy / ensemble |
| LLM | `MockLLMProvider` | `HttpLLMProvider` | Vendor LLM + privacy + audit |
| RAG | Hash cosine / lexical seed | Aynı adapter yüzeyi | Gerçek embed + vector DB |
| Pixels | Yok (`metadata_only`) | Authz iskeleti var | Decode, de-ID, GPU serve, audit |
| Jobs | Thread delay | RQ + Redis | Kuyruk, retry, DLQ, observability |

---

## 6. Frontend mimarisi (AI ile ilgili)

| Ekran / modül | Davranış |
|---------------|----------|
| `Landing.tsx` | Public pazarlama ana sayfa (oturumsuz `/`) |
| `Login` / `Register` | Demo oturum + opsiyonel backend JWT |
| `DicomUpload` | Upload → confirm → `analyzeCaseAsyncAndWait` |
| `NewCase` | `backend` modu gerçek API; `local` modu tarayıcı içi sahte pipeline |
| `Processing` | Backend job varsa gerçek outcome adımları; yoksa `pipeline.ts` fiction |
| `CaseDetail` | Findings, draft, `RagCitations` |
| `ExpertReview` | failed/unsupported/validation_failed’da approve engeli; `submitBackendReview` |
| `KnowledgeBase` | Canlı `searchRag` |
| `SystemStatus` | Health + kısmen mock GPU/queue kartları |

**Risk:** `src/lib/pipeline.ts` içindeki “Qdrant / 768-dim / token/s” katmanları **yerel demo fiction**’ıdır; backend gerçekliğiyle karıştırılmamalıdır.

---

## 7. Ortam değişkenleri (AI odaklı)

Kaynak: `backend/app/settings.py`

### Vision

| Env | Açıklama |
|-----|----------|
| `VETMIND_VISION_ENDPOINT` | HTTP Vision açar |
| `VETMIND_VISION_MODEL_ID` | Default `remote-vision-v1` |
| `VETMIND_VISION_API_KEY` | Opsiyonel Bearer |
| `VETMIND_VISION_EXECUTION_POLICY` | `exclusive_real` \| `mixed` |
| `VETMIND_VISION_MODALITIES` | Endpoint varken **zorunlu** CSV (`MR,CT`) |
| `VETMIND_VISION_REGIONS` | Endpoint varken **zorunlu** CSV (`BRAIN,THORAX`) |
| `VETMIND_VISION_SPECIES` | Opsiyonel CSV; boş = tümü |
| `VETMIND_VISION_PRIORITY` | Default `1` |
| `VETMIND_VISION_ENABLED` | Default açık |
| `VETMIND_VISION_SOURCE_KIND` | Default `real` |

### LLM

| Env | Açıklama |
|-----|----------|
| `VETMIND_LLM_PROVIDER` | `mock` \| `stub` \| `http` \| `openai` \| `ollama` \| `anthropic` |
| `VETMIND_LLM_ENDPOINT` | `http` için zorunlu |
| `VETMIND_LLM_PROVIDER_ID` | Wire metadata |
| `VETMIND_LLM_MODEL_ID` | Wire metadata |
| `VETMIND_LLM_MODEL_VERSION` | Wire metadata |
| `VETMIND_LLM_API_KEY` | Opsiyonel |
| `VETMIND_LLM_TIMEOUT_S` | Default `30` |
| `VETMIND_LLM_REPORT_LANGUAGE` / `_TEMPERATURE` / `_MAX_TOKENS` / `_JSON_MODE` | Bkz. [LLM_KATMANI.md](LLM_KATMANI.md) |

### RAG / Jobs / Storage / Auth

| Env | Default / not |
|-----|----------------|
| `VETMIND_RAG` | `embedding` \| `lexical` |
| `VETMIND_RAG_INDEX_PATH` | JSON vector index yolu |
| `VETMIND_JOB_BACKEND` | `thread` \| `rq` |
| `VETMIND_REDIS_URL` | RQ için |
| `VETMIND_STORAGE` | `sqlite` \| `memory` \| `postgres` |
| `VETMIND_AUTH_ENABLED` | Default kapalı |

Health: `GET /api/v1/health` → `rag`, `job_backend`, `vision_endpoint`, `vision_execution_policy`, `llm_provider`, `mode`.

---

## 8. Şu ana kadar tamamlananlar

### Mimari / güvenlik (audit)

| ID | Durum | Özet |
|----|--------|------|
| F1 | ✅ | HTTP Vision status strict; unknown → error |
| F2 | ✅ | `exclusive_real` ile REAL+mock karışımı engeli |
| F3 | ✅ | Remote capability env ile açıkça tanımlanır |
| F5 | ✅ | Adapter case mutate etmez; frozen model input |
| F6 | ✅ | Evidence DICOM UID / frame alanları + validasyon |
| F7 | ✅ | `synthetic` default False; provenance tutarlı |
| F8 | ✅ | Registry↔capability startup check |
| F10 | ✅ | Pixel authorization default-deny iskeleti |
| F11 | ✅ | LLM settings-swappable (`mock`/`stub`/`http`) |
| F12 | ✅ | Minimal LLM DTO + typed errors + no silent fallback |

### Ürün yetenekleri

- Modular monolith + typed schemas  
- DICOM quarantine + metadata parse + browser viewer  
- Sync/async analyze + job poll  
- Multi-mock vision family + conflict demo  
- HTTP Vision / HTTP LLM adapter yüzeyi  
- RAG (hash embedding veya lexical) + admin API  
- Expert review gate (approve/reject/revision)  
- Opsiyonel JWT + API key + RBAC  
- SQLite / Postgres kalıcılık seçenekleri  
- Geniş pytest kapsamı (`backend/tests/`)  
- Public landing + rol bazlı UI  

---

## 9. Eksikler ve açık riskler

### 9.1 Açık audit maddeleri

| ID | Severity | Eksik | Etki |
|----|----------|--------|------|
| **F4** | P2 | Case create/confirm sırasında `build_imaging_model_input` çoğu yerde router capabilities almadan çağrılıyor; orchestrator yalnızca `model_input is None` iken rebuild ediyor | Stale `prepared_for_models` → remote model hazırlık listesinde olmayabilir |
| **F9** | P2 | Conflict detection location-string ağırlıklı | Gerçek modellerde false negative/positive |
| **F13** | P2 | RAG skor/note semantiği; citation↔finding bağlama zayıf | Grounding yanıltıcı görünebilir |
| **F14** | P2 | Vision/LLM HTTP sync, sabit timeout, retry/idempotency yok | Geçici 503’lerde kırılganlık |

### 9.2 Klinik / ürün boşlukları

| Alan | Durum | Not |
|------|--------|-----|
| Eğitilmiş Vision / VLM | ❌ | Sadece mock + HTTP adapter yüzeyi |
| Piksel inference | ❌ | Authz var, decode/serve yok |
| Klinik validasyon | ❌ | Validator bilinçli engeller |
| PACS / DICOMweb | ❌ | Yok |
| HL7 / FHIR | ❌ | Yok |
| Gerçek embedding modeli | ❌ | Hash n-gram; sentence-transformers yok |
| Managed vector DB | ❌ | JSON store; Qdrant/pgvector yok |
| Multi-tenant izolasyon | ❌ | Yok |
| OAuth / SSO | ❌ | Demo auth |
| Quarantine AV / encryption-at-rest | ❌ | Yerel disk |
| Observability | ❌ | Tracing, drift, model version prod monitor yok |
| Tam manuel rapor ürün yolu | ⚠️ | Unsupported’ta draft yok; UI’da tam manuel yazar akışı sınırlı |
| Frontend local vs backend AI | ⚠️ | `pipeline.ts` fiction karışıklık riski |
| `.env.example` / ARCHITECTURE §7 senkronu | ⚠️ | LLM/Vision env’leri settings’e göre gecikebilir |

### 9.3 Regülasyon / güven

- AI çıktısı tanı değildir; UI disclaimer’lar var ama yasal/regulatory paket yok  
- RAG lisans / kaynak uyumu üretim için ayrı politika ister  
- Retention, legal hold, audit trail (kim neyi ne zaman onayladı) kısmi  

---

## 10. Önerilen sonraki adımlar (öncelik)

### Kısa vade (prototipi sertleştir)

1. **F4:** Confirm/create yollarında `capabilities=router.list_capabilities()` geçirmek veya analyze öncesi stale input refresh  
2. **F13:** RAG note/score dürüstlüğü; embedding backend’i response note’una yansıtmak  
3. **F14:** Paylaşılan HTTP policy (timeout + sınırlı retry + typed hard-fail)  
4. Frontend’de `local` pipeline’ı net “demo fiction” etiketiyle ayırmak  
5. `.env.example` + ARCHITECTURE env tablosunu `settings.py` ile eşitlemek  

### Orta vade (gerçek model denemesi)

1. Vendor Vision wire’ını `HttpRemoteVisionModel` ile bağlamak (capability matrix env)  
2. Vendor LLM’i `HttpLLMProvider` wire’ına map etmek (veya ince adapter)  
3. Conflict detection’ı kod + series/SOP anchor’a taşımak (**F9**)  
4. RQ job + Redis ile uzun süren analyze’i HTTP request dışına almak  

### Uzun vade (klinik üretim — şu an kapsam dışı)

1. Validate edilmiş görüntü modelleri + piksel pipeline + de-ID  
2. Gerçek embeddings + vector DB + citation policy  
3. PACS, SSO, encryption, observability, multi-tenant  
4. Klinik validasyon süreci ve `clinically_validated` yaşam döngüsü  

---

## 11. Anahtar dosya haritası

```text
backend/app/
├── container.py                 # DI / composition root
├── settings.py                  # Tüm VETMIND_* env
├── orchestration/orchestrator.py
├── routing/
│   ├── capabilities.py
│   ├── model_router.py
│   ├── scenario_policy.py
│   ├── execution_policy.py
│   ├── remote_config.py
│   └── registry_validation.py
├── models/
│   ├── interfaces.py
│   ├── mock_vision.py
│   ├── http_vision.py
│   ├── model_input_builder.py
│   ├── pixel_authorization.py
│   ├── normalizer.py
│   └── evidence_validation.py
├── llm/
│   ├── gateway.py
│   ├── interfaces.py
│   ├── factory.py
│   ├── mock_provider.py
│   ├── stub_provider.py
│   └── http_provider.py
├── rag/
│   ├── retriever.py
│   ├── embedding_retriever.py
│   ├── embeddings.py
│   ├── vector_store.py
│   └── corpus.py
├── validation/report_validator.py
├── services/case_service.py
└── schemas/                     # findings, report, model_input, rag, enums

src/
├── pages/Landing.tsx            # Public ana sayfa
├── pages/Processing.tsx
├── pages/ExpertReview.tsx
├── pages/KnowledgeBase.tsx
├── lib/backend.ts
├── lib/caseMapper.ts
├── lib/pipeline.ts              # ⚠ yerel fiction timeline
└── components/RagCitations.tsx
```

---

## 12. Tek cümlelik özet

VetMind AI bugün **üretim şekilli adapter’lar ve güvenli mock provenance** ile çalışan bir **teleradyoloji AI pipeline prototipidir**; varsayılan inference senaryolaştırılmış mock’tur, gerçek klinik Vision/LLM/PACS/piksel yolu henüz yoktur ve açık sertleştirme maddeleri **F4, F9, F13, F14** ile dokümante ürün boşluklarıdır.

---

*Bu belge kod durumuna göre güncellenmelidir. Audit detayları için `docs/audits/01_AI_ARCHITECTURE.md` kaynak kabul edilir.*
