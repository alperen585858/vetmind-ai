# VetMind AI — Audit Part 1: AI Architecture

Scope (read-only): `backend/app/models/`, `routing/`, `orchestration/`, `schemas/`, `llm/`, `rag/`, `container.py`.  
Verdict: Adapter Protocols and versioned I/O are sound for mocks; several gaps block safe real Vision/LLM swap.

---

### F1 — Remote HTTP status coerced to SUCCESS — FIXED
- **Severity:** P0
- **Where:** `models/http_vision.py` → `RemoteVisionResponse` / `_map_response`
- **Issue:** Unknown `execution_status` fell back to SUCCESS.
- **Resolution:** Strict Pydantic wire validation; missing/null/empty/unknown status → `ImagingAdapterError`. Valid SUCCESS/PARTIAL/FAILED preserved; FAILED ignores finding payloads.
- **AC:** Met (`tests/test_http_vision.py`).
- **External resources:** No (schema only). Yes if vendor defines the wire format.

### F2 — Real Vision co-runs with mocks (no exclusive replace) — FIXED
- **Severity:** P1
- **Where:** `routing/execution_policy.py`, `container.py`, `orchestration/orchestrator.py`
- **Issue:** Remote + mocks both matched and ran → silent MIXED fusion.
- **Resolution:** `ModelCapability.source_kind` + `ModelExecutionPolicy` (`exclusive_real` default / `mixed` via `VETMIND_VISION_EXECUTION_POLICY`). Applied after scenario policy; unsupported → manual review unchanged.
- **AC:** Met (`tests/test_execution_policy.py`).
- **External resources:** No.

### F3 — Hardcoded remote capability footprint — FIXED
- **Severity:** P1
- **Where:** `routing/remote_config.py`, `settings.py`, `container.py`
- **Issue:** Remote claimed broad modality/region coverage by default.
- **Resolution:** Explicit env/settings (`VETMIND_VISION_MODALITIES/REGIONS/SPECIES/PRIORITY/ENABLED/SOURCE_KIND`); invalid/missing declaration fails at startup via `VisionConfigError`.
- **AC:** Met (`tests/test_remote_capabilities.py`).
- **External resources:** Yes — vendor capability matrix.

### F4 — `ImagingModelInput.prepared_for_models` ignores live registry
- **Severity:** P2
- **Where:** `models/model_input_builder.py` → `build_imaging_model_input`
- **Issue:** Uses `default_capabilities()`, not router/container capabilities (remote omitted).
- **Fix:** Pass active capabilities into the builder (or query `ModelRouter.list_capabilities()`).
- **AC:** `prepared_for_models` includes remote id when registered.
- **External resources:** No.

### F5 — Protocol says no mutate; `ensure_model_input` mutates case — FIXED
- **Severity:** P1
- **Where:** `models/model_input_builder.py`, `orchestration/orchestrator.py`, `schemas/model_input.py`, `http_vision.py`
- **Issue:** Adapters/builders mutated `case.model_input`.
- **Resolution:** Orchestrator attaches input; adapters use `require_model_input` (read-only); `ImagingModelInput` frozen; `ensure_model_input` no longer assigns.
- **AC:** Met (`tests/test_model_input_immutability.py`).
- **External resources:** No.

### F6 — Evidence refs lack DICOM anchors — FIXED
- **Severity:** P1
- **Where:** `schemas/findings.py` → `EvidenceReference`; `models/evidence_validation.py`; `normalizer.normalize_outputs`
- **Issue:** Evidence lacked structured DICOM identifiers.
- **Resolution:** Optional study/series/SOP UIDs + `frame_index`; validated against `ImagingModelInput`; dangling/invalid flagged; free-text preserved; no fabricated evidence.
- **AC:** Met (`tests/test_evidence_refs.py`).
- **External resources:** Yes — vendor evidence schema.

### F7 — `Finding.synthetic` defaults True — FIXED
- **Severity:** P1
- **Where:** `schemas/findings.py` → `Finding`; `http_vision._map_finding`; `normalizer.normalize_outputs`
- **Issue:** Schema default labeled REAL findings synthetic.
- **Resolution:** `Finding.synthetic` default False; mocks set True; HTTP derives from `source_kind`; contradictions flagged (not rewritten); REAL ≠ clinical validation warning.
- **AC:** Met (`tests/test_provenance.py`, HTTP contradiction case).
- **External resources:** No.

