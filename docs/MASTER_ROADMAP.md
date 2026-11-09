# VetMind AI — Master Engineering Roadmap

**Verified against:** commit `e85dab3` (main) · Goal A per [READINESS_GOALS.md](READINESS_GOALS.md)  
**Rule:** Track progress by verified implementation (code + tests + integration), not file/line counts.  
**Clinical AI accuracy:** never scored 10/10 without genuine veterinary data and independent clinical validation.

## Hard constraints

- Reuse existing architecture; do not rebuild working modules.
- Preserve Gemini VLM/LLM production pathway until a replacement is validated.
- Keep experimental LocalTorch / veterinary models separate from production routing.
- GPU dependencies optional; CPU-compatible tests required.
- Never fabricate clinical findings or evaluation results.
- Never weaken security to make tests pass.

---

## Maturity snapshot (software readiness 0–10)

| WS | Workstream | Score | Status |
|----|------------|------:|--------|
| 1 | Clinical Workflow | 7 | Strong demo E2E; not clinical production |
| 2 | Frontend and Product UX | 7 | Multi-role wired; mock admin surfaces remain |
| 3 | DICOM and Medical Imaging | 7.5 | Quarantine + 2D viewer mature; no PACS/3D |
| 4 | AI Orchestration | 6.5 | Clean pipeline; mock defaults without remote config |
| 5 | Data Engineering | 6.5 | Verified export + patient split; no lake/ETL |
| 6 | Annotation Infrastructure | 7.5 | Verify → export E2E tested |
| 7 | Model Training Infrastructure | 5 | CPU-safe tiny train + experiment manifest (optional torch) |
| 8 | Evaluation Framework | 7 | Harness strong; synthetic GT |
| 9 | Model Registry | 6 | In-app readiness; no external registry |
| 10 | Security and Privacy | 6.0 | RBAC exists; auth off by default; protected-demo runbook |
| 11 | DevOps and CI/CD | 5.5 | GitHub Actions CI + local regression gate |
| 12 | Documentation and Observability | 7.5 | Master docs suite; metrics/tracing still weak |

---

## Workstream dossiers

### 1. Clinical Workflow

| Field | Content |
|-------|---------|
| **Existing** | Case lifecycle, async analyze, report draft/approve/reject/revision, PDF, submissions/demo payment, messaging (`backend/app/services/case_service.py`, `api/cases.py`, `api/workflow.py`, `api/reports.py`) |
| **Verified** | `e2e/full-workflow.spec.ts`, `test_phase6_e2e_journey.py`, `test_phase18_workflows.py` |
| **Gaps** | Auth-off demo bypass; no PACS; payment simulated; deliver UX incomplete |
| **Dependencies** | Auth mode, DICOM ingest, orchestrator |
| **Plan** | Phase 2 deliver UX; Phase 4 protected-demo runbook |
| **Acceptance** | Existing E2E green; deliver action wired; no silent auth bypass in protected mode |
| **Tests** | Phase6/18 + Playwright full-workflow |
| **GPU** | None |
| **Data** | Demo fixtures sufficient |
| **Risks** | Confusing demo GO with clinical GO |

### 2. Frontend and Product UX

| Field | Content |
|-------|---------|
| **Existing** | 24 pages, i18n TR/EN, `RadiologistWorkspace`, `DicomViewer`, `src/lib/backend.ts` |
| **Verified** | Vitest under `src/lib/*.test.ts`; Playwright `e2e/` |
| **Gaps** | Dashboard/Modules/SystemStatus mock charts; Register localStorage illusion; some i18n holes |
| **Dependencies** | Health/readiness APIs for honesty wiring |
| **Plan** | Phase 1 mock labels + Register honesty; Phase 2 export ops UI |
| **Acceptance** | No unlabelled mock telemetry; Register cannot imply server account when auth off |
| **Tests** | Vitest + protected/demo e2e |
| **GPU** | None |
| **Data** | None |
| **Risks** | Over-claiming live GPU/deploy metrics |

### 3. DICOM and Medical Imaging

