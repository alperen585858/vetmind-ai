# VetMind AI — Hedef Mimari Gap & Issue Listesi

> **Kaynak diyagram:** Hedef pipeline (DICOM/Document Upload → Secure Ingestion → Classifier / Document Processing → Model Router → Vision modelleri → Normalizer / Fusion → Structured Findings → LLM + RAG → Validator → Radiologist Review → Approved Report / Feedback·Audit)  
> **Tarih:** 2026-10-24 · **Senkron:** 2026-10-25  
> **Kod gerçeği:** Backend `0.2.0` · modular monolith · varsayılan çıktılar `MOCK` / `SYNTHETIC`  
> **Verdict:** Diyagramdaki **iskelet** büyük ölçüde mevcut · diyagramdaki **klinik/gerçek AI** katmanları **yok veya stub** · Demo **GO** · Klinik üretim **NO-GO**

Bu belge, fotoğraftaki hedef mimariyi **bileşen bileşen** mevcut kodla karşılaştırır ve tüm açık issue’ları tek listede toplar. Davranış çelişkisinde kaynak kod (`container.py`, `orchestrator.py`, adapter’lar) esas alınır.

**Bağlama kılavuzu (AI/LLM/veri gelince):** [INTEGRATION_PLAYBOOK.md](INTEGRATION_PLAYBOOK.md) · [PHASE_20_FINAL_AI_READINESS.md](PHASE_20_FINAL_AI_READINESS.md)

**2026-10-25 senkron (kod kazanımları):** ISS-CLS-01 hibrit iskelet (metadata + series_hint) · ISS-AUD-01 FeedbackStore · ISS-FUS-01 ontology/laterality · ISS-FE-01 DEMO FICTION etiketleri — aşağıdaki tablolarda **DONE** işaretli.

**2026-10-30 pre-data sprint:** `/calisma` canonical (ExpertReview kaldırıldı) · FE retention dry-run/apply · RAG `approved` + bulk KB UI · DICOM classification override → FeedbackStore · Document OCR adapter stub (`VETMIND_DOCUMENT_OCR_ENDPOINT`) · pixel opt-in dokümante · A/B plug-in yüzeyleri (bulk KB, wire fixtures, protected E2E projesi) **DONE** notu — klinik üretim **BOUNDARY / NO-GO** değişmedi.

İlgili belgeler: [ARCHITECTURE.md](../ARCHITECTURE.md) · [ARCHITECTURE_AND_LLM.md](ARCHITECTURE_AND_LLM.md) · [PROJE_MIMARI_DEGERLENDIRME.md](../PROJE_MIMARI_DEGERLENDIRME.md) · [audits/01_AI_ARCHITECTURE.md](audits/01_AI_ARCHITECTURE.md) · [audits/PHASE_7_DEEP_AUDIT.md](audits/PHASE_7_DEEP_AUDIT.md) · [audits/PHASE_8_SECURITY_ASYNC.md](audits/PHASE_8_SECURITY_ASYNC.md)

---

## 1. Hedef mimari (fotoğraf)

```text
DICOM / Document Upload
        │
        ▼
Secure Ingestion & Storage
        │
        ├──────────────────────────────┐
        ▼                              ▼
DICOM Metadata / Series Parser    Document Processing
        │                              │
        ▼                              │
Hybrid Classification                  │
        │                              │
        ▼                              │
Model Router + Execution Policy        │
        │                              │
   ┌────┼────────┬─────────┐           │
   ▼    ▼        ▼         ▼           │
 MRI   CT     X-Ray   Multimodal       │
Vision Vision Vision     VLM           │
   │    │        │         │           │
   └────┴────────┴─────────┘           │
              │                        │
              ▼                        │
      Output Normalizer                │
              │                        │
              ▼                        │
 Evidence Fusion + Provenance          │
              │                        │
              ▼                        │
      Structured Findings              │
              │                        │
              ▼                        │
                    ┌──────────────────┘
                    ▼
         LLM Orchestrator / Gateway ◄──── RAG Retriever ◄── Approved Knowledge Base
                    │
                    ▼
            Veterinary LLM
                    │
                    ▼
            Report Validator
                    │
                    ▼
          Radiologist Review
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
   Approved Report    Feedback / Audit Store
```

