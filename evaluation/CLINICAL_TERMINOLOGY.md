# VetMind AI — Terminology Catalog Contextual Terminology Core

This is the **first Clinical Terminology infrastructure package**, not the completed terminology
ontology or a clinical validation study. It is designed to extend the existing
`evaluation.terminology` and `evaluation.matching` utilities without changing
them or touching any team's backend/frontend application files.

## Motivation

The Evaluation Core vocabulary is a flat, versioned alias dictionary. It cannot distinguish
a feline term from a canine term, a finding from an anatomical location, an
unreviewed suggestion from an approved term, or an in-scope from an out-of-scope
alias. Terminology Catalog adds those controls rather than duplicating clinical scoring.

## Files and functions

- `evaluation/clinical_terminology/catalog.py`: strict Pydantic versioned
  catalog; scope, source references and **explicit reviewer** required to mark
  an entry `expert_reviewed`. Colliding reviewed labels are rejected when scopes
  overlap. The software cannot independently authenticate a claimed reviewer.
- `evaluation/clinical_terminology/resolver.py`: conservative scoped lookup;
  outcomes `resolved`, `pending_review`, `ambiguous`, `out_of_scope`, `unknown`.
  Only a resolved reviewed term can be used for a clinical-equivalence claim.
- `evaluation/clinical_terminology/laterality.py`: literal English/Turkish
  side-marker extraction. Unknown/ambiguous side never becomes a wildcard.
  This is not a radiology narrative interpretation algorithm.
- `evaluation/clinical_terminology/pairing.py`: deterministic 1:1 pairing of
  known finding+anatomy+side codes. It does **not** turn unmatched results into
  false positives/negatives or emit model performance statistics.
- `benchmarks/check_terminology.py`: standalone schema/catalog inspector;
  prints only bounded summary metadata, not clinical text.
- `knowledge_base/terminology/cranial_catalog.json`: deliberately **empty**
  and versioned. No unreviewed medical synonym is shipped as fact.

## Use

From repo root in PowerShell:

```powershell
.\backend\.venv\Scripts\python.exe -m pytest evaluation/tests -q
.\backend\.venv\Scripts\python.exe benchmarks/check_terminology.py --catalog knowledge_base/terminology/cranial_catalog.json
.\backend\.venv\Scripts\python.exe benchmarks/check_terminology.py --schema
```

The initial empty catalog returns `empty_catalog` and
`clinical_validation: not_evaluated`. This is intentional.

## Scope and next step

Corpus Intake will import candidate terms from the **existing** VetMind RAG corpus into a
review queue, retain provenance and source pointers, and require expert sign-off
before activating clinical synonyms. Review Workflow will test controlled equivalence and
hierarchical anatomy without treating parent and child locations as identical.
No DICOM files, expert-verified cases, synthetic cases or the future 13-section
report template are needed for this infrastructure.

The tests use artificial engineering strings such as `term_alpha` and
`finding_a`. Those are not veterinary diagnoses or benchmark cases.
