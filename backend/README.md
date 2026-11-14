# VetMind AI Backend

Veteriner teleradyoloji bitirme projesi — FastAPI backend.

Klinik sistem değildir: gerçek Vision AI / VLM, ücretli LLM veya DICOM piksel tanısı yoktur (remote Vision endpoint opsiyonel iskelettir). Mock çıktılar `MOCK` / `SYNTHETIC` etiketlidir.

## Gerçek vs mock

| Gerçek | Mock / ertelenmiş |
|--------|-------------------|
| Case / job / report / review API | Klinik bulgu içeriği |
| Quarantine disk store (local) | Virus scan / prod object store |
| Versiyonlu Pydantic sözleşmeleri | Paid veterinary LLM |
| Capability tabanlı Model Router (MR/CT/XR/VLM) | Embedding modelleri (sentence-transformers) |
| Orchestrator + Report Validator | Qdrant / vektör DB |
| Lexical + hash-embedding RAG | — |
| HTTP Vision adapter iskeleti | Eğitilmiş GPU model |
| DICOM metadata ingest (pydicom) | PACS / piksel arşivi |
| PDF/text extract + image caption stub | OCR |
| Async analyze (threading demo) | Celery / RQ / K8s worker |
| SQLite / PostgreSQL JSON store | Full clinical relational schema |
| Optional JWT + API key + RBAC | OAuth / SSO IdP |
| Thread / optional RQ jobs | K8s autoscaled workers |
| JSON vector store (on-disk) | Qdrant / pgvector |

## Kurulum

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Optional Vision (PyTorch / MONAI)

Default demo does **not** install or import torch. For local Vision inference workers:

```bash
pip install -r requirements-vision.txt
# CPU torch example (if needed):
# pip install torch --index-url https://download.pytorch.org/whl/cpu
```

Configure via `.env` (`VETMIND_LOCAL_TORCH_*`, see `.env.example`). Entrypoints:

| Modality | Entrypoint |
|----------|------------|
| XR | `app.models.entrypoints.xray_monai:build_entrypoint` |
| CT | `app.models.entrypoints.ct_monai:build_entrypoint` |
| MRI | `app.models.entrypoints.mri_monai:build_entrypoint` |

Pretrained chest X-ray demo (human-data TorchXRayVision DenseNet121, not veterinary-validated):

```bash
.venv/bin/python scripts/export_xray_model.py   # writes ../artifacts/vet-xr-thorax-v1/model.pt, prints SHA-256
cd .. && npm run backend:dev:vision             # backend with Ollama LLM + this XR model
```

Full Turkish guide: root `README.md` §4.5.

Offline training lives under repo-root `ml/` (never imported by FastAPI by default).

- API: http://127.0.0.1:8000  
- OpenAPI: http://127.0.0.1:8000/docs  
- Health: http://127.0.0.1:8000/api/v1/health

### Ortam değişkenleri

| Değişken | Anlam |
|----------|--------|
| (see `.env.example`) | Tüm env anahtarları örnek dosyada |
| `VETMIND_STORAGE=sqlite` | Varsayılan; `backend/data/vetmind.sqlite3` |
| `VETMIND_STORAGE=memory` | Geçici (testler) |
| `VETMIND_STORAGE=postgres` | PostgreSQL JSONB (`VETMIND_DATABASE_URL` gerekir) |
| `VETMIND_DATABASE_URL` / `DATABASE_URL` | örn. `postgresql://vetmind:vetmind@localhost:5432/vetmind` |
| `VETMIND_SQLITE_PATH` | Özel SQLite yolu |
| `VETMIND_QUARANTINE_ROOT` | Karantina kökü |
| `VETMIND_ASYNC_DELAY_MS` | Async analyze yapay gecikme |
| `VETMIND_RAG=embedding\|lexical` | Varsayılan `embedding` |
| `VETMIND_VISION_ENDPOINT` | Remote Vision HTTP URL (opsiyonel) |
| `VETMIND_VISION_MODEL_ID` | Remote model id |
| `VETMIND_VISION_API_KEY` | Bearer for remote Vision |
| `VETMIND_AUTH_ENABLED=1` | JWT / API key zorunlu |
| `VETMIND_API_KEY` | `X-API-Key` değeri |
| `VETMIND_JWT_SECRET` | HS256 secret |
| `VETMIND_JOB_BACKEND=thread\|rq` | Varsayılan `thread` |
| `VETMIND_REDIS_URL` | RQ için Redis URL |
| `VETMIND_RAG_INDEX_PATH` | JSON vektör indeks dosyası |

### Türkçe rapor taslağında anatomi sözlüğü

`VETMIND_REPORT_ANATOMY_DICTIONARY_PATH` değişkenine sağlanan
`VetMind_AI_Search_Dictionary.json` dosyasının tam yolunu verin. Uygulama sözlüğü
başlangıçta yükler. Bu ayar tek başına kedi ve köpeklerin beyin/servikal MR
vakalarında yalnızca sentetik bulgularla gösterim yapar. Sözlük yolu
tanımlanmadığında mevcut rapor akışı kullanılır.

