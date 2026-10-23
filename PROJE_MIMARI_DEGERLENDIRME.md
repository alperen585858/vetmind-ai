# VetMind AI — Mimari Özet, İyi Yönler ve Eksikler

> **Proje:** VetMind AI · Veteriner Teleradyoloji Platformu (prototip)  
> **Bağlam:** Acıbadem Üniversitesi CSE 401/402 bitirme projesi · VRM Teknoloji iş birliği  
> **Sürüm:** Backend `0.2.0` · Demo **GO** · Klinik üretim / gerçek AI **NO-GO**  
> **Tarih:** 2026-10-23  

Bu belge, projenin **kimliğini**, **mimari iskeletini**, **güçlü yanlarını** ve **bilinçli / açık eksiklerini** tek bakışta sunar. Derin teknik detay için [ARCHITECTURE.md](ARCHITECTURE.md), AI pipeline için [docs/ARCHITECTURE_AND_LLM.md](docs/ARCHITECTURE_AND_LLM.md), hızlı başlangıç için [README.md](README.md).

**Klinik sistem değildir.** Varsayılan çıktılar `MOCK` / `SYNTHETIC` etiketlidir; otonom tanı koymaz; uzman veteriner radyolog onayı zorunludur.

---

## 1. Proje bilgisi

| Alan | Değer |
|------|--------|
| Amaç | Klinik ↔ uzman teleradyolog arasında AI destekli **karar destek** köprüsü |
| Ürün tipi | Multimodal / multi-model AI teleradyoloji **prototipi** |
| Frontend | React 18 · TypeScript · Vite 5 · Tailwind · React Router 6 |
| Backend | Python 3.11+ · FastAPI · Pydantic · pydicom |
| Kalıcılık | SQLite (varsayılan) · memory · PostgreSQL JSON(B) |
| Jobs | Thread worker (varsayılan) · opsiyonel RQ + Redis |
| Auth | Opsiyonel JWT (HS256) + API key + RBAC + klinik izolasyon |
| Test | Vitest · pytest (~238) · Playwright E2E |

### Hedef iş akışı (ürün vaadi)

1. DICOM / doküman yükleme ve karantina  
2. Tür / modalite / bölge sınıflandırması + kullanıcı onayı  
3. Capability tabanlı model routing  
4. Vision adapter(lar) → yapılandırılmış bulgular  
5. Fusion / normalizasyon  
6. RAG destekli LLM taslak rapor  
7. Yapısal rapor doğrulama  
8. Uzman inceleme (approve / reject / revision) → immutable sürüm → print/PDF  

### Geliştirme fazları (özet)

| Faz | Konu | Sonuç |
|-----|------|--------|
| 1–2 | DICOM ingest, quarantine, sınıflandırma, vaka yönetimi | Stabil |
| 3 | ImagingModelInput, execution policy, job cancel/timeout, LLM DTO | Adapter sözleşmeleri hazır; mock default |
| 4 | Rapor versiyonlama, uzman inceleme, print-to-PDF | Immutable onaylı sürümler |
| 5 | Auth/tenant, quarantine integrity, audit, concurrency | Protected mode kapıları |
| 6 / 6.1 | Sentetik E2E + browser tam klinik workflow | Demo **GO** · klinik **NO-GO** |

---

## 2. Mimari özet

**Desen:** Modular monolith. Tüm bağımlılıklar `backend/app/container.py` (`AppContainer`) composition root’unda birleşir; HTTP katmanı ince router’lardır. Gerçek modeller **adapter** olarak eklenir; orchestrator yeniden yazılmaz.

