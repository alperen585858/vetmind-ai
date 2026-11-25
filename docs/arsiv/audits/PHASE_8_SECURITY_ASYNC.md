# VetMind AI — Phase 8: Security & Async Reliability

**Date:** 2026-10-23  
**Scope:** JWT role hardening, async/sync concurrency parity, approved-report integrity, E2E determinism.  
**Architecture:** Unchanged modular monolith + `AppContainer`. No new frameworks. No real Vision model.

---

## 1. Doğrulanmış riskler ve kök nedenler

| ID | Sev | Risk | Kök neden |
|----|-----|------|-----------|
| **P8-01** | P1 | JWT `role=demo` / forged `role=admin` ile privilege escalation | `decode_token` claim’e güveniyordu; `principal_is_global` `demo`’yu global sayıyordu; seed role bağlanmıyordu |
| **P8-02** | P1 | Async analyze concurrency gate’i bypass | Sync `threading.Semaphore` kullanıyordu; async enqueue slot almıyordu; RQ ayrı process’te process-local semaphore yetersiz |
| **P8-03** | P1 | Queued cancel prior draft’ı `FAILED` yapıyordu | `request_cancel_job` kuyruk iptalinde case status’ü körlemesine `FAILED` yazıyordu |
| **P8-04** | P2 | Cancel sonrası / fail re-analyze prior draft’ı silebiliyordu | `_persist_pipeline_result` working `draft_report=None` ile üzerine yazıyordu |
| **P8-05** | P2 | E2E flaky (full-workflow URL timeout) | `reuseExistingServer` + stale `e2e/.data` sqlite; analyze hata toast’ı vs navigation yarışı gözlenmiyordu |

---

## 2. Yapılan düzeltmeler

### JWT / rol (P8-01)

- JWT’ye `iss=vetmind`, `aud=vetmind-api` eklendi; decode zorunlu doğrular.
- `JWT_ISSUABLE_ROLES` = `{vet, expert, owner, admin}`; `demo` / `service` Bearer JWT’de **yasak**.
- `service` yalnızca `X-API-Key` (`via=api_key`).
- `resolve_jwt_identity`: bilinen seed subject için **role/clinic seed kaydından** bağlanır (claim escalation engeli).
- `principal_is_global`: JWT’de yalnızca `admin`; `demo` sadece `via=disabled`.

### Async concurrency (P8-02)

- `AnalyzeGate`: fcntl file-lock + counter (`VETMIND_ANALYZE_GATE_PATH`).
- Sync ve thread-async aynı gate’i paylaşır (enqueue’de acquire, worker `finally`’de release).
- RQ worker process içinde `run_queued_analyze` acquire eder (aynı host / paylaşılan dosya).
- Limit aşımı: HTTP **429** (sync + async enqueue).

> Not: Gate **tek host / paylaşılan filesystem** içindir. Multi-node Redis lock eklenmedi (bilinçli sınır).

### Rapor bütünlüğü (P8-03/04)

- Approved case: her analyze yolu discard (Phase 7 + sqlite regression).
- Cancel queued: prior mutable draft varsa status → `awaiting_review` (FAILED değil).
- Terminal fail + report yok: prior draft korunur.
- Orchestrator: LLM öncesi cooperative cancel probe.

### E2E (P8-05)

- Her koşuda `e2e/.data` sqlite/quarantine/audit **silinerek** başlar.
- `reuseExistingServer: false`.
- `confirmAndRunDemoAnalysis`: navigation **veya** error toast (`Promise.race`) — arbitrary sleep yok.

---

## 3. Değişen dosyalar

