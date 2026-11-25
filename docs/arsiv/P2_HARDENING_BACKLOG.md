# P2 hardening backlog (after P0 security baseline)

- DICOMweb / DICOMDIR + viewer multi-frame fan-out / 3D-MPR
- Encryption KMS + real BlobEncryptor (replace fail-closed `none`)
- Real AV signature DB (replace UnavailableScanner)
- OIDC / IdP instead of demo JWT users
- Queue scale, ETA calibration, RAG corpus ops

Do not claim clinical-data-OK until P0.5 protected baseline + encryption are real.
