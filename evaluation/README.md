# VetMind Evaluation Core — Clinical Evaluation Infrastructure

This standalone package is **infrastructure only**. There are **no clinical cases, DICOM images, fake ground-truth annotations, or official 13-part report rules** in this deliverable.

## Architecture
- `contracts.py`: strict Pydantic versioned input/output contracts.
- `adapters/project.py`: imports project `StructuredFindings` / `DraftReport` at integration time; no core file edits.
- `metrics/geometry.py`: tested 2D box arithmetic. IoU is a mathematical utility, not a validated diagnostic metric.
- `metrics/clinical.py`: readiness gate and lazy reuse of existing metrics engine, no reimplementation of formulas.
- `reports/readiness.py`: explicit missing-data and missing-report-template statuses.
- `benchmarks/run_benchmark.py`: CLI for readiness / manifest verification, not a real clinical benchmark yet.

## Run
From repository root, using Python >=3.11 and Pydantic >=2:

```bash
python benchmarks/run_benchmark.py --output artifacts/evaluation_readiness.json
python -m pytest evaluation/tests -q
```

## Integration caveats
- `evaluation/adapters/project.py` expects `backend` on PYTHONPATH to import `app.schemas.*` when consuming project models.
- `report_sections` exposes the existing FOUR report sections; it is **not** a 13-section official validation mechanism.
- `not_evaluated` is intentionally distinct from passing, failing, or zero accuracy.
- No model training, clinical sensitivity, specificity, MHI, or localization performance is asserted without expert-verified labels and reference imagery.
- Never include identifying patient/owner metadata in manifest files.

## Future milestones
1. Expert-vetted reference schema and 13-part official template (provided by project stakeholders).
2. Independent test records and reference annotation ingestion with source provenance.
3. Deterministic matching policies, error taxonomy, and guarded metric computation.
4. Image-aware localization in validated DICOM coordinate spaces.

## Evaluation Extensions (infrastructure only)

- `terminology.py` holds a deliberately empty, versioned synonym vocabulary. No unverified veterinary synonyms are populated.
- `matching.py` performs deterministic one-to-one matching of findings, anatomy and laterality. Results are structural comparisons, not clinical performance claims.
- `protocol.py` keeps true negatives unknown unless an explicit expert-verified evaluation universe is provided; no expert data exists yet.
- `reports/export.py` writes JSON/CSV/Markdown outputs with atomic file replacement. No patient data is included by default.

These APIs are intended to be used with approved ground truth when available. The 13-section official report template remains unspecified and is not fabricated. Test with `python -m pytest evaluation/tests -q` from repository root.
