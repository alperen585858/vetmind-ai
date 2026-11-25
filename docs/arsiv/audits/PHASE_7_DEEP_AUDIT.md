# VetMind AI — Phase 7: Deep Audit & Backend Hardening

**Date:** 2026-10-23  
**Scope:** Source-code truth audit (not README-as-truth). Controlled P0/P1 hardening only.  
**Verdict after fixes:** Demo **GO** · Clinical / real-AI production **NO-GO** (unchanged product boundary).

---

## 1. Gerçek sistem durumu

| Boyut | Gerçek durum |
|-------|----------------|
| Mimari | Modular monolith + `AppContainer` DI — doğrulandı |
| Vision / LLM varsayılan | Mock / stub; piksel yolu default-deny |
| Kalıcılık | SQLite JSON (default) / memory / Postgres JSONB |
| Jobs | Thread (default); RQ yolu CaseService ile hizalandı |
| Auth | Opsiyonel JWT + API key + RBAC; tenant isolation env ile |
| Provenance | `source_kind` / `synthetic` / `clinically_validated=False` korunuyor |
| Readiness | Sentetik demo akışı çalışır; klinik model / PACS / AV / encryption yok |

Sistem **yeniden yazılmadı**. Orchestrator sözleşmesi korundu; adapter / service sınırında sertleştirme yapıldı.

---

## 2. İncelenen modüller

| # | Modül | Sonuç (özet) |
|---|--------|----------------|
| 1 | `AppContainer` | Çalışıyor; DocumentService capabilities/tenant eksikti → düzeltildi |
| 2 | API → service → repo | Case/DICOM izolasyonu iyi; document IDOR vardı → düzeltildi |
| 3 | `AIOrchestrator` | Sessiz LLM mock fallback yok; F4 refresh analyze’de var; cancel_probe eklendi |
| 4 | ModelRouter / execution policy | `exclusive_real` çalışıyor; routing `prepared_for_models`’e bağımlı değil |
| 5 | DICOM / quarantine | Path traversal + size + malformed kontrolleri mevcut ve testli |
| 6 | ImagingModelInput | Analyze’de live caps; document confirm stale idi → düzeltildi |
| 7 | Vision adapters | Mock fixture; HTTP Vision timeout ayrımı iyileştirildi |
| 8 | LLM Gateway | Fail → typed error, draft yok |
| 9 | RAG / citations | Retrieval score ≠ clinical confidence; UI/etiket güçlendirildi |
| 10 | Validator / expert review | Immutable approve mevcut; analyze-vs-approve race vardı → düzeltildi |
| 11 | Auth / tenant | Case yolu iyi; document yolu zayıftı → düzeltildi |
| 12 | Async jobs | Cancel probe + RQ→CaseService; async semaphore hâlâ P2 |
| 13 | FE/BE sync | Role gate UX-only (bilinçli); provenance banner’ları var |
| 14 | Persistence / concurrency | InMemory aynı referans mutasyonu P0 kök nedeniydi → deep copy |

---

## 3. Bulunan sorunlar ve önem dereceleri

### Düzeltilenler

| ID | Sev | Bulgu | Kanıt |
|----|-----|--------|--------|
| **P7-01** | **P0** | In-flight analyze, concurrent approve sonrası onaylı immutable raporu eziyordu. InMemory repo aynı nesneyi döndürdüğü için orchestrator approve durumunu yerinde bozabiliyordu. | `case_service.py` analyze/worker; repro: analyze → async re-analyze + delay → approve → job discard |
| **P7-02** | **P1** | Document ingest tenancy/IDOR yoktu (`clinic_id`/`owner_subject` yok; get/confirm ownership check yok). | `document_service.py`, `api/documents.py`, `schemas/documents.py` |
| **P7-03** | **P1** | Document confirm `build_imaging_model_input(case)` default caps kullanıyordu (F4 residual). | `document_service.py` confirm |
| **P7-04** | **P1** | HTTP LLM her zaman `source_kind=REAL` / `synthetic=false` yazıyordu (mock findings üstünde yanıltıcı). | `llm/http_provider.py` |
| **P7-05** | **P1** | RQ worker CaseService versioning/lock/cancel merge atlıyordu. | `workers/rq_tasks.py` → `CaseService.run_queued_analyze` |
| **P7-06** | **P1** | SQLite/Postgres’te worker cancel flag’i görmüyordu (ayrı deserialize). | `cancel_probe` + repo reload |