### F8 — No registry↔capability consistency check — FIXED
- **Severity:** P1
- **Where:** `routing/registry_validation.py`; `container.py`
- **Issue:** Orphan capabilities failed only mid-analyze.
- **Resolution:** `validate_registry_capabilities` at startup; enabled orphans / incompatible duplicates raise `RegistryConsistencyError`; disabled caps not routed.
- **AC:** Met (`tests/test_registry_consistency.py`).
- **External resources:** No.

### F9 — Conflict detection is string-location only
- **Severity:** P2
- **Where:** `models/normalizer.py` → `detect_potential_conflicts`
- **Issue:** Real models with different location phrasing won’t conflict-flag; same phrasing + different codes may over-flag.
- **Fix:** Prefer codes + series/SOP anchors; keep location as soft signal.
- **AC:** Documented fixtures for conflict/no-conflict with divergent labels.
- **External resources:** No (policy); clinical ontology optional later.

### F10 — Pixel authorization never enabled in builder — FIXED
- **Severity:** P1
- **Where:** `models/pixel_authorization.py`, `model_input_builder.py`, `schemas/model_input.py`, `capabilities.allows_pixel_analysis`
- **Issue:** No gated authorization path for future pixel inference.
- **Resolution:** Default-deny policy (confirmation, integrity, source permission, consent, model capability); mocks denied; auth≠loading; reasons recorded without sensitive paths; test fixture can authorize without decoding pixels.
- **AC:** Met (`tests/test_pixel_authorization.py`).
- **External resources:** Yes — secure pixel load / vendor runtime (still not implemented).

### F11 — LLM provider not settings-swappable — FIXED
- **Severity:** P1
- **Where:** `llm/factory.py`, `llm/http_provider.py`, `settings.py`, `container.py`
- **Issue:** LLM stuck on mock despite Protocol.
- **Resolution:** `VETMIND_LLM_PROVIDER=mock|stub|http`; HTTP adapter uses VetMind wire contract (not arbitrary vendor APIs); no startup network; invalid config → `LLMConfigError`.
- **AC:** Met (`tests/test_llm_provider_config.py`).
- **External resources:** Yes — LLM vendor API (optional; generic HTTP only).

### F12 — LLM failures not typed; full `CaseRecord` in request — FIXED
- **Severity:** P2
- **Where:** `llm/interfaces.py` (`LLMGenerationInput`, `LLMProviderError*`); `llm/gateway.py`; `orchestration/orchestrator.py`
- **Issue:** Full CaseRecord outbound; untyped failures; silent fallback risk.
- **Resolution:** Minimal generation DTO (opaque `case_id`, findings, RAG); typed timeout/malformed/unavailable errors; orchestrator fails without draft/mock fallback.
- **AC:** Met (`tests/test_llm_safe_dto.py`).
- **External resources:** No (DTO); yes for vendor privacy review.

### F13 — RAG scores / notes misleading for real grounding
- **Severity:** P2
- **Where:** `rag/retriever.py` → `LexicalRagRetriever.retrieve`; `schemas/rag.py` → `RagSearchResponse.note`; `llm/gateway.py` → `generate_draft`
- **Issue:** Lexical scores inflated (~0.97); schema note denies embeddings while embedding backend exists; citations not bound to findings.
- **Fix:** Honest score semantics; update note; optional finding↔passage link field; never treat RAG as clinical evidence in validator.
- **AC:** Scores documented; embedding method reflected; drafts still require review without RAG-as-proof.
- **External resources:** Yes for production embeddings/vector DB; no for note/score fix.

### F14 — Sync blocking Vision HTTP, no retry/timeout policy
- **Severity:** P2
- **Where:** `models/http_vision.py` → `analyze`; `models/interfaces.py` → `ImagingModel`
- **Issue:** Sync `httpx.Client`, fixed timeout, no retries/idempotency; Protocol is sync-only.
- **Fix:** Shared HTTP policy (timeout/retry/backoff); optional async adapter or worker-bound calls.
- **AC:** Transient 503 retried; hard timeout → `ImagingAdapterError`.
- **External resources:** Yes if vendor SLA/async job API.

---

## Priority order
1. ~~F1, F2, F7 (safety/provenance)~~ — done  
2. ~~F3, F5, F6, F8, F10, F11~~ — done  
3. ~~F12~~ — done; remaining: F4, F9, F13, F14 (hardening)

## External dependency summary
| Need | Findings |
|------|----------|
| Vendor Vision wire + capability matrix | F1, F3, F6, F14 |
| Pixel/runtime authz | F10 |
| LLM vendor | F11, F12 |
| Prod embeddings/vector DB | F13 (optional) |
| None (in-repo) | F2, F4, F5, F7, F8, F9 |