```
backend/app/auth/security.py
backend/app/auth/deps.py
backend/app/auth/tenancy.py
backend/app/workers/analyze_gate.py          (yeni)
backend/app/services/case_service.py
backend/app/orchestration/orchestrator.py
backend/app/container.py
backend/app/settings.py
backend/tests/conftest.py
backend/tests/test_phase5_security.py
backend/tests/test_phase6_e2e_journey.py
backend/tests/test_phase7_hardening.py
backend/tests/test_phase8_security_async.py  (yeni)
playwright.config.ts
e2e/helpers/workflow.ts
docs/audits/PHASE_8_SECURITY_ASYNC.md        (yeni)
```

---

## 4. Regression testleri

`backend/tests/test_phase8_security_async.py`:

| Test | Kapsam |
|------|--------|
| `test_decode_rejects_role_demo` | P8-01 |
| `test_decode_rejects_role_service` | P8-01 |
| `test_decode_requires_iss_aud` | P8-01 |
| `test_resolve_jwt_identity_binds_seed_role_not_claim` | P8-01 |
| `test_forged_demo_role_jwt_rejected_by_api` | P8-01 |
| `test_forged_admin_claim_on_vet_subject_stays_vet` | P8-01 |
| `test_legitimate_roles_still_login` | regression |
| `test_async_analyze_respects_concurrency_gate` | P8-02 |
| `test_analyze_gate_file_lock_shared` | P8-02 |
| `test_cancel_preserves_prior_draft` | P8-03/04 |
| `test_sqlite_approved_report_survives_reanalyze_attempt` | integrity |

---

## 5. Test sonuçları

| Katman | Sonuç | Kanıt |
|--------|--------|--------|
| Backend pytest | **PASSED** | **254 passed, 1 skipped** |
| Vitest | **PASSED** | **20 passed** |
| TypeScript typecheck | **PASSED** | |
| Production build | **PASSED** | |
| Playwright E2E (full suite) | **PASSED** | **17 passed** (desktop + mobile) |
| Redis / RQ integration | **BLOCKED** | `redis`/`rq` paketleri yüklü değil; Redis çalışmıyor |

---

## 6. Kalan sorunlar

| ID | Sev | Açıklama |
|----|-----|----------|
| P8-R1 | P2 | Analyze gate multi-node / Redis cluster değil |
| P8-R2 | P2 | RAG “used passages only” hâlâ yok (Phase 7 borcu) |
| P8-R3 | P3 | Conflict ontology / laterality (F9 devamı) |
| P8-R4 | — | Gerçek Vision, PACS, SSO, encryption-at-rest, AV — ürün sınırı |

Demo **GO** · Klinik üretim **NO-GO** (değişmedi).

---

## 7. Vision model entegrasyon hazırlığı

### Soru

> VetMind AI, gerçek bir Vision modelinin **kontrollü ve sentetik veriyle** entegrasyonuna teknik olarak hazır mı?

### Cevap: **PARTIALLY READY**

| Kanıt (hazır) | Kanıt (eksik) |
|---------------|----------------|
| `ImagingModel` Protocol + `HttpRemoteVisionModel` wire | Eğitilmiş/valide klinik model yok |
| Capability env + `exclusive_real` execution policy | Piksel decode / GPU serve yok (`metadata_only`) |
| Orchestrator refresh + registry consistency (F4/F8) | Multi-node job+gate yok |
| Provenance: mock findings üstünde REAL LLM etiketi engeli | Vendor wire contract klinik doğrulanmamış |
| Pixel authz default-deny | PHI/de-ID, clinical validation lifecycle yok |
| Timeout (connect/read), POST retry=0 | Retry-safe idempotency anahtarları sınırlı |
| Sentetik DICOM fixtures + geniş pytest/E2E | PACS / DICOMweb yok |

**Yorum:** Adapter sınırında **sentetik/kontrollü HTTP Vision denemesi** yapılabilir (`VETMIND_VISION_ENDPOINT` + capability matrix + mock vision server). Bu, klinik veya üretim “READY” anlamına gelmez; yalnızca entegrasyon iskeleti **kısmen hazırdır**.

---

*Phase 8 · 2026-10-23 · Backend 0.2.0*
