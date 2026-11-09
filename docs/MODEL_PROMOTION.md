# Experimental model promotion (LocalTorch)

## Rule

**Never auto-promote** experimental veterinary / LocalTorch checkpoints into the production Gemini VLM/LLM pathway.

Production routing stays env-driven (`VETMIND_LLM_*`, VLM adapters). LocalTorch remains opt-in via `VETMIND_LOCAL_TORCH_*` and readiness blockers.

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
4. Gemini path unchanged unless operators intentionally switch adapters.  
5. Eval harness run recorded; do not fabricate metrics.  

## Experiment manifest

Written by the train script (`schema: vetmind.experiment_manifest.v1`).  
Fields include `promotable_to_production: false` and `production_routing: never_auto_promote_gemini_path`.  
Future MLflow/W&B adapters should map this JSON 1:1 — do not invent clinical scores.
