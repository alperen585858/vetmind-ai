# Yapay zeka / dil modeli / veri gelince nasıl bağlanır?

> **Basit kılavuz.** Gerçek model eğitmez. Sadece “elimize gelince ne yaparız?” sorusuna cevap verir.  
> Teknik derinlik: [PHASE_20_FINAL_AI_READINESS.md](PHASE_20_FINAL_AI_READINESS.md) · [LLM_KATMANI.md](LLM_KATMANI.md) · [HEDEF_MIMARI_GAP_ISSUE_LISTESI.md](HEDEF_MIMARI_GAP_ISSUE_LISTESI.md)

**Şu an varsayılan:** sahte (mock) görüntü AI + sahte dil modeli + demo metinler. Klinik sistem değildir.

Örnek ayarlar: [`backend/.env.example`](../backend/.env.example)  
Örnek istek/cevap JSON: [`backend/fixtures/integration/`](../backend/fixtures/integration/)

---

## 1) Görüntü AI (Vision) geldiğinde

1. Karşı tarafa `backend/fixtures/integration/vision_request.example.json` ve `vision_response.example.json` formatını verin.
2. `backend/.env` içine yazın:

```bash
VETMIND_VISION_ENDPOINT=http://SUNUCU:PORT/infer
VETMIND_VISION_MODEL_ID=remote-vision-v1
VETMIND_VISION_API_KEY=...          # varsa
VETMIND_VISION_MODALITIES=MR,CT,XR
VETMIND_VISION_REGIONS=BRAIN,SPINE,THORAX
VETMIND_VISION_SPECIES=canine,feline
VETMIND_VISION_EXECUTION_POLICY=exclusive_real
```

3. `exclusive_real` = bağlantı bozulursa **sessizce sahte modele dönülmez**; analiz hata verir. Bu bilinçli.
4. Vaka oluştururken / DICOM onayında **analiz izni** (`imaging_analysis_consent_verified`) işaretli olsun.
5. Kontrol: `GET /api/v1/models/readiness` ve `GET /api/v1/health` → `vision_endpoint: true`, `mode` artık sadece `mock` olmamalı.
6. Piksel (ham görüntü) yolu varsayılan **kapalı** (`VETMIND_PIXEL_ANALYSIS_OPT_IN=0`). Açmak ayrı güvenlik/etik onayı + capability gerektirir; mock adapter pikselleri analiz etmez.

**HTTP yeniden deneme:** Vision POST `retry=0` (bilinçli). Geçici 503’te yeniden deneme yok; karşı servisi sağlam tutun.

---

## 2) Dil modeli (LLM) geldiğinde

### A) Hazır ChatGPT / Ollama / Anthropic

```bash
# Örnek Ollama (yerel, ücretsiz deneme)
VETMIND_LLM_PROVIDER=ollama
VETMIND_LLM_MODEL_ID=qwen2.5:14b
VETMIND_LLM_ENDPOINT=http://127.0.0.1:11434/v1

# Örnek OpenAI uyumlu
# VETMIND_LLM_PROVIDER=openai
# VETMIND_LLM_MODEL_ID=gpt-4o-mini
# VETMIND_LLM_API_KEY=sk-...

# Örnek Anthropic
# VETMIND_LLM_PROVIDER=anthropic
# VETMIND_LLM_API_KEY=sk-ant-...
```

Deneme (backend klasöründen):

```bash
VETMIND_LLM_PROVIDER=ollama VETMIND_LLM_MODEL_ID=qwen2.5:14b python scripts/llm_demo.py
```

### B) Kendi HTTP servisiniz

Wire format: `backend/fixtures/integration/llm_request.example.json` / `llm_response.example.json`

```bash
VETMIND_LLM_PROVIDER=http
VETMIND_LLM_ENDPOINT=http://SUNUCU:PORT/draft
VETMIND_LLM_API_KEY=...
```

Cevapta mümkünse `used_passage_ids` gönderin — sadece gerçekten kullanılan bilgi bankası parçaları “alıntı” gösterilir. Yoksa sistem eski davranışla uyarır (“hepsi retrieve edildi, hangisi kullanıldı bilinmiyor”).

Bağlı LLM hata verirse **sahte taslağa düşülmez**.

---

## 3) Bilgi bankası (metin / KB) geldiğinde

1. Tek tek: `POST /api/v1/rag/documents` (admin yetkisi).
2. Toplu: JSONL dosyası + script:

```bash
cd backend
python scripts/rag_bulk_ingest.py path/to/docs.jsonl
# veya API: POST /api/v1/rag/documents/bulk
```

JSONL satır örneği:

```json
{"title":"Kaynak adı","section":"Bölüm","passage":"Metin...","keywords":["disk","ivdd"],"approved":false}
```

- `approved` varsayılan **false**. “Onaylı klinik kaynak” iddiası ancak siz `true` yazınca görünür; yine de klinik kanıt sayılmaz.
- Embedding şu an hash tabanlı yerel JSON indeks. Gerçek embedding modeli gelince aynı arayüzden değiştirilebilir (Qdrant ayrı iş).