---

## 2. Bileşen eşlemesi (hedef → mevcut)

| # | Hedef bileşen | Mevcut konum | Durum | Özet |
|---|---------------|--------------|-------|------|
| 1 | DICOM / Document Upload | `api/dicom.py`, `api/documents.py`, FE `DicomUpload` | ✅ Kısmi | Upload var; PACS/DICOMweb yok |
| 2 | Secure Ingestion & Storage | `storage/quarantine.py` | ⚠️ Stub güvenli | SHA256+manifest var; AV / encryption-at-rest yok |
| 3 | DICOM Metadata / Series Parser | `dicom/parser.py`, `imaging/series_selection.py` | ✅ Kısmi | Metadata parse + series seçimi; piksel decode üretim yolu kapalı |
| 4 | Hybrid Classification | `dicom/classifier.py` | ✅ İskelet | Metadata + series_hint hibrit sinyal; eğitilmiş vision sınıflandırıcı BOUNDARY |
| 5 | Document Processing | `ingest/documents.py`, `document_service.py` | ⚠️ Stub | PDF/text + optional OCR HTTP stub; tanı yok |
| 6 | Model Router + Execution Policy | `routing/model_router.py`, `scenario_policy.py`, `execution_policy.py` | ✅ İskelet | Capability + exclusive_real çalışır; gerçek model yok |
| 7 | MRI Vision Model | `models/mock_vision.py` (`mock-brain-mri-*`, cervical) | ❌ Mock | Fixture; eğitilmiş MR modeli yok |
| 8 | CT Vision Model | `mock-ct-3d-v1` | ❌ Mock | Fixture; eğitilmiş CT modeli yok |
| 9 | X-Ray Vision Model | `mock-xr-vision-v1` | ❌ Mock | Fixture; eğitilmiş XR modeli yok |
| 10 | Multimodal VLM | `mock-multimodal-vlm-v1` | ❌ Stub | OCR/vision tanı yok; metin bağlam stub |
| 11 | Output Normalizer | `models/normalizer.py` | ✅ | Normalize + finding ontology / laterality (ISS-FUS-01 DONE iskelet) |
| 12 | Evidence Fusion + Provenance | `normalizer.py`, `evidence_validation.py`, `source_kind` | ✅ Kısmi | Provenance disiplinli; klinik fusion yok |
| 13 | Structured Findings | `schemas/findings.py` | ✅ | Tip güvenli DTO mevcut |
| 14 | Approved Knowledge Base | `rag/corpus.py` (`SEED_CORPUS`) | ⚠️ Demo | Sentetik/eğitim pasajları; onaylı klinik KB değil |
| 15 | RAG Retriever | `rag/retriever.py`, `embedding_retriever.py`, `vector_store.py` | ⚠️ Stub | Hash n-gram + JSON; gerçek embed/vector DB yok |
| 16 | LLM Orchestrator / Gateway | `orchestration/orchestrator.py`, `llm/gateway.py` | ✅ İskelet | Akış doğru; varsayılan mock LLM |
| 17 | Veterinary LLM | `llm/mock_provider.py` (+ http/stub) | ❌ Mock | Veteriner-domain eğitilmiş LLM yok |
| 18 | Report Validator | `validation/report_validator.py` | ✅ Yapısal | Klinik doğrulama bilinçli engelli |
| 19 | Radiologist Review | `POST .../review`, FE `RadiologistWorkspace` (`/calisma`) | ✅ | Approve/reject/revision + reason codes + immutable sürüm |
| 20 | Approved Report | `report_versioning.py`, PDF | ✅ | Immutable onaylı sürüm + print/PDF |
| 21 | Feedback / Audit Store | `feedback/store.py`, `security/audit.py` | ✅ İskelet | Reject/revision → FeedbackEvent + export; otomatik retrain BOUNDARY |

