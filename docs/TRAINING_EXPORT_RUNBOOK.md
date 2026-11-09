# Training export runbook (verify → JSONL)

**API:** `POST /api/v1/training/export`  
**Capability:** `CAP_TRAINING_VERIFY` (expert/admin when auth enabled; unrestricted demo principal when auth off)  
**UI:** Admin → Model Performance → Training export panel  
**Client:** `exportTrainingDataset()` in `src/lib/backend.ts`

## Purpose

Export **expert-verified** evidence rows for offline training / evaluation. This is Goal A software — not clinical model performance.

## Preconditions

1. Case analyzed with findings + evidence references.  
2. Radiologist **verified** evidence in workspace (`action: verify`).  
3. Prefer `policy: verified_only` (default).  
4. Understand scrub limits: DICOM identity scrub is best-effort (`backend/app/dicom/anonymize.py`) — **not** certified de-identification. Export asserts no `patient_name` keys and blocks name-like `patient_id` values.

## Steps (product UI)

1. Sign in as expert (or admin).  
2. Open case → Radiologist workspace → verify bbox evidence.  
3. Open **Model Performance**.  
4. In **Training export**, set dataset version (e.g. `demo-2026-11-09`).  
5. Keep policy `verified_only`, splits on.  
6. Run export → review manifest `row_count` / `split_counts` / `export_id`.  
7. Download JSONL if needed for `ml/training` offline scripts.

## Steps (API / e2e)

```http
POST /api/v1/training/export
Content-Type: application/json

{
  "dataset_version": "demo-1",
  "policy": "verified_only",
  "case_ids": ["case-…"],
  "include_splits": true
}
```

Playwright helper: `e2e/helpers/annotation.ts` → `exportTraining`.

## Outputs

| Field | Meaning |
|-------|---------|
| `manifest` | Export id, policy, counts, creator, split counts |
| `jsonl` | Newline-delimited rows (PHI-scrubbed ids) |
| `rows` | Parsed row objects |
| `splits` | Optional train/val/test patient-level partitions |

## Patient split

Uses `ml/evaluation/patient_split.py` via backend — asserts no patient leakage across splits when splits are requested.

## Failure modes

| Symptom | Likely cause |
|---------|----------------|
| 403 | Auth on without training capability |
| 400 Patient split failed | Degenerate split fractions / empty cohorts |
| 500 PHI scrub failed | Unexpected identity fields — do not ship |
| `row_count: 0` | No verified evidence yet |

## Related

- [MASTER_ROADMAP.md](MASTER_ROADMAP.md) WS5/WS6  
- [RELEASE_READINESS.md](RELEASE_READINESS.md) scrub statement  
- `backend/tests/test_training_export_api.py`  
