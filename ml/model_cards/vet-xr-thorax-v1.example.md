# Model card — vet-xr-thorax-v1 (example)

| Field | Value |
|-------|--------|
| Model ID | vet-xr-thorax-v1 |
| Version | 0.0.1-example |
| Modality / region | XR / THORAX |
| Species | canine, feline |
| Framework | PyTorch (`xray_monai` entrypoint) |
| clinically_approved | **false** |
| Intended use | Decision-support research / integration testing only |
| Out of scope | Autonomous diagnosis, human radiology transfer without revalidation |

## Data

- Patient-level splits required
- License / DUA: TBD

## Metrics (placeholder)

- Holdout macro-F1: n/a
- ECE: n/a
- External site validation: not done

## Deployment approval

- [ ] Metrics reviewed
- [ ] Species coverage reviewed
- [ ] Expert radiologist sign-off
- [ ] `clinically_approved=true` only after above