| Field | Content |
|-------|---------|
| **Existing** | Parse/validate/anonymize, quarantine, display PNG, 2D viewer (`backend/app/dicom/`, `imaging/`, `src/components/DicomViewer.tsx`) |
| **Verified** | `test_dicom*.py`, `test_quarantine.py`, `test_phase19_dicom_viewer.py`, e2e slice nav |
| **Gaps** | No DICOMweb/PACS/3D; malware scan off by default; large-study FE limits |
| **Dependencies** | Storage quarantine; pixel opt-in for LocalTorch |
| **Plan** | Document scrub defaults (Phase 2/4); defer PACS to hardware/org |
| **Acceptance** | Integrity + anonymize tests green; scrub policy documented |
| **Tests** | Regression gate DICOM cluster |
| **GPU** | None for ingest/viewer |
| **Data** | Synthetic fixtures |
| **Risks** | Treating demo scrub as certified de-ID |

### 4. AI Orchestration

| Field | Content |
|-------|---------|
| **Existing** | `AIOrchestrator`, model router, VLM/LocalTorch/HTTP/mock adapters, LLM gateway, RAG relevance filter |
| **Verified** | `test_orchestrator.py`, `test_rag_relevance.py`, phase 3/8/20 readiness tests |
| **Gaps** | Default mock without env; full-study coverage claims limited |
| **Dependencies** | Model registry readiness; RAG corpus quality |
| **Plan** | Preserve Gemini; never silently change production routing; LocalTorch stays opt-in |
| **Acceptance** | Orchestrator tests pass; production path unchanged unless explicitly configured |
| **Tests** | Orchestrator + VLM + RAG suites |
| **GPU** | Optional LocalTorch only |
| **Data** | None for software maturity |
| **Risks** | Accidental mock in “real” demos; silent router changes |

### 5. Data Engineering

| Field | Content |
|-------|---------|
| **Existing** | Quarantine, `POST /api/v1/training/export`, patient-level split (`backend/app/ml/training_export.py`, `ml/evaluation/patient_split.py`) |
| **Verified** | `test_training_export_*.py`, anonymize/quarantine tests |
| **Gaps** | No object-store lake, ETL, pixel path packaging at scale |
| **Dependencies** | Expert-verified evidence |
| **Plan** | Phase 2 operationalize export; Phase 3 JSONL → train loader |
| **Acceptance** | Verified-only export + PHI-safe keys; split leakage asserts |
| **Tests** | Export API + verification + patient_split gate |
| **GPU** | None |
| **Data** | Expert-verified labels required for real train |
| **Risks** | Exporting unverified or PHI-bearing rows |

### 6. Annotation Infrastructure

| Field | Content |
|-------|---------|
| **Existing** | Evidence accept/edit/verify, overlays, bbox spatial chain (`api/evidence.py`, `evidence_review.py`, workspace UI) |
| **Verified** | `test_evidence_*.py`, `e2e/annotation-overlays.spec.ts` |
| **Gaps** | Segmentation/heatmap productization; external tool (CVAT) import; inter-rater metrics |
| **Dependencies** | Viewer coords; training export |
| **Plan** | Phase 2 ops UI for verify→export; defer SEG tooling |
| **Acceptance** | Verify → export path remains green |
| **Tests** | Evidence API + e2e overlays |
| **GPU** | None |
| **Data** | Expert time |
| **Risks** | Label drift without version discipline |

### 7. Model Training Infrastructure

| Field | Content |
|-------|---------|
| **Existing** | `ml/training/train_xray_classifier.py` stub; MONAI entrypoints; weight cache |
| **Verified** | Checkpoint wiring tests when torch present |
| **Gaps** | No real training loop, DataLoader from export, experiment tracking |
| **Dependencies** | Export schema; optional torch via `requirements-vision.txt` |
| **Plan** | Phase 3 CPU-safe tiny train + local experiment manifest |
| **Acceptance** | Synthetic JSONL trains; checkpoint `clinically_approved=false`; CI CPU-only |
| **Tests** | New train contract tests (skip without torch) |
| **GPU** | Optional; not required for software gate |
| **Data** | Synthetic fixtures for CI; real vet data later |
| **Risks** | Promoting unvalidated checkpoints |

### 8. Evaluation Framework