### Kısmen iyileştirilen / P2

| ID | Sev | Bulgu | Durum |
|----|-----|--------|--------|
| **F9** | P2 | Conflict detection location-string ağırlıklıydı | Series UID ile gruplama eklendi; laterality/ontology yok |
| **F13** | P2 | RAG score klinik güven gibi okunabilirdi | `rag_note` + UI `retrieval_score=` + KB metni; unused-passage grounding hâlâ yok |
| **F14** | P2→P3 | Tek timeout; policy kısmen unused | Connect/read timeout + `llm_http_policy` wired; POST retry=0 korundu |
| **F4** | P3 | Document path residual | Analyze zaten refresh ediyordu; document confirm düzeltildi |

### Açık kalan (bilinçli NO-GO / borç)

| ID | Sev | Bulgu |
|----|-----|--------|
| **P7-R1** | P1* | Forged JWT `role=demo` → global principal (secret bilinirse). Protected mode default secret’ı engeller. |
| **P7-R2** | P2 | Async enqueue `_analyze_gate` semaphore’unu bypass eder |
| **P7-R3** | P2 | Cancel, adapter loop sonrası / LLM sırasında cooperative değil |
| **P7-R4** | P2 | RAG citations = tüm retrieve edilen pasajlar (LLM “used” filtresi yok) |
| **P7-R5** | — | Gerçek Vision/LLM/PACS/piksel/AV/encryption/SSO yok (ürün sınırı) |

\*P7-R1 production secret hijyeni ile sınırlanır; bu fazda IdP/allowlist genişletilmedi.

---

## 4. Kanıt — yeniden üretim

### P7-01 (approve race) — regression

```bash
cd backend && pytest tests/test_phase7_hardening.py::test_analyze_discarded_when_approved_in_flight -q
```

Beklenen: job `failed`, case `approved`, immutable `report_id` değişmez.

### P7-02 (document IDOR)

```bash
pytest tests/test_phase7_hardening.py::test_document_cross_tenant_ingest_denied -q
```

Auth + tenant isolation: clinic-B `GET/confirm` → 404.

### P7-04 (HTTP LLM provenance)

```bash
pytest tests/test_phase7_hardening.py::test_http_llm_provenance_follows_findings_source_kind -q
```

---

## 5. Yapılan düzeltmeler

| Dosya | Değişiklik |
|-------|------------|
| `backend/app/services/case_service.py` | Deep copy working case/job; `_persist_pipeline_result` approve guard; `run_queued_analyze`; cancel probe |
| `backend/app/orchestration/orchestrator.py` | Optional `cancel_probe` cooperative cancel |
| `backend/app/workers/rq_tasks.py` | `CaseService.run_queued_analyze` kullanır |
| `backend/app/services/document_service.py` | Tenancy + live capabilities (F4) |
| `backend/app/api/documents.py` | Principal geçişi |
| `backend/app/schemas/documents.py` | `owner_subject` / `clinic_id` |
| `backend/app/container.py` | DocumentService wiring |
| `backend/app/llm/http_provider.py` | Findings-aware provenance; connect/read timeout; llm policy |
| `backend/app/models/http_vision.py` | Connect/read timeout |
| `backend/app/models/normalizer.py` | F9: series UID conflict grouping |
| `backend/app/schemas/report.py` / `rag.py` | RAG score disclaimer |
| `src/components/RagCitations.tsx` | `retrieval_score=` etiketi |
| `src/pages/KnowledgeBase.tsx` | Retrieval eşiği metni (klinik güven değil) |

---

## 6. Eklenen regression testleri

`backend/tests/test_phase7_hardening.py`:

