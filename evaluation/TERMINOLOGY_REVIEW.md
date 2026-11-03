# VetMind AI — Terminology Review: Clinical Terminology and Review Workflow

## What is implemented

Clinical Terminology is an **offline, read-only, clinical-terminology infrastructure** for the existing FastAPI modular monolith. It does not modify `backend/app/*`, the RAG source, or `frontend/*`.

- **Terminology Catalog:** Review-gated Pydantic terminology catalog, scope-aware canonical term resolver, explicit laterality interpretation and deterministic finding pairing.
- **Corpus Intake:** Static RAG source candidate extraction with exact SHA-256 source digest, stable candidate IDs, JSON source pointers, non-overwriting pending review queue and pending draft catalog.
- **Review Workflow:** Deterministic review plan: flags composites, collisions, already present labels, items for manual review; controlled `ReviewSubmission` decisions (`propose_for_expert_review`, `defer`, `exclude`), stale-source and duplicate checks. Decisions **never activate** a term.
- **Backend Integration:** Read-only adapter for the existing `app.schemas.findings.StructuredFindings`, with model provenance, supported species/regions, laterality and review-gated term resolvability. No model API or production service is changed.

## Current project limitations

- No expert-reviewed terms in the shipped active `cranial_catalog.json`.
- No DICOM images or expert-labeled cases available for clinical evaluation.
- The official 13-section report standard is pending. Four DraftReport fields must **not** be interpreted as the official 13 sections.
- `AnatomicalRegion` currently exposes `BRAIN`, `CERVICAL`, `THORAX`, `OTHER`, and `UNKNOWN`. The Clinical Terminology bridge **does not invent** `CRANIUM` as an existing backend region. Brain/cervical can be inspected; unsupported regions remain unassessed.
- CLI results are structural workflow statuses, not sensitivity, specificity, or evidence of medical validity.

## Windows PowerShell commands (repository root)

```powershell
.\backend\.venv\Scripts\python.exe -m pytest evaluation/tests -q
.\backend\.venv\Scripts\python.exe benchmarks/check_contract_shapes.py
.\backend\.venv\Scripts\python.exe benchmarks/import_corpus_terminology.py --dry-run
.\backend\.venv\Scripts\python.exe benchmarks/terminology_review.py plan
.\backend\.venv\Scripts\python.exe benchmarks/terminology_review.py plan --output artifacts/terminology_review_plan.json
```

The plan CLI uses the static RAG source by default; if an existing exported queue exists, add `--queue knowledge_base/terminology/cranial_review_queue.json` to detect drift. `--output` creates a new file **only if the destination does not already exist**. Generated `artifacts/` files are ignored by the repo.

Optional source extraction, if output files do not already exist:

```powershell
.\backend\.venv\Scripts\python.exe benchmarks/import_corpus_terminology.py
```

If the queue/draft files already exist, the importer exits without replacing them. The catalog `cranial_catalog.json` is never overwritten. Generated queue/draft files are ignored by the local `knowledge_base/terminology/.gitignore` to keep PRs focused.

## Human review submission contract

A `ReviewSubmission` JSON object must have `source_sha256` (equal to the current queue's checksum), `decisions` (zero or more), and optionally `schema_version` (`1.0.0`). Each decision includes only a `candidate_id`, `action` and controlled `reason`. No arbitrary clinical text or patient details are accepted.

Run validation with:

```powershell
.\backend\.venv\Scripts\python.exe benchmarks/terminology_review.py check --submission path\to\decisions.json
```

A proposal is merely an item in the expert's review workflow. It does not certify identity, authority, clinical correctness, provenance or source quality. The project needs a **separately authorized, auditable expert process** before anything may be intentionally marked `expert_reviewed` in an active catalog.

## Verification and scope of confidence

Run tests in the user's actual checkout before commit. The included test suite uses invented software strings, not synthetic radiology cases or clinical imaging. Passing tests establishes software behavior only, not clinical validity. No patient data is included or required.