| Field | Content |
|-------|---------|
| **Existing** | `evaluation/` package, `backend/app/evaluation/*`, RAG/LLM/classification sets |
| **Verified** | `evaluation/tests/*`, `test_rag_relevance.py`, `test_classification_eval.py` |
| **Gaps** | No locked clinical GT; no GPU latency regression |
| **Dependencies** | Honest `not_evaluated` semantics |
| **Plan** | Phase 3 wire synthetic train output into fail-closed eval gate |
| **Acceptance** | Harness refuses silent success without labels |
| **Tests** | `test_evaluation_harness_gate.py` + clinical metrics units |
| **GPU** | None for infra |
| **Data** | Synthetic now; expert GT for Goal B claims |
| **Risks** | Marketing synthetic scores as clinical |

### 9. Model Registry

| Field | Content |
|-------|---------|
| **Existing** | `backend/app/models/registry.py`, readiness API, weight SHA fail-closed |
| **Verified** | `test_registry_consistency.py`, `test_local_torch_readiness.py`, `test_weight_cache_security.py` |
| **Gaps** | No MLflow/HF promotion stages; empty `artifacts/` |
| **Dependencies** | Training output contract |
| **Plan** | Phase 3 document promotion; never auto-promote over Gemini |
| **Acceptance** | Readiness blockers honest; experimental ≠ production |
| **Tests** | Readiness/phase suites |
| **GPU** | Probe only |
| **Data** | None |
| **Risks** | Silent clinically_approved flags |

### 10. Security and Privacy

| Field | Content |
|-------|---------|
| **Existing** | JWT, API key, RBAC, tenant isolation, audit JSONL, protected mode validators |
| **Verified** | `test_phase5_security.py`, `test_hardening_p0.py`, `e2e/protected.spec.ts` |
| **Gaps** | Auth default off; no OIDC/KMS/real AV |
| **Dependencies** | Deployment mode settings |
| **Plan** | Phase 4 protected-demo runbook; Goal B deferrals listed |
| **Acceptance** | Protected mode fail-closed; demo default documented |
| **Tests** | Security phase + protected e2e |
| **GPU** | None |
| **Data** | Seed accounts for protected demo |
| **Risks** | Demo principal with all capabilities |

### 11. DevOps and CI/CD

| Field | Content |
|-------|---------|
| **Existing** | `scripts/run_regression_gate.sh`, npm backend/FE/e2e scripts, `backend/docker-compose.yml` (Postgres+Redis) |
| **Verified** | Local pytest/vitest/playwright runnable |
| **Gaps** | No `.github/workflows`; no app Dockerfile |
| **Dependencies** | Deterministic mock defaults for CI |
| **Plan** | Phase 1 GitHub Actions CI |
| **Acceptance** | PR CI runs gate + vitest + typecheck |
| **Tests** | CI itself is the gate |
| **GPU** | None |
| **Data** | None |
| **Risks** | Flaky e2e if forced without browsers |

### 12. Documentation and Observability

| Field | Content |
|-------|---------|
| **Existing** | Extensive `docs/`, health endpoint, audit/feedback JSONL |
| **Verified** | Docs cross-linked from README; health tests |
| **Gaps** | No Prometheus/OTel/Sentry; doc drift risk |
| **Dependencies** | This master suite |
| **Plan** | Maintain five master docs each phase; observability deferred beyond health/audit |
| **Acceptance** | Status scores updated with evidence after each phase |
| **Tests** | Doc review + readiness tests |
| **GPU** | None |
| **Data** | None |
| **Risks** | Stale maturity claims |

---

## Phased backlog

| Phase | Focus | GPU | Status |
|-------|-------|-----|--------|
| **0** | Master docs suite | No | Done |
| **1** | CI + honesty UI + Register + provenance | No | Done |
| **2** | Verify→export ops + deliver UX + scrub docs | No | Done |
| **3** | CPU-safe train contract + experiment manifest + eval gate | Optional | Done |
| **4** | Protected-demo security posture | No | Done |
| **5+** | Real vet fine-tune, PACS/3D, MLflow, KMS/OIDC/AV, clinical validation | Yes / org | Deferred |

## Quality gate (per workstream completion)

1. Implementation exists  
2. Tests pass  
3. Integration verified  
4. Security implications reviewed  
5. Documentation updated  
6. Existing workflows remain functional  
7. Known limitations documented  
