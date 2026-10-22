# VetMind AI Backend

Veteriner teleradyoloji bitirme projesi — FastAPI backend.

Klinik sistem değildir: gerçek Vision AI / VLM, ücretli LLM veya DICOM piksel tanısı yoktur. Mock çıktılar `MOCK` / `SYNTHETIC` etiketlidir.

## Gerçek vs mock

| Gerçek | Mock / ertelenmiş |
|--------|-------------------|
| Case / job / report / review API | Vision / VLM çıkarımı |
| Versiyonlu Pydantic sözleşmeleri | Klinik bulgu içeriği |
| Capability tabanlı Model Router | Gerçek LLM metni |
| Orchestrator + Report Validator | RAG |
| DICOM metadata ingest (pydicom) | PACS / piksel arşivi |
| SQLite JSON (`CaseRepository`) | PostgreSQL prod |
| Expert review kapıları | Şirket RIS entegrasyonu |

## Kurulum

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

- API: http://127.0.0.1:8000  
- OpenAPI: http://127.0.0.1:8000/docs  
- Health: http://127.0.0.1:8000/api/v1/health (`storage` alanı)

### Depolama

| Ortam değişkeni | Anlam |
|-----------------|--------|
| `VETMIND_STORAGE=sqlite` | Varsayılan; `backend/data/vetmind.sqlite3` |
| `VETMIND_STORAGE=memory` | Geçici (testler bunu kullanır) |
| `VETMIND_SQLITE_PATH=...` | Özel SQLite yolu |

### Test

```bash
pytest
```

## API özeti

| Method | Path | Amaç |
|--------|------|------|
| GET | `/api/v1/health` | Canlılık + storage |
| POST | `/api/v1/cases` | Sentetik vaka |
| GET | `/api/v1/cases` | Liste |
| GET | `/api/v1/cases/{id}` | Detay |
| POST | `/api/v1/cases/{id}/analyze` | Senkron mock pipeline |
| GET | `/api/v1/jobs/{id}` | Tamamlanmış koşu kaydı |
| POST/GET | `/api/v1/cases/{id}/model-input` | AI girdi paketi (`ImagingModelInput`) |
| GET | `/api/v1/cases/{id}/findings` | Structured findings |
| GET | `/api/v1/cases/{id}/report` | Draft (failed/unsupported → 404) |
| POST | `/api/v1/cases/{id}/review` | Uzman inceleme |
| POST | `/api/v1/dicom/upload` | Çoklu DICOM metadata |
| POST | `/api/v1/dicom/demo/{brain_mri\|cervical_mri}` | Sentetik fixture |
| GET | `/api/v1/dicom/ingestions/{id}` | Ingest oturumu |
| POST | `/api/v1/dicom/ingestions/{id}/confirm` | Sınıflandırma onayı → Case |

Analiz **senkron**dur; arka plan kuyruğu yoktur. `job_id` tamamlanmış koşu kimliğidir.

### İnceleme kuralları

- Onay yalnızca geçerli AI draft için.
- Failed / unsupported → onaylanabilir AI draft yok → **409**.
- Validation-failed draft, yeniden doğrulama geçmeden onaylanamaz.

### Mock senaryolar (`CaseCreate.scenario`)

`brain_mri_suspected`, `cervical_mri_suspected`, `no_findings`, `unsupported`, `model_failure`, `conflicting`

## Mimari notlar

1. Modular monolith; broker / K8s yok.
2. `CaseRepository` Protocol — SQLite bugün, PostgreSQL yarın aynı arayüz.
3. DICOM: metadata only; piksel tanı yok.
4. Gerçek Vision: `ImagingModel` + `ImagingAdapterError` + registry + `ModelCapability`.
5. Gerçek LLM: `LLMProvider` → `LLMGateway.set_provider`.
6. Provenance: `source_kind` (`mock` / `real` / `mixed`) korunur.

## Sonraki olası adımlar

1. PostgreSQL (aynı Protocol).
2. Async job (gerçek model süreleri için).
3. Model input contracts + şirket verisi gelince gerçek adapter.
4. Üretim auth (şu an frontend demo localStorage).