**Legenda:** ✅ hedefe yakın iskelet · ⚠️ kısmi/stub · ❌ diyagram vaadi karşılanmıyor (mock veya yok)

---

## 3. Issue kataloğu

Severity: **P0** kritik güvenlik/bütünlük · **P1** yüksek · **P2** orta · **P3** düşük / borç · **BOUNDARY** bilinçli ürün sınırı (klinik NO-GO)

### 3.1 Ingestion & Storage

| ID | Sev | Issue | Kanıt / konum | Etki |
|----|-----|-------|---------------|------|
| **ISS-ING-01** | BOUNDARY | PACS / DICOMweb entegrasyonu yok | Quarantine notu: “Not clinical PACS” | Klinik ingest akışı eksik |
| **ISS-ING-02** | BOUNDARY | Encryption-at-rest yok | `storage/encryption.py` → `NullEncryptor` | Quarantine blob’lar plaintext |
| **ISS-ING-03** | BOUNDARY | Malware / AV taraması yok (demo noop) | `storage/malware_scan.py` → `NoopScanner` | Korumalı deploy’da fail-closed; gerçek AV yok |
| **ISS-ING-04** | P2 | Quarantine yalnızca yerel disk; object storage (S3 vb.) yok | `data/quarantine/` | Ölçek / HA / yedekleme zayıf |
| **ISS-ING-05** | ✅/P2 | Document OCR HTTP adapter yüzeyi (stub); varsayılan caption stub | `ingest/documents.py`, fixtures | Gerçek OCR motoru BOUNDARY |
| **ISS-ING-06** | P3 | PDF extract `pypdf` opsiyonel; yoksa stub mesaj | `ingest/documents.py` | Bazı ortamlarda metin çıkmaz |
| **ISS-ING-07** | BOUNDARY | De-identification / PHI redaction pipeline üretim seviyesinde yok | `security/redaction.py` sınırlı | Klinik veri güvenliği NO-GO |

### 3.2 DICOM parse & Hybrid Classification

| ID | Sev | Issue | Kanıt / konum | Etki |
|----|-----|-------|---------------|------|
| **ISS-CLS-01** | ✅ DONE | Hibrit iskelet: metadata + series_hint; şeffaf signals | `dicom/classifier.py` | Vision-assisted 2. sinyal hâlâ BOUNDARY (eğitilmiş model yok) |
| **ISS-CLS-02** | P2 | Desteklenen modalite seti dar (MR/CT/XR); diğerleri MANUAL_REVIEW | `_SUPPORTED_MODALITIES` | Geniş klinik kapsama yok |
| **ISS-CLS-03** | P2 | Belirsiz/çakışan sınıflandırmada insan onayı zorunlu (iyi) ama otomatik iyileştirme/feedback yok | classifier + confirm API | Feedback loop eksik |
| **ISS-CLS-04** | P2 | Piksel yolu default-deny; `metadata_only=True` sabit builder yolu | `model_input_builder.py` | Series parser → vision’a gerçek görüntü gitmiyor |
| **ISS-CLS-05** | P3 | Multi-ingest merge / series selection hazır ama varsayılan analyze hâlâ mock | Phase 20 docs | Entegrasyon iskeleti ≠ canlı model |

### 3.3 Model Router & Vision modelleri

