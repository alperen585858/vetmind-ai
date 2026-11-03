# Pipeline Handoff — Vision → StructuredFindings → DraftReport handoff check

## Why

VetMind already has three backend Pydantic models. The Evaluation Preflight `preflight`
checks their public versions/fields; it does **not** establish whether the
objects from successive steps refer to the same case or carry contradictory
statuses. This addition handles that narrow, useful integration gap.

## New files only

- `evaluation/adapters/handoff.py` — read-only, typed, side-effect-free checker
- `evaluation/tests/test_handoff.py` — 24 checks using empty in-memory
  structural objects, not a benchmark dataset or patient images
- `evaluation/PIPELINE_INTEGRATION.md` — this guide

Do not delete or replace existing evaluation files; add these three files at
repository root in the matching directories. Nothing is added to `backend/`.

## Safe use

The checker requires already parsed Pydantic objects produced by the backend:

```python
from evaluation.adapters.handoff import assess_pipeline_handoff

# vision, findings, and report come from the existing VetMind pipeline.
result = assess_pipeline_handoff(
    vision=vision, findings=findings, report=report
)
print(result.model_dump_json(indent=2))
```

It accepts any subset of the three stages. With fewer than two stages it
returns `not_evaluated` unless it finds an outright contradiction. No new
fixtures, datasets or clinical case examples are included in this package.

## What it checks

- Supported schema versions (exact versions tested against uploaded repo)
- Same case relationship across available stages, without exporting case IDs
- Conflicting execution statuses **only when model lineage matches**, preserving multi-model aggregation
- Provenance differences (`mixed` is acceptable for aggregate output)
- Fixed detection boxes not derived from current input
- Contradictory empty-findings flags (no negative diagnosis inferred)
- Report approved status vs expert approval, immutable state
- Report/generation `synthetic` flag disagreement
- Presence of the four existing report sections, **not** the future 13-point standard

The result exports **only predetermined codes** and counts. It deliberately
never serializes patient IDs, report bodies, full finding descriptions or DICOM
UIDs. The checker makes no clinical accuracy claim, never produces TP/TN/FP/FN,
and does not treat matched IDs as proof the images are actually the same.

A consistent result is merely a structural handoff check. It does NOT mean the
Vision model is trained, the report is accurate, or clinical deployment is safe.

## Test on Windows PowerShell

From `D:\Vetmind\vetmind-ai`:

```powershell
.\backend\.venv\Scripts\python.exe -m pytest evaluation/tests -q
.\backend\.venv\Scripts\python.exe -m pytest evaluation/tests/test_handoff.py -q
```

If the team changes `backend/app/schemas/` versions, update this adapter only
after validating the new schema and expected workflow semantics.

## v0.3 features we did not expand

- No new `AuditChain`: existing backend has separate audit/history infrastructure.
- No new configuration digest: `configuration_digest()` already covers it.
- No API routes, DB migrations, queues, UI modifications, patient data, or datasets.