1. `test_analyze_discarded_when_approved_in_flight` (P0)  
2. `test_document_cross_tenant_ingest_denied` (P1)  
3. `test_document_confirm_includes_live_remote_capability` (F4)  
4. `test_http_llm_provenance_follows_findings_source_kind` (P1)  
5. `test_conflict_detection_separates_different_series` (F9)  
6. `test_conflict_detection_same_series_still_flags` (F9)

Mevcut testler silinmedi / assertion gevşetilmedi.

---

## 7. Test sonuçları

| Katman | Sonuç | Not |
|--------|--------|-----|
| Backend pytest | **PASSED** | **243 passed, 1 skipped** |
| Frontend Vitest | **PASSED** | **20 passed** |
| TypeScript `tsc` | **PASSED** | |
| Production `npm run build` | **PASSED** | |
| Playwright E2E | **PASSED*** | Tam suite: ilk koşuda Chrome sandbox / flaky timeout (1 fail); `full-workflow` yeniden koşusu **1 passed**. Sandbox’ta browser launch **BLOCKED** olabilir. |

\*E2E: ortam bağımlı. Raporlama kuralı: uydurma PASSED yok — flaky ilk koşu belgelendi, hedefli re-run yeşil.

---

## 8. Kalan teknik borç

1. JWT role allowlist / forged `demo` principal (P7-R1)  
2. Async concurrency gate parity with sync (P7-R2)  
3. RAG grounded citations (yalnızca kullanılan pasajlar) (P7-R4)  
4. Conflict ontology / laterality alanları (F9 devamı)  
5. Typed Vision timeout exception hiyerarşisi  
6. Frontend local `pipeline.ts` fiction ile backend AI ayrımının UX’te daha sert etiketlenmesi  
7. Klinik üretim checklist: PACS, SSO, encryption-at-rest, malware AV, pixel pipeline, model validation  

---

## 9. Demo GO / NO-GO gerekçesi

| Hedef | Karar | Gerekçe |
|-------|--------|---------|
| **Demo / bitirme sunumu** | **GO** | Sentetik DICOM→mock analyze→review→versions yolu çalışır; provenance MOCK/SYNTHETIC; pytest + vitest + build yeşil; E2E full-workflow doğrulandı |
| **Sentetik iç test** | **GO** | Phase 7 regression + mevcut suite |

---

## 10. Klinik üretim NO-GO gerekçesi

| Hedef | Karar | Gerekçe |
|-------|--------|---------|
| **Korumalı klinik veri** | **NO-GO** | Encryption-at-rest, malware AV, TLS ops, IdP/SSO, backup/restore, tam multi-tenant SaaS yok |
| **Gerçek AI üretim** | **NO-GO** | Eğitilmiş/valide Vision yok; piksel inference yok; ücretli/üretim LLM zorunlu değil; klinik validasyon bayrağı engelli; PACS yok |

Bu faz hiçbir klinik AI yetkinliği iddiası eklemez.

---

## 11. Önerilen sonraki geliştirme fazı

**Phase 8 — Production-shaped hardening (öneri):**

1. JWT claim allowlist + forged-role testleri  
2. Async analyze concurrency gate + cancel-after-adapters probe  
3. RAG “used passages only” + citation↔finding bağlama  
4. RQ integration tests (Redis optional CI job)  
5. Document + DICOM tenancy parity audit tamamı  
6. Ops runbook: protected mode checklist  

**Phase 9+ (klinik — ayrı program):** gerçek model serving, de-ID, PACS, SSO, encryption, klinik validasyon süreci.

---

## Değişen dosya listesi (bu faz)

```
backend/app/services/case_service.py
backend/app/orchestration/orchestrator.py
backend/app/workers/rq_tasks.py
backend/app/services/document_service.py
backend/app/api/documents.py
backend/app/schemas/documents.py
backend/app/container.py
backend/app/llm/http_provider.py
backend/app/models/http_vision.py
backend/app/models/normalizer.py
backend/app/schemas/report.py
backend/app/schemas/rag.py
backend/tests/test_phase7_hardening.py
src/components/RagCitations.tsx
src/pages/KnowledgeBase.tsx
docs/audits/PHASE_7_DEEP_AUDIT.md
```

---

*Phase 7 deep audit · Backend 0.2.0 · 2026-10-23*
