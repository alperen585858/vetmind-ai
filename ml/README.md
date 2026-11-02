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