| ID | Sev | Issue | Kanıt / konum | Etki |
|----|-----|-------|---------------|------|
| **ISS-VIS-01** | BOUNDARY | MRI Vision Model eğitilmiş değil — mock fixture | `MockBrainMriModel` vb. | Diyagramdaki MRI kutusu karşılanmıyor |
| **ISS-VIS-02** | BOUNDARY | CT Vision Model eğitilmiş değil — mock fixture | `MockCt3dModel` | Aynı |
| **ISS-VIS-03** | BOUNDARY | X-Ray Vision Model eğitilmiş değil — mock fixture | `MockXrVisionModel` | Aynı |
| **ISS-VIS-04** | BOUNDARY | Multimodal VLM gerçek değil — stub; OCR/tanı yok | `MockMultimodalVlmModel` | VLM kutusu karşılanmıyor |
| **ISS-VIS-05** | P1 | Gerçek model bağlama yalnızca HTTP adapter yüzeyi; vendor klinik wire doğrulanmamış | `http_vision.py`, Phase 8 “PARTIALLY READY” | Sentetik deneme mümkün; üretim READY değil |
| **ISS-VIS-06** | P2 | Local torch yolu / bridge var ama ağırlık yükleme / GPU serve üretimde yok | `local_torch.py`, `pixel_bridge.py` | Phase 20 “remaining steps” açık |
| **ISS-VIS-07** | P2 | Hiçbir default capability `allows_pixel_analysis=True` değil | `pixel_authorization.py`, capabilities | Piksel inference kapalı |
| **ISS-VIS-08** | P3 | Scenario policy demo override’ları üretim politikasıyla karışabilir | `scenario_policy.py` | Demo senaryoları yanlışlıkla prod’da kalabilir |
| **ISS-VIS-09** | P2 | Vision HTTP POST retry=0 (bilinçli); transient 503 kırılganlığı | `http_policy.py`, F14 residual | Geçici ağ hatalarında fail |

### 3.4 Normalizer, Fusion, Provenance

| ID | Sev | Issue | Kanıt / konum | Etki |
|----|-----|-------|---------------|------|
| **ISS-FUS-01** | ✅ DONE | SOP/series/family + laterality ontology iskeleti | `normalizer.py`, `finding_ontology.yaml` | Klinik ensemble derinliği hâlâ sınırlı (ISS-FUS-02) |
| **ISS-FUS-02** | P2 | Evidence fusion klinik ensemble değil; mock findings birleştirme | `normalize_outputs` | Diyagramdaki “Evidence Fusion” sığ |
| **ISS-FUS-03** | P3 | Agreement note “doğruluk kanıtı değil” uyarısı var ama UI’da yanlış okunabilir | `AGREEMENT_NOTE` | Kullanıcı yanılsaması riski |

### 3.5 RAG & Knowledge Base

| ID | Sev | Issue | Kanıt / konum | Etki |
|----|-----|-------|---------------|------|
| **ISS-RAG-01** | BOUNDARY | Approved Knowledge Base = sentetik seed corpus; klinik onaylı KB değil | `rag/corpus.py` | Diyagramdaki “Approved” karşılanmıyor |
| **ISS-RAG-02** | BOUNDARY | Gerçek embedding modeli yok (hash n-gram); sentence-transformers yok | `rag/embeddings.py` | Semantik retrieval zayıf |
| **ISS-RAG-03** | BOUNDARY | Managed vector DB yok (Qdrant/pgvector); JSON indeks | `JsonVectorStore` | Ölçek / kalite sınırlı |
| **ISS-RAG-04** | ✅ DONE | used_passage_ids: mock + HTTP wire + stub; chat path legacy uyarı | `rag_grounding.py`, `http_provider.py` | Finding-link soft (ISS-RAG-05) |
| **ISS-RAG-05** | P2 | Citation ↔ finding bağlama zayıf; skor semantiği dikkat gerektirir | **F13** (kısmen iyileşti) | “Klinik kanıt” sanılabilir |
| **ISS-RAG-06** | P3 | RAG lisans / kaynak uyumu üretim politikası yok | docs | Legal risk |

### 3.6 LLM Orchestrator & Veterinary LLM

