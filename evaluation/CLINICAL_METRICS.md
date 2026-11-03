# Clinical Metrics — offline evaluation toolkit

This module adds an **evidence-gated** evaluation layer to VetMind AI's existing
`evaluation/` package. It **does not produce diagnoses**, approve reports, train
models, or assert clinical validation. It does not implement the unprovided
13-section report template, and it does not bundle clinical DICOM images, fake
case files or artificial ground-truth datasets.

## What this solves

The backend already contains `ClinicalClassificationMetrics`, which calculates
sensitivity, specificity, F1, F2, Matthews correlation coefficient, and Wilson
confidence intervals. The new layer **reuses those calculations** rather than
creating a competing library. The missing pieces were the input contract,
review prerequisites, completeness checks, proper undefined-metric semantics,
and an aggregate-only command-line interface.

| Component | Responsibility |
| --- | --- |
| `clinical_metrics/contracts.py` | Strict Pydantic contracts, reference status, review record and opportunity universe |
| `clinical_metrics/classification.py` | Verified opportunity counts, backend metric reuse, undefined-score handling |
| `clinical_metrics/localization.py` | Region-level 2D IoU on explicitly confirmed same-frame pairings |
| `clinical_metrics/pairing_audit.py` | Structural terminology matching is inspected, **not** promoted to clinical TP/FP/FN |
| `clinical_metrics/manifest_gate.py` | Compare target model, dataset, and review metadata with the existing `EvaluationManifest` |
| `clinical_metrics/results.py` | Stable, aggregate-only output schemas and `not_evaluated`/`undefined` distinction |
| `benchmarks/evaluate_clinical_metrics.py` | Offline JSON contract validation and safe JSON reporting |
| `tests/test_clinical_metrics_*.py` | Unit, contract, privacy and CLI regression checks |

### Data needed before actual measurement

- **Defined target**: exact label, unit of analysis (case / image / region), and
  evaluation scope. These must not change unnoticed during comparison.
- **Expert-confirmed reference**: vetted positive **and** negative opportunities,
  an auditable review reference and explicit handling of disagreements.
- **Real model predictions**: the complete prediction set from a known model
  version, with missing predictions explicitly distinguished from negatives.
- **Exhaustive observation universe**: one record per opportunity, not just one
  record per *detected finding*. An empty prediction list is **not** a negative
  clinical image.
- **Matched localization**: if measuring IoU, reference and prediction boxes
  must refer to the same image/frame and native pixel coordinate space, with
  an expert-confirmed correspondence. Incorrect coordinates or missing frame
  references block measurement.

`expert_verified` and `review_record_id` are claims supplied by the source
system. The toolkit **cannot verify that a radiologist actually signed off**.
The surrounding clinical data governance process must enforce that. Even when
metric arithmetic is `ready`, the result sets `clinical_validation` to
`not_evaluated` until a separate study validates the clinical procedure.

### Existing manifest compatibility

Use `check_manifest_alignment(manifest, scope)` when a VetMind
`EvaluationManifest` accompanies the evaluation. It checks model identity,
dataset version, declared review status and task. A metadata match is
**not proof** that the review really happened. The CLI currently validates
only the submitted metric input; manifest alignment is a separate integration
step for the case-management workflow.

### Metric definitions and edge cases

- **TP**: reference positive and model positive for the same opportunity.
- **FP**: reference negative and model positive for the same opportunity.
- **FN**: reference positive and model negative for the same opportunity.
- **TN**: reference negative and model negative in a **defined, complete** set
  of evaluation opportunities. TN is never inferred from missing findings.
- **Sensitivity**, **specificity**, **precision**, **NPV**, **F1**, **F2**, **MCC**
  and **balanced accuracy** are returned with value `null` and status
  `undefined` if their mathematical denominator or verified negatives are
  unavailable. This differs from a genuine result of `0.0`.
- **Wilson intervals** from the existing backend are included for sensitivity
  and precision when their denominators are defined. They estimate sampling
  uncertainty, not proof of model calibration or clinical safety.
- **IoU**, mean and median IoU are limited to annotated matched pairs. They do
  not measure detection recall, segmentation accuracy or patient-level
  diagnosis. A 2D region score is not a 3D CT/MR volume score.

### Running the package (PowerShell)

From the repository root:

```powershell
.\backend\.venv\Scripts\python.exe -m pytest evaluation/tests -q
.\backend\.venv\Scripts\python.exe benchmarks/evaluate_clinical_metrics.py
.\backend\.venv\Scripts\python.exe benchmarks/evaluate_clinical_metrics.py --output artifacts/metrics_readiness.json
```

By default the CLI returns `not_evaluated`. It does not generate sample cases or
reference images. After real, reviewed inputs are available, it supports:

```powershell
.\backend\.venv\Scripts\python.exe benchmarks/evaluate_clinical_metrics.py --kind observations --input <approved-input.json> --output artifacts/metrics_summary.json
```

Other `--kind` values are `counts` (externally audited confusion counts) and
`localization` (expert-paired pixel-space boxes). A JSON file must match the
appropriate Pydantic `ClassificationInput`, `CountEvaluationInput`, or
`LocalizationInput` schema. See `evaluation/clinical_metrics/contracts.py`.

### Result privacy

CLI output contains only aggregate counts, rates, fixed blocker codes,
non-sensitive model/dataset labels, and the requested evaluation ID. Unit IDs,
frame tokens, reviewer record IDs, image content and report text are **not**
serialized to the output. Do not put names, owner information, or raw patient
IDs into the visible model/dataset/evaluation identifiers. Real clinical source
files must be handled under the project's approved access and retention policy.

### Known limitations

- The unit tests exercise arithmetic and input validation on tiny abstract
  values; they are **not clinical benchmark examples**.
- There is no reference-image ingestion, real ground truth, confirmed reviewer
  integration or official report rubric yet.
- Structural pairing output is a separate audit; it is intentionally not
  converted automatically to false positives/negatives.
- Dataset splits and leakage must be externally audited before final clinical
  estimates. A numerical CI alone does not address selection or label bias.
- We intentionally did **not** implement a model-ranking system. Equal dataset
  names or sample sizes do not establish that two models saw identical cases.
- Existing backend `evaluation/` and `app/evaluation/metrics.py` are untouched;
  no second FastAPI service, database or task queue is created.
