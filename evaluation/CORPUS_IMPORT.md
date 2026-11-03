# Corpus Intake — Static RAG corpus terminology intake (review queue)

## Scope and rationale

VetMind's repository already contains `backend/app/rag/corpus/breed_morphotypes.json`.
This file has suture/synchondrosis names and anatomical-pitfall **source statements**, but it is **not** a validated terminology ontology, an expert-labelled clinical dataset, or a publication with claim-level citations. Corpus Intake does not treat its statements as validated facts.

This module reads **only**:

- Keys under `suture_closure_rules_months.structures` (no numerical closure claims are imported).
- `structure` names under `anatomical_pitfalls` (no clinical interpretation, differential diagnosis, or suggested management text is imported).

It deliberately ignores breed-level clinical inferences, source descriptions, age windows, and bibliography metadata. Source text is used only to create an inspectable **pending-review** queue.

## Commands (project root; Windows PowerShell)

```powershell
.\backend\.venv\Scripts\python.exe benchmarks/import_corpus_terminology.py --dry-run
.\backend\.venv\Scripts\python.exe benchmarks/import_corpus_terminology.py
.\backend\.venv\Scripts\python.exe benchmarks/check_terminology.py --catalog knowledge_base/terminology/cranial_catalog.pending.json
.\backend\.venv\Scripts\python.exe -m pytest evaluation/tests -q
```

Without `--dry-run`, the importer creates two **new** files; it does not overwrite existing files:

- `knowledge_base/terminology/cranial_review_queue.json`: all extracted source name candidates, exact JSON-pointer provenance, SHA-256 source checksum, and review flags.
- `knowledge_base/terminology/cranial_catalog.pending.json`: only the **unqualified, non-composite** suture-name candidates, all with `review_state: pending`, zero aliases and no reviewer. Other source candidates remain in the review queue.

The importer **never changes** the existing `cranial_catalog.json` or the RAG source. If outputs already exist, it exits with a safe error; to update, review/reconcile prior work and choose new output paths explicitly.

## Review workflow

1. Review the queue against the repository source pointer, noting `qualified_label`, `composite_label`, `unscoped_species`, and `duplicate_surface` flags.
2. Have the clinical domain expert verify terminology and context against primary references, including NAV, rather than relying on the source file's bibliography list alone.
3. Expert-reviewed aliases, taxonomy, species scope and sources may later be recorded through a separately approved, manually curated catalog; **no automatic approval** exists in this importer.
4. Evaluate resolver behaviour and any report mapping after approval. A `pending` term is never eligible for clinical equivalence, and no clinical metrics are produced.

## Implementation limitations

- The source SHA-256 digest tracks **file content**, not clinical truth or an electronic signature.
- The importer does not verify referenced literature, report templates, images, study labels, or model performance.
- Ingestion is intended for the team's **static non-patient** repository corpus only. Do not run it on patient-bearing files or arbitrary uploads. The queue intentionally contains the source's structure labels for manual review.
- ``cranial_catalog.pending.json`` is an export artifact, not the active catalog or production RAG.
- For privacy, the CLI summary prints counts/statuses but not raw clinical source strings or parser exceptions.

## Compatibility

All additions live in isolated paths under `evaluation/` and `benchmarks/`. The extractor imports the existing Clinical Terminology `TermEntry`, `TermScope`, and `TermCatalog` classes, avoids touching `backend/app/*`, and requires no images, synthetic cases, or the outstanding 13-section report format.