Görüntü modelinin konumu sözlükteki bir arama etiketiyle bütün olarak
eşleşmelidir. Eşleştirme büyük/küçük harf ve boşluk farklarını tolere eder.
Belirsiz adaylar, birden fazla kayda giden etiketler ve eşleşmeyen ayrıntılı
konumlar özgün konum olarak kalır. Türkçe taslağa çıkan doğrulanabilir
eşleşmeler, raporun `generation.anatomy_terminology` alanında bulgu kimliği,
özgün konum, Türkçe etiket, varsa bulunma hâli ve sözlük sürümüyle kaydedilir.
Raporun bulgu atfı, kaynak görüntüye bağlı olan yapılandırılmış bulguyu gösterir.
Metin üreten sağlayıcı Türkçe etiketi ve varsa bulunma hâlini girdi olarak
alır. Genel HTTP rapor sağlayıcısı kullanılıyorsa, uzak servisin ilgili
bulgudaki `anatomy_term` alanını ve rapor talimatını kullanması gerekir.

**Uzman incelemesinden sonra canlı taslaklar.** Veteriner radyolog, her
kayıt için tercih edilen Türkçe etiketi, arama biçimlerini ve bulunma hâlini
inceler. Onaylanan kimlikler ve cümle içindeki biçimleri, aşağıdaki yapıya
sahip bir JSON dosyasına yazılır. Örnekteki kimlik ve ifade biçimi göstermek
içindir. Değerleri gerçek incelemeden sonra girin.

```json
{
  "dictionary_sha256": "<sözlük dosyasının SHA-256 özeti>",
  "reviewed_by": "<inceleyen veteriner radyoloğun kimliği>",
  "terms": {
    "VM-BBBF7A6412D6": "beyinde"
  }
}
```

PowerShell'de dosyanın SHA-256 özetini alın ve onay dosyasının yolunu ortam
değişkenine yazın. Sözlüğü ve onay dosyasını yeniden yüklemek için sunucuyu ve
varsa ayrı rapor işleyicisini yeniden başlatın.

```powershell
$env:VETMIND_REPORT_ANATOMY_DICTIONARY_PATH = 'C:/VetMind/VetMind_AI_Search_Dictionary.json'
(Get-FileHash -Algorithm SHA256 $env:VETMIND_REPORT_ANATOMY_DICTIONARY_PATH).Hash.ToLowerInvariant()
$env:VETMIND_REPORT_ANATOMY_APPROVALS_PATH = 'C:/VetMind/approved_anatomy.json'
```

Canlı eşleştirme yalnızca onay dosyasındaki uygun anatomi kayıtlarını kullanır.
Bir sözlük güncellemesi dosya özetini değiştirir ve yeni sürüm için onay
dosyası gerekir. Üretilen rapor veteriner radyolog incelemesine sunulan bir
taslaktır.

### PostgreSQL + Redis (opsiyonel)

```bash
docker compose -f docker-compose.yml up -d
export VETMIND_STORAGE=postgres
export VETMIND_DATABASE_URL=postgresql://vetmind:vetmind@localhost:5432/vetmind
# Optional RQ:
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
python scripts/mock_vision_server.py   # :8090/infer
export VETMIND_VISION_ENDPOINT=http://127.0.0.1:8090/infer
```

### Test

```bash
pytest
# Postgres entegrasyonu:
VETMIND_DATABASE_URL=postgresql://vetmind:vetmind@localhost:5432/vetmind pytest tests/test_postgres_repo.py -q
```

## API özeti

| Method | Path | Amaç |
|--------|------|------|
| GET | `/api/v1/health` | Canlılık |
| POST | `/api/v1/auth/login` | Demo JWT |
| GET | `/api/v1/auth/status` | Auth açık mı? |
| GET | `/api/v1/auth/me` | Principal |
| POST/GET | `/api/v1/cases` | Vaka |
| POST | `/api/v1/cases/{id}/analyze` | Senkron pipeline |
| POST | `/api/v1/cases/{id}/analyze/async` | Thread worker → 202 |
| GET | `/api/v1/jobs/{id}` | Job durumu |
| GET | `/api/v1/rag/search?q=` | RAG arama |
| POST | `/api/v1/rag/reindex` | Seed indeks yenile (admin) |
| POST | `/api/v1/rag/documents` | Özel pasaj ekle (admin) |
| POST | `/api/v1/dicom/upload` | DICOM → quarantine |
| POST | `/api/v1/dicom/demo/{brain_mri\|cervical_mri\|brain_ct\|thorax_xr}` | Fixture |
| POST | `/api/v1/documents/upload` | PDF/JPG/PNG/text |
| GET | `/api/v1/cases/{id}/findings` | Structured findings |
| GET | `/api/v1/cases/{id}/report` | Draft |
| POST | `/api/v1/cases/{id}/review` | Uzman inceleme |

## Mimari notlar

1. Modular monolith; `CaseRepository` → memory / sqlite / postgres.
2. Remote Vision: `HttpRemoteVisionModel` + env endpoint; yoksa mock registry.
3. RAG: hash-embedding cosine (varsayılan) veya lexical.
4. Auth kapalıyken RBAC no-op; açıkken JWT/API key + capability checks
   (`review` → expert/admin, `cases:write` → vet/admin, …).
5. Provenance: `source_kind` (`mock` / `real` / `mixed`).
6. Jobs: thread (varsayılan) veya RQ+Redis (sqlite/postgres ile).

## Sonraki olası adımlar

1. Gerçek şirket Vision / GPU serving (mock Vision HTTP yerine).
2. Sentence-transformers + Qdrant/pgvector.
3. OAuth/SSO IdP.
4. K8s / managed queue.
