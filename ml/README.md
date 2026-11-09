# VetMind offline ML (training / evaluation)

This tree is **not** imported by the FastAPI app by default.

Use it on GPU workstations to collect governed veterinary datasets, train/fine-tune
PyTorch+MONAI models, evaluate with patient-level splits, and publish model cards
before copying approved weights into `artifacts/` for production inference.

## Layout

```text
ml/
  datasets/       # manifests, licenses, patient splits
  training/       # train scripts (require requirements-vision.txt)
  evaluation/     # metrics + leakage checks
  model_cards/    # versioned approval docs
  configs/        # YAML train/infer configs
```

## Rules

- Split by **patient/animal ID** (never by frame).
- Human radiology weights are initialization only — not clinically reliable for veterinary use.
- Do not mark `clinically_approved=true` without external validation + human sign-off.
- Production loads weights via `VETMIND_LOCAL_TORCH_*` entrypoints under `backend/app/models/entrypoints/`.
- **Never auto-promote** checkpoints over the Gemini production path — see [docs/MODEL_PROMOTION.md](../docs/MODEL_PROMOTION.md).

## CPU-safe train contract

```bash
# from repo root, with backend/requirements-vision.txt installed
python ml/training/train_xray_classifier.py \
  --jsonl ml/datasets/fixtures/tiny_export.jsonl \
  --out /tmp/vet-xr-tiny.pt \
  --epochs 3 \
  --run-dir ml/runs/local-smoke
```

- Reads training-export JSONL (`finding_code` required for a real loop).
- Uses **synthetic pixels** when DICOM pixel paths are absent (software gate only).
- Writes `clinically_approved=false` checkpoint + `ml/runs/*/manifest.json`.
- Refuses unlabeled JSONL unless `--allow-empty-fallback` (wiring smoke only).