```text
┌──────────────────────────────┐
│  React UI (Vite :5173)       │  Landing, Login, DICOM viewer,
│  AppContext + backend.ts     │  CaseDetail, ExpertReview, RAG KB
└──────────────┬───────────────┘
               │  /api → proxy
               ▼
┌──────────────────────────────┐
│  FastAPI (:8000) /api/v1/*   │  İnce HTTP + opsiyonel auth
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│  AppContainer (DI root)      │  settings → repo, quarantine,
│                              │  router, models, LLM, RAG, jobs
└──────────────┬───────────────┘
     ┌─────────┼─────────┬────────────────┐
     ▼         ▼         ▼                ▼
 Quarantine  CaseRepo  JobBackend    AIOrchestrator
   disk     mem/sqlite  thread|RQ     Router → Vision → Fusion
            /postgres                 → LLM+RAG → Validator
```


### Backend paket haritası

| Paket | Rol |
|-------|-----|
| `api/` | HTTP: auth, cases, analysis, reports, dicom, documents, rag |
| `auth/` | JWT / API key, RBAC, tenancy |
| `services/` | Case / DICOM / Document servisleri + repository Protocol |
| `storage/` | Quarantine (SHA256 + manifest); encryption/AV iskeleti |
| `dicom/` + `ingest/` | Parse, sınıflandırma, doküman sniff |
| `routing/` | Capabilities, ModelRouter, scenario + execution policy |
| `models/` | Vision Protocol, mock registry, HTTP remote, normalizer |
| `orchestration/` | `AIOrchestrator.run()` |
| `llm/` + `rag/` | Gateway + mock/stub/HTTP; hash veya lexical RAG |
| `validation/` | Yapısal report validator |
| `workers/` | Thread / RQ job backend |
| `security/` | Audit JSONL, retention hooks |
| `schemas/` | Pydantic DTO / enum’lar |

### Frontend (kısa)

- Rol bazlı rotalar (`Gate`): vet, expert, owner, admin  
- Tarayıcı DICOM viewer (W/L, dilim, zoom/pan) — klinik PACS değil  
- Backend senkron: `backend.ts` + `caseMapper.ts` + `AppContext`  
- Provenance banner’ları (DEMO/MOCK vs REAL/MIXED) ve AI disclaimer  

### Swap-in yüzeyi (gerçek modele geçiş için)

| Katman | Demo varsayılan | Gerçek bağlama noktası |
|--------|-----------------|-------------------------|
| Vision | Mock fixture | `HttpRemoteVisionModel` + capability env |
| LLM | `MockLLMProvider` | `HttpLLMProvider` |
| RAG | Hash embedding + JSON indeks | Aynı yüzey → gerçek embed + vector DB |
| Jobs | Thread | RQ + Redis |
| Storage | SQLite JSON | Postgres JSONB / ileride ilişkisel şema |

---

## 3. İyi yönler

### 3.1 Mimari ve mühendislik

| Güçlü yön | Neden önemli |
|-----------|----------------|
| **Modular monolith + DI root** | Bağımlılıklar tek yerde (`AppContainer`); test ve swap-in kolay |
| **Adapter / Protocol sözleşmeleri** | Vision, LLM, repository, job backend değiştirilebilir; orchestrator sabit kalır |
| **Capability + scenario + execution policy** | Routing bilinçli; `exclusive_real` ile REAL+mock sessiz karışımı engellenir |
| **Provenance disiplini** | `source_kind`, `synthetic`, MOCK/SYNTHETIC etiketleri; klinik validasyon bayrağı engellenir |
| **Typed Pydantic şemalar** | Case, findings, report, model_input, jobs — API ve pipeline tutarlı |
| **Quarantine + path sanitization** | Ingest byte’ları izole; SHA256 + manifest; traversal engeli |
| **Rapor yaşam döngüsü** | Append-only versiyonlama; onayda immutable snapshot; reject / revision |
| **Çift analyze modu** | Sync + async job (poll, timeout, cooperative cancel, idempotency alanları) |

### 3.2 Ürün ve demo olgunluğu

