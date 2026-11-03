# VetMind AI Evaluation Preflight — Structural Preflight & Traceability

The Evaluation Preflight extension adds **only new files**, without replacing the working
v0.2 packages, modifying backend or frontend sources, or adding clinical cases.

## Modules

| Module | Responsibility |
|---|---|
| `evaluation/configuration.py` | Immutable, strict run policy; versioned JSON schema; configuration SHA-256 |
| `evaluation/traceability.py` | Reproducibility receipts containing only non-identifying metadata |
| `evaluation/audit_ledger.py` | Bounded-action software preflight hash chain; not authenticated clinical audit |
| `evaluation/preflight.py` | Compose existing integrity and backend compatibility into safe preflight results |
| `benchmarks/preflight.py` | Offline CLI with bounded JSON, duplicate-key rejection, and redacted errors |

## Run on Windows (from project root)

```powershell
.\backend\.venv\Scripts\python.exe -m pytest evaluation/tests -q
.\backend\.venv\Scripts\python.exe benchmarks/preflight.py
.\backend\.venv\Scripts\python.exe benchmarks/preflight.py --check-backend
.\backend\.venv\Scripts\python.exe benchmarks/preflight.py --output artifacts/preflight_v03.json
```

- `0` means software structural validation completed without blocking issues.
- `2` means input rejection or blocking incompatibility.
- `clinical_status` always remains `not_evaluated` and `clinical_metrics` is `null`.
- `trace.receipt_sha256` detects accidental receipt changes; it is not a digital
  signature, HMAC, or proof of identity.
- `audit` contains enumerated events only. It does not replace production audit
  logs, identity verification, access controls, regulatory review, or radiologist
  report approval.
- When a real dataset is later available, it must pass separately defined
  permission, de-identification and expert-annotation review before any evaluation.

## Integration boundaries

Only `evaluation/` and `benchmarks/` are added. Neither directory is a service
entry point in the production FastAPI application. No database schema or queue
is changed. Existing image models and reporting rules are not touched.

No new clinical image data, clinical labels, mock clinical cases or official
13-section report requirements are assumed.

### Important privacy caveat

`preflight.py --records` accepts schema records for local/offline checking.
While the **output** is designed to omit case IDs and narrative content, the
**input files** may still contain identifying metadata: do not commit or share
them. Use access controls and approved data handling procedures. Aggregate
counts may reveal information for very small datasets and should not be
published without privacy review.

## Compatibility

The extension relies on the existing v0.2 `evaluation/contracts.py`,
`evaluation/integrity.py`, `evaluation/fingerprints.py`, `evaluation/versioning.py`,
and `evaluation/reports/export.py` modules. Do not install this archive alone.
