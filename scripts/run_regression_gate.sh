#!/usr/bin/env bash
# P0.7 — DICOM → multi-image coverage → draft/review path smoke (mock VLM/LLM OK).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
python -m pytest \
  tests/test_dicom_integrity_regressions.py \
  tests/test_analysis_coverage_honesty.py \
  tests/test_png_dicom_transforms.py \
  tests/test_vlm_image_grounding.py \
  tests/test_vlm_study_scale.py \
  tests/test_dicom_anonymize.py \
  tests/test_training_export_verification.py \
  tests/test_queue_reliability.py \
  tests/test_plugin_modularity_smoke.py \
  tests/test_pixel_opt_in_smoke_e2e.py \
  tests/test_hardening_p0.py \
  tests/test_bbox_edit_persistence.py \
  tests/test_evidence_verify_rbac.py \
  tests/test_training_export_api.py \
  -q --tb=line
echo "Regression gate OK"