| ID | Sev | Issue | Kanıt / konum | Etki |
|----|-----|-------|---------------|------|
| **ISS-LLM-01** | BOUNDARY | Veterinary LLM yok — varsayılan `MockLLMProvider` şablon taslak | `llm/mock_provider.py` | Diyagramdaki Veterinary LLM karşılanmıyor |
| **ISS-LLM-02** | P1 | HTTP LLM bağlanabilir ama VetMind wire contract; keyfi vendor API değil | `http_provider.py` | Entegrasyon sürtünmesi |
| **ISS-LLM-03** | P2 | LLM sync blocking; async job içinde bile HTTP çağrısı thread’i tutar | gateway + workers | Uzun timeout / cancel zayıf |
| **ISS-LLM-04** | ✅/P3 | Cancel probe LLM sonrası taslağı atar; HTTP çağrısı ortasında kill yok | orchestrator | True mid-HTTP abort ayrı (blocking) |
| **ISS-LLM-05** | P3 | Document context LLM’e “draft text only” olarak girer; yapılandırılmış klinik NER yok | mock provider `document_context_*` | Document branch sığ |

### 3.7 Validator, Review, Approved Report

| ID | Sev | Issue | Kanıt / konum | Etki |
|----|-----|-------|---------------|------|
| **ISS-VAL-01** | BOUNDARY | Report Validator yalnızca yapısal; klinik validasyon bayrağı bilinçli engelli | `clinically_validated=True` yasak | Otonom klinik onay yok (doğru sınır) |
| **ISS-VAL-02** | ✅ DONE | `POST .../report/manual-init` + FE CTA; `source_kind=manual` | `case_service.init_manual_report`, RadiologistWorkspace | AI draft onayından ayrı manuel yol |
| **ISS-VAL-03** | P3 | Validator fail → yine review kuyruğuna düşebilir (PARTIAL) | orchestrator | UX netliği |
| **ISS-REV-01** | ✅/P3 | Radiologist Review mevcut (approve/reject/revision) | review API + FE | Hedefe yakın; SSO/IdP yok |
| **ISS-REV-02** | P2 | Frontend rol Gate UX-only; korumalı veri için backend auth zorunlu | `App.tsx` Gate | Auth kapalı demo’da yanılsama |
| **ISS-REP-01** | ✅ | Approved Report + immutable versioning + PDF | `report_versioning.py` | Hedefe yakın |

### 3.8 Feedback / Audit Store

| ID | Sev | Issue | Kanıt / konum | Etki |
|----|-----|-------|---------------|------|
| **ISS-AUD-01** | ✅ DONE | FeedbackStore + API export + FE reason codes | `feedback/store.py` | Otomatik retrain / RLHF BOUNDARY |
| **ISS-AUD-02** | P2 | Security audit JSONL var ama operasyonel model audit / drift / version monitor yok | `security/audit.py` | Observability eksik |
| **ISS-AUD-03** | ✅/P2 | Retention dry-run + admin apply API + FE panel | `admin_retention.py`, `SystemStatus` | Legal hold / regülasyon paketi yok |
| **ISS-AUD-04** | P3 | Audit path opsiyonel; test/demo’da memory | settings `audit_log_path` | Prod hijyeni dokümante edilmeli |

### 3.9 Güvenlik, concurrency, platform (çapraz kesit)