| Güçlü yön | Neden önemli |
|-----------|----------------|
| **Uçtan uca klinik akış** | Yükle → sınıflandır → analiz → bulgular → uzman onay → PDF |
| **Browser DICOM viewer** | Demo’da görsel kanıt; dilim / W/L etkileşimi |
| **Rol ayrımı (UX + backend RBAC)** | Vet / expert / owner / admin senaryoları anlatılabilir |
| **RAG + citations UI** | Taslak raporun “kaynaklı” görünmesi (klinik kanıt sayılmaz uyarısıyla) |
| **Health / System Status** | Demo’da altyapı bayrakları görünür |
| **Sentetik fixture seti** | Brain MRI, Cervical MRI, Brain CT, Thorax XR — ağ / PACS olmadan demo |

### 3.3 Kalite ve güvenlik temeli

| Güçlü yön | Neden önemli |
|-----------|----------------|
| **Geniş test yüzeyi** | Vitest + pytest + Playwright (pozitif + negatif senaryolar) |
| **AI audit döngüsü** | F1–F14 dokümante; kritik maddelerin çoğu kapatılmış |
| **Protected deployment kapıları** | Auth zorunlu, tenant izolasyon, fail-closed ayarlar |
| **Audit JSONL** | Auth açık yolculuklarda güvenlik olayları |
| **Pixel default-deny** | Piksel yolu bilinçli kapalı; yetkisiz inference yok |
| **LLM fail’de sessiz mock fallback yok** | Hata gizlenmez; draft güvenilirliği korunur |
| **Dürüst GO/NO-GO** | Demo GO, klinik/gerçek AI NO-GO — abartısız readiness |

### 3.4 Dokümantasyon

| Güçlü yön | Neden önemli |
|-----------|----------------|
| Faz belgeleri (1–6.1) | Bitirme sunumu ve iş birliği için izlenebilir tarihçe |
| ARCHITECTURE + AI eksik belgesi | Mimari ve boşluklar ayrıntılı |
| Audit klasörü | Kararlar ve düzeltmeler kayıt altında |
| `.env.example` + backend README | Ortam kurulumunu hızlandırır |

---

## 4. Eksikler

İki grup: (A) **bilinçli ertelenmiş** ürün sınırları, (B) **açık teknik / operasyonel** riskler.

### 4.1 Bilinçli ürün sınırları (şimdilik yok)

| Eksik | Açıklama |
|-------|----------|
| Eğitilmiş klinik Vision / VLM | Varsayılan: fixture mock; piksel analizi yok (`metadata_only`) |
| Ücretli / üretim LLM | Varsayılan `MockLLMProvider` |
| PACS / DICOMweb | Entegrasyon yok |
| OCR | Doküman metin stub |
| Gerçek embedding + vector DB | Hash n-gram + JSON indeks; sentence-transformers / Qdrant yok |
| OAuth / SSO | Demo localStorage + opsiyonel JWT |
| Celery / K8s workers | Thread veya RQ |
| Encryption-at-rest / malware AV | Env bayrakları var; gerçek entegrasyon yok |
| Klinik validasyon | Validator `clinically_validated=True` engeller |
| HL7 / FHIR, ödeme / faturalama | Kapsam dışı |
| Observability (tracing, drift, model monitor) | Üretim izleme yok |

Frontend rol kapıları **yalnızca UX**’tir. Gerçek veya korumalı veri için backend auth zorunludur.

### 4.2 Açık audit / teknik maddeler (P2)

| ID | Eksik | Etki |
|----|--------|------|
| **F4** | `build_imaging_model_input` bazı yollarda canlı router capabilities almadan çağrılabilir | Remote model `prepared_for_models` listesinde eksik kalabilir |
| **F9** | Conflict detection ağırlıklı olarak location-string | Gerçek modellerde false negative / positive |
| **F13** | RAG skor/note semantiği; citation↔finding bağlama zayıf | Grounding yanıltıcı görünebilir |
| **F14** | Vision/LLM HTTP sync, sabit timeout; retry/idempotency yok | Geçici 503’lerde kırılganlık |

### 4.3 Mimari / UX zayıf noktaları

