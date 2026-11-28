# Experimental model promotion (LocalTorch)

## Rule

**Never auto-promote** experimental veterinary / LocalTorch checkpoints into the routed analysis path.

There is no production model path. The default install runs mock Vision and a mock LLM; the
general-purpose VLM (e.g. Gemini, `VETMIND_VLM_ENABLED=1`) and LocalTorch (`VETMIND_LOCAL_TORCH_*`)
are both opt-in, env-driven and not validated on veterinary data. The CT/MR LocalTorch entrypoints
(`ct_monai`, `mri_monai`) are tiny contract models: they are registered as mock probes and never routed.

## Stages

```text
export JSONL (verified_only)
  → ml/training/train_xray_classifier.py  (CPU-safe tiny loop OK)
  → checkpoint clinically_approved=false
  → ml/runs/<id>/manifest.json
  → (optional) copy under artifacts/ for LocalTorch demo
  → readiness API must still show honest blockers until weights+opt-in
  → external clinical validation required before clinically_approved=true
```

## Checklist before any LocalTorch enablement

1. Checkpoint `clinically_approved` is `false` unless formal validation exists.  
2. SHA pin / weight cache fail-closed configured.  
3. Pixel analysis opt-in explicit.  
4. Configured VLM / LLM adapters unchanged unless operators intentionally switch them.  
5. Eval harness run recorded; do not fabricate metrics.  

## Experiment manifest

Written by the train script (`schema: vetmind.experiment_manifest.v1`).  
Fields include `promotable_to_production: false` and `production_routing: never_auto_promote_gemini_path` (legacy field value; it means the checkpoint is never auto-routed).  
Future MLflow/W&B adapters should map this JSON 1:1 — do not invent clinical scores.
