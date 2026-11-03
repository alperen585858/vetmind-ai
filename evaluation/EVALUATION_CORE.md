# VetMind AI — Evaluation Core infrastructure extension (additive package)

**Scope:** data-contract checks, version compatibility, read-only adapters, batch
integrity, offline validation CLI. The official 13-section report schema,
clinical images, expert labels, and clinical scores are intentionally absent.

## Compatibility

- Python 3.11+ and Pydantic 2.x.
- Designed for the uploaded VetMind backend contracts:
  `StructuredFindings` 1.3.0, `ModelTaskOutputs` 1.0.0, `DraftReport` 1.0.0.
- No edits to `backend/`, `frontend/`, databases or existing Evaluation Core files.
- Tests constructing minimal metadata records are **software fixtures**, **not**
  annotated clinical cases or a benchmark dataset.

## Modules

- `evaluation/versioning.py`: explicit supported schema version intervals;
  rejects unexpected major/minor revisions instead of silently accepting.
- `evaluation/integrity.py`: batch uniqueness, reference-source consistency,
  input provenance, case modality/scope and execution-status checks. A valid
  integrity report does not mean a clinically valid model.
- `evaluation/fingerprints.py`: deterministic digests of reviewed
  **non-personal** configuration and contract JSON Schema. Do not hash patient
  data and describe it as de-identified.
- `evaluation/adapters/vision.py`: conservative inspection of the existing
  model-task output types; validates boxes without interpreting them clinically.
- `evaluation/adapters/compatibility.py`: compares imported backend Pydantic
  contracts and current versions without modifying production code.
- `benchmarks/validate_contracts.py`: prints JSON Schema or checks JSON
  manifest and records. Does not perform a benchmark or generate a clinical score.

## Commands (Windows PowerShell, repository root)

```powershell
.\backend\.venv\Scripts\python.exe -m pytest evaluation/tests -q
.\backend\.venv\Scripts\python.exe benchmarks/run_benchmark.py --output artifacts/evaluation_readiness.json
.\backend\.venv\Scripts\python.exe benchmarks/validate_contracts.py --schema manifest
.\backend\.venv\Scripts\python.exe benchmarks/validate_contracts.py --schema record
```

When actual approved contracts become available, the `--manifest` and
`--records` arguments support validation of local, access-controlled JSON:

```text
python benchmarks/validate_contracts.py --manifest PATH.json --records PATH.json --output PATH.json
```

`--records` expects a JSON array, not DICOM or clinical report text.
Argument errors exit `2`; an invalid integrity report exits `1`; passing
structural checks exit `0`. The CLI avoids printing Pydantic input values to
stderr when a contract fails. Avoid sharing raw record files or output paths
that may expose identifying identifiers.

## Safety limitations

- **No expert truth labels:** do not compute sensitivity, specificity, MHI,
  clinical model rankings, or absence of disease.
- **No image series:** no validated 2D/3D coordinates, IoU against expert boxes,
  or diagnostic imaging claims.
- **Unknown 13-section standard:** any 13-section conformity score remains
  `not_evaluated`. Existing four-field `DraftReport` is not that standard.
- `valid` from `validate_inputs` means **structurally consistent only**.
- Model output `structurally_valid` means **parseable geometry only**.
- Schema compatibility checks target the uploaded snapshot. After the team
  changes a contract, update and verify version ranges intentionally.

## Suggested local Git workflow

Keep changes on `feat/clinical-benchmark-engine`; **do not push** until the
full A module is reviewed. To review this addition use:

```powershell
git status --short
git diff --no-index -- NUL evaluation/versioning.py
```

The `git diff --no-index` example returns code `1` for detected differences;
this is normal. `git add` is not needed to run Python tests.