| ID | Sev | Issue | Kanıt / konum | Etki |
|----|-----|-------|---------------|------|
| **ISS-SEC-01** | ✅/P3 | Protected → auth zorunlu; encryption no-op fail-fast; readiness auth | settings + models API | Varsayılan demo hâlâ auth kapalı (bilinçli) |
| **ISS-SEC-02** | BOUNDARY | OAuth / SSO / IdP yok | auth paketi JWT+API key | Kurumsal auth yok |
| **ISS-SEC-03** | P2 | Multi-tenant kısmi; tam SaaS izolasyonu değil | tenancy | Cross-clinic risk (auth açıkken bile sınırlı) |
| **ISS-SEC-04** | P2 | Analyze gate multi-node / Redis cluster değil | **P8-R1** | Yatay ölçekte race |
| **ISS-SEC-05** | P3 | RQ paketleri / Redis ortamda her zaman yok; integration blocked olabilir | Phase 8 audit | Async prod yolu opsiyonel |
| **ISS-FE-01** | ✅ DONE | DEMO FICTION etiketleri + backend Processing ayrımı | `pipeline.ts`, `Processing.tsx` | Dashboard mock kartları ayrı (ISS-FE-02) |
| **ISS-FE-02** | P3 | System Status’ta kısmen mock GPU/queue kartları | FE SystemStatus | Altyapı yanılsaması |
| **ISS-DOC-01** | ✅/P3 | `.env.example` + INTEGRATION_PLAYBOOK senkronlandı (2026-10-25) | docs sync | Küçük drift riski kalır |
| **ISS-PER-01** | P2 | Kalıcılık JSON(B) blob; zengin ilişkisel klinik şema yok | sqlite/postgres repos | Raporlama/analitik sınırlı |
| **ISS-OBS-01** | BOUNDARY | Tracing, metrics, model drift monitoring yok | — | Üretim observability NO-GO |
| **ISS-INT-01** | BOUNDARY | HL7 / FHIR yok | — | Hastane entegrasyonu yok |

### 3.10 Açık audit borçları (önceki fazlardan taşınan)

| ID | Sev | Kaynak | Durum (2026-10-24) |
|----|-----|--------|---------------------|
| **F4** | P3 | AI Architecture | Document confirm + analyze refresh ile büyük ölçüde kapatıldı; residual düşük |
| **F9** | ✅/P3 | AI Architecture | Ontology/laterality iskeleti → **ISS-FUS-01 DONE**; residual klinik fusion |
| **F13** | P2 | AI Architecture | Mock used-passages DONE; HTTP path → **ISS-RAG-04** |
| **F14** | P3 | AI Architecture | Connect/read timeout + policy wired; POST retry=0 bilinçli → **ISS-VIS-09** |
| **P7-R3** | P2 | Phase 7 | Cancel cooperative sınırlı → **ISS-LLM-04** |
| **P7-R4** | P2 | Phase 7 | RAG used-passages → **ISS-RAG-04** |
| **P8-R1** | P2 | Phase 8 | Multi-node gate → **ISS-SEC-04** |
| **P8-R2** | P2 | Phase 8 | = P7-R4 |
| **P8-R3** | ✅ | Phase 8 | Conflict ontology → **ISS-FUS-01 DONE** |

> Not: P7-R1 (forged JWT `role=demo`) ve P8-01/02/03 Phase 8’de düzeltilmiş kabul edilir; bu listede tekrar **açık** issue olarak yazılmaz.

---

## 4. Diyagram ↔ gerçeklik özet skoru

| Pipeline aşaması | Skor | Tek cümle |
|------------------|------|-----------|
| Upload | 7/10 | Çalışır; PACS yok |
| Secure ingestion | 4/10 | Quarantine var; AV/encryption yok |
| DICOM parse / series | 7/10 | Metadata + selection iyi; piksel kapalı |
| Hybrid classification | 3/10 | Rule-based; hybrid değil |
| Document processing | 4/10 | Text/PDF + OCR HTTP stub; motor yok |
| Model router + policy | 8/10 | İskelet olgun |
| MRI/CT/XR/VLM | 1/10 | Hepsi mock/stub |
| Normalizer / fusion | 6/10 | Provenance iyi; klinik fusion zayıf |
| Structured findings | 8/10 | Şema sağlam |
| Approved KB + RAG | 3/10 | Demo seed + hash embed |
| LLM gateway | 7/10 | Orchestration iyi |
| Veterinary LLM | 1/10 | Mock şablon |
| Report validator | 7/10 | Yapısal; klinik değil |
| Radiologist review | 8/10 | Ürün akışı var |
| Approved report | 8/10 | Immutable + PDF |
| Feedback / audit store | 3/10 | Security log var; model feedback yok |