Doktor red/düzeltme kayıtları: `GET /api/v1/feedback` / export — model gelince eğitim sinyali buradan alınır.

Uzman inceleme UI: **`/vakalar/:id/calisma`** (RadiologistWorkspace). `/inceleme` yalnızca redirect.

---

## 3b) Belge OCR (JPEG/PNG) stub

Wire format: `backend/fixtures/integration/document_ocr_request.example.json` / `document_ocr_response.example.json`

```bash
VETMIND_DOCUMENT_OCR_ENDPOINT=http://SUNUCU:PORT/ocr
# VETMIND_DOCUMENT_OCR_TIMEOUT_S=30
```

Endpoint yoksa JPEG/PNG yalnızca caption stub metni üretir — klinik transkripsiyon iddiası yok.

---

## 3c) Retention (admin)

Dry-run: `GET /api/v1/admin/retention/plan` · Apply (onaylı): `POST /api/v1/admin/retention/apply`  
Env: `VETMIND_RETENTION_DICOM_DAYS`, `VETMIND_RETENTION_REPORTS_DAYS`, `VETMIND_RETENTION_TEMP_HOURS`, `VETMIND_RETENTION_LOGS_DAYS` (`backend/.env.example`).

---

## 3d) Async jobs (RQ + Redis)

Varsayılan: `VETMIND_JOB_BACKEND=thread`. Ölçek için:

```bash
# Terminal 1 — deps
cd backend && docker compose up -d redis   # veya postgres+redis
# Terminal 2 — API
VETMIND_JOB_BACKEND=rq VETMIND_REDIS_URL=redis://127.0.0.1:6379/0 \
  .venv/bin/uvicorn app.main:app --reload
# Terminal 3 — worker (opsiyonel paketler: requirements-optional.txt)
VETMIND_JOB_BACKEND=rq VETMIND_REDIS_URL=redis://127.0.0.1:6379/0 \
  .venv/bin/python -m app.workers.rq_worker
```

Smoke: `pytest tests/test_rq_job_backend_smoke.py` — Redis yoksa `skip`.

Pixel decode: `VETMIND_PIXEL_ANALYSIS_OPT_IN=1` + capability `allows_pixel_analysis` (varsayılan kapalı).

Manuel rapor (AI draft yok): `POST /api/v1/cases/{id}/report/manual-init` → `source_kind=manual`.

---

## 4) Gerçek hasta verisi gelmeden önce güvenlik

Demo (varsayılan):

```bash
VETMIND_DEPLOYMENT_MODE=demo
VETMIND_AUTH_ENABLED=0
```

Korumalı (gerçek veri / staging):

```bash
VETMIND_DEPLOYMENT_MODE=protected
VETMIND_AUTH_ENABLED=1
VETMIND_JWT_SECRET=uzun-rastgele-gizli-deger
# VETMIND_ENCRYPTION_AT_REST=none   # şimdilik yalnız "none" — başka değer programı başlatmaz
```

- Korumalı modda giriş **zorunlu**.
- “Şifreleme açık” yazıp implementasyon yoksa sunucu **açılmaz** (yalancı güvenlik yok).
- Korumalıda zararlı yazılım taraması zorunlu bayrağı açıksa tarayıcı yoksa **yükleme reddedilir**.

---

## 5) İlk gerçek modele giden 8 adım (Phase 20)

Bunlar `GET /api/v1/models/readiness` → `remaining_steps_to_first_real_model` ile aynıdır:

1. `source_kind=real` kaydı — etik/hukuk onayı sonrası  
2. `weights_path` veya `endpoint_url` (gizli anahtar repoya konmaz)  
3. Ön işleme profili: `profile.mri_volume` / `ct_volume` / `xray_2d`  
4. CT için açık pencere değerleri (sessiz klinik preset yok)  
5. Vaka izinleri: kaynak + analiz onayı  
6. Çoklu DICOM birleştirme + seri seçimi (`/cases/{id}/model-input`)  
7. Analyze IntegrationBridge yoluyla; hatalarda sahte bulgu yok  
8. Onaylı rapor değişmez + uzman onayı zorunlu  

---

## 6) Hızlı kontrol listesi

| Kontrol | Nasıl |
|--------|--------|
| Sağlık | `GET /api/v1/health` — `mode`, `llm_provider`, `vision_endpoint` |
| Model hazır mı? | `GET /api/v1/models/readiness` |
| Testler | `cd backend && .venv/bin/pytest` |
| Korumalı E2E | `E2E_PROTECTED=1 npx playwright test --project=e2e-protected` |
| Uzun iş iptal | `POST /api/v1/jobs/{job_id}/cancel` (işbirlikçi; LLM sonrası taslak atılır) |

---

## Ne bu kılavuzun dışında?

Eğitilmiş klinik model, PACS, gerçek antivirüs motoru, disk şifreleme implementasyonu, hastane SSO, site görsel redesign.