| Alan | Durum | Not |
|------|--------|------|
| Kalıcılık modeli | JSON(B) blob | Hızlı prototip için iyi; zengin ilişkisel klinik şema yok |
| Quarantine | Yerel disk | S3 / object storage + AV yok |
| Multi-tenant | Kısmi | Tenant izolasyon var; tam SaaS izolasyonu değil |
| Manuel rapor yolu | Sınırlı | Unsupported’ta AI draft yok; tam manuel yazar akışı zayıf |
| Frontend local pipeline | ⚠️ | Eski `pipeline.ts` fiction ile backend AI karışma riski |
| Regülasyon paketi | Yok | Disclaimer var; yasal/regulatory süreç depo dışında |

### 4.4 Readiness matrisi

| Hedef | Karar |
|-------|--------|
| Demo / bitirme sunumu | **GO** |
| Sentetik veri ile iç test | **GO** |
| Korumalı klinik veri deploy | **NO-GO** |
| Gerçek AI model bağlantısı (üretim) | **NO-GO** |

---

## 5. Önerilen sonraki adımlar (öncelik)

### Kısa vade — prototipi sertleştir

1. **F4:** Confirm/create yollarında canlı capabilities geçirmek veya analyze öncesi stale input yenilemek  
2. **F13:** RAG note/score dürüstlüğü; citation semantiğini netleştirmek  
3. **F14:** Paylaşılan HTTP politikası (timeout + sınırlı retry + typed hard-fail)  
4. Frontend’de yerel fiction pipeline’ı net “demo only” etiketiyle ayırmak  
5. Env / dokümantasyon senkronunu `settings.py` ile eşitlemek  

### Orta vade — gerçek model denemesi

1. Vendor Vision’ı HTTP adapter + capability matrix ile bağlamak  
2. Vendor LLM’i `HttpLLMProvider` ile map etmek  
3. Conflict detection’ı kod + series/SOP anchor’a taşımak (**F9**)  
4. RQ + Redis ile uzun analyze’i HTTP dışına almak  

### Uzun vade — klinik üretim (kapsam dışı)

1. Validate edilmiş görüntü modelleri + piksel pipeline + de-ID  
2. Gerçek embeddings + vector DB + citation politikası  
3. PACS, SSO, encryption, AV, observability, multi-tenant  
4. Klinik validasyon ve regülasyon süreci  

---

## 6. Tek bakışta özet

| | |
|---|---|
| **Ne?** | Adapter’lı, provenance-bilinçli veteriner teleradyoloji **AI pipeline prototipi** |
| **İyi yönü** | Uçtan uca demo akışı, sağlam DI/adapter mimarisi, rapor yaşam döngüsü, geniş test + dürüst NO-GO |
| **Eksik yönü** | Gerçek Vision/LLM/PACS/piksel yok; üretim güvenliği (AV, encryption, SSO) ve açık P2 audit maddeleri |
| **Sonuç** | Bitirme / demo için hazır; klinik karar desteği olarak kullanılamaz |

---

## 7. İlgili belgeler

| Belge | Amaç |
|-------|------|
| [README.md](README.md) | Hızlı başlangıç, demo, API özeti |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Genel mimari derinliği |
| [docs/ARCHITECTURE_AND_LLM.md](docs/ARCHITECTURE_AND_LLM.md) | AI/LLM pipeline + eksik detayı |
| [docs/PHASE_6_END_TO_END_READINESS.md](docs/PHASE_6_END_TO_END_READINESS.md) | GO / NO-GO readiness |
| [docs/audits/01_AI_ARCHITECTURE.md](docs/audits/01_AI_ARCHITECTURE.md) | AI audit F1–F14 |
| [backend/README.md](backend/README.md) | Backend env / API kısa özet |

Davranış çelişkisi varsa kaynak kod esas alınır (`container.py`, `orchestrator.py`, API router’lar).

---

*Son güncelleme: 2026-10-23 · Backend `0.2.0` · Phase 6 / 6.1 demo readiness*
