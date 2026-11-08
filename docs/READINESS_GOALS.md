# VetMind readiness goals (do not conflate)

## Goal A — Pre-training software ready

Software can ingest multi-DICOM studies, run honest inventory/decode/visual coverage,
ground findings to verified loci, enforce auth/tenant/scrub baselines, and export
**expert-verified** labels with patient-level splits.

Not claimed: clinical performance, certified de-identification, KMS encryption, or
“safe for real PHI clinic use.”

## Goal B — Clinical-use ready

Requires Goal A plus production encryption/KMS, real malware signatures, OIDC,
clinical validation protocols, and institutional policy — tracked as P2+ hardening.

**Rule:** Never market Goal A as Goal B. Demo/seed approvals stay `clinically_validated=false`.