**Ortalama (ağırlıksız):** ~5.2/10 — **mimari iskelet hazır, diyagramdaki AI/klinik kutular çoğunlukla boş.**

---

## 5. Öncelikli kapatma sırası (öneri)

### P0 / P1 — güven ve dürüstlük / plug-in hazırlığı
1. Korumalı deploy’da auth + tenant + audit zorunlu (**ISS-SEC-01**; encryption no-op fail-fast).  
2. ~~FE pipeline fiction~~ → **ISS-FE-01 DONE**.  
3. ~~Feedback Store~~ → **ISS-AUD-01 DONE**.  
4. Entegrasyon playbook + wire fixture + fail-closed Vision/LLM → [INTEGRATION_PLAYBOOK.md](INTEGRATION_PLAYBOOK.md).

### P2 — diyagrama yaklaştırma (prototip sertleştirme)
5. ~~Hybrid classification iskelet~~ → **ISS-CLS-01 DONE** (vision 2. sinyal BOUNDARY).  
6. ~~OCR / document caption adapter yüzeyi~~ → **ISS-ING-05 DONE** (HTTP stub; motor BOUNDARY).  
7. RAG used-passages tüm LLM path’leri + finding link (**ISS-RAG-04/05**).  
8. ~~Conflict ontology / laterality~~ → **ISS-FUS-01 DONE**.  
9. Cancel probe’u LLM aşamasına taşımak (**ISS-LLM-04**).  
10. Multi-node analyze gate (**ISS-SEC-04**).  
11. ~~Bulk KB ingest + `approved=false` default~~ → **DONE** (API + Bilgi Tabanı JSONL UI).

### BOUNDARY — klinik üretim (ayrı program)
10. Eğitilmiş / valide MRI·CT·XR·VLM + piksel pipeline.  
11. Domain Veterinary LLM + privacy.  
12. Gerçek embeddings + vector DB + approved KB governance.  
13. PACS, AV, encryption-at-rest, SSO, observability, HL7/FHIR.

---

## 6. Readiness matrisi (değişmedi)

| Hedef | Karar |
|-------|--------|
| Diyagram iskeleti ile demo / bitirme sunumu | **GO** |
| Sentetik veri ile iç test | **GO** |
| Fotoğraftaki gibi gerçek multi-model AI pipeline | **NO-GO** |
| Korumalı klinik veri | **NO-GO** |
| Otonom / klinik onaylı rapor | **NO-GO** (bilinçli) |

---

## 7. Issue indeksi (hızlı arama)

`ISS-ING-01` … `ISS-ING-07` · `ISS-CLS-01` … `ISS-CLS-05` · `ISS-VIS-01` … `ISS-VIS-09` · `ISS-FUS-01` … `ISS-FUS-03` · `ISS-RAG-01` … `ISS-RAG-06` · `ISS-LLM-01` … `ISS-LLM-05` · `ISS-VAL-01` … `ISS-VAL-03` · `ISS-REV-01` … `ISS-REV-02` · `ISS-REP-01` · `ISS-AUD-01` … `ISS-AUD-04` · `ISS-SEC-01` … `ISS-SEC-05` · `ISS-FE-01` … `ISS-FE-02` · `ISS-DOC-01` · `ISS-PER-01` · `ISS-OBS-01` · `ISS-INT-01` · audit köprüleri: `F4/F9/F13/F14`, `P7-R3/R4`, `P8-R1/R2/R3`

**Toplam açık / sınır issue (yaklaşık):** 50+ madde (BOUNDARY dahil); bunlardan ~25’i aktif teknik borç, geri kalanı bilinçli ürün sınırı.

---

*Son güncelleme: 2026-10-24 · Kaynak: hedef mimari diyagramı + depo kod/audit taraması · Klinik sistem değildir.*
