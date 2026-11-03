# Schema Compatibility — Pydantic contract shape drift guard

**Purpose.** The existing Evaluation Core compatibility check detects missing public fields and
unsupported schema versions. This complementary check also detects changing types
at the Vision → StructuredFindings → DraftReport boundary, including nested
bounding boxes, evidence references, detection flags, and report sections.

**What it does not do.** No pixel data are opened, no case data are read, no
synthetic patient examples are generated, no expert ground truth is invented, and
no 13-section template is assumed. A `compatible` result establishes only a
structural declaration check, **not** clinical or runtime end-to-end validation.

## Install

Extract the `evaluation/` and `benchmarks/` folders into the repository root.
The patch contains only new paths and does not replace existing backend or Evaluation Core
files. Do not delete the current 219-test package.

## Verify

From the repository root on Windows PowerShell:

```powershell
.\backend\.venv\Scripts\python.exe -m pytest evaluation/tests -q
.\backend\.venv\Scripts\python.exe benchmarks/check_contract_shapes.py
.\backend\.venv\Scripts\python.exe benchmarks/check_contract_shapes.py --output artifacts/schema_shapes.json
```

On a checkout with the same backend contracts as the reviewed ZIP, the status
should be `compatible`. If a teammate updates a public contract, the checker
fails closed and reports model/field names plus fixed problem codes, without
including source records, case IDs or patient text. The CLI uses exit code 2
for incompatible or unavailable dependencies, suitable for future CI use.

## Why these rules?

- A backend field *existing* does not mean that its type is still the type the
  evaluation adapter expects. A new `finding_id: int` breaks the matching layer
  even when the field name and schema version remain unchanged.
- Optionality changes can alter the meaning of missing scores, detection heads,
  and evidence references. Such changes are flagged for review.
- The four current DraftReport sections are checked as objects with `text` and
  `cited_finding_ids`. No claim about the future 13-section rubric is made.

## Boundaries

- The checker imports only the **existing schema classes**. It does not run
  FastAPI startup, model inference, persistence, or any patient operation.
- The checks deliberately cover public fields required by Evaluation Core, rather than
  recursively validating every private backend property.
- Enum checks verify *enum type* but do not prove clinical meaning of their
  values. Those tests belong to later domain-specific stages.
- `list[BoundingBox2D]` and `Optional[DetectionOutput]` are compared by declared
  type, not by artificially constructing image/patient data.

The output may be committed as a structural CI artifact, but should not be
reported as evidence of model accuracy, expert validation, or medical safety.
