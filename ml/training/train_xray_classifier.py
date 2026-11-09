#!/usr/bin/env python3
"""Offline XR classifier training (CPU-safe tiny loop).

Requires: pip install -r backend/requirements-vision.txt

This script does NOT run inside FastAPI and never auto-promotes into the
production Gemini VLM path. Checkpoints are always clinically_approved=false.

Pixel DICOM loaders are not required for the software contract: when rows lack
pixels, deterministic synthetic tensors are generated from evidence_id so the
train→checkpoint→LocalTorch wiring can be verified on CPU.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
    return rows


def _label_of(row: dict[str, Any]) -> str | None:
    for key in ("finding_code", "label", "label_name"):
        val = row.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return None


def _synthetic_chw(evidence_id: str, label_index: int, size: int = 32):
    """Deterministic synthetic image so training works without DICOM pixels."""
    import numpy as np

    digest = hashlib.sha256(f"{evidence_id}|{label_index}".encode("utf-8")).digest()
    seed = int.from_bytes(digest[:8], "little") % (2**32 - 1)
    rng = np.random.default_rng(seed)
    img = rng.random((1, size, size), dtype=np.float32)
    # Paint a weak class cue so the tiny net can fit in a few epochs.
    band = (label_index * 3) % size
    img[:, band : band + 2, :] = 0.9
    return img


def _write_experiment_manifest(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Train tiny XR classifier from export JSONL (offline)")
    parser.add_argument("--out", required=True, help="Output .pt checkpoint path")
    parser.add_argument("--jsonl", default="", help="Training export JSONL (preferred)")
    parser.add_argument("--manifest", default="", help="Optional dataset manifest JSON with label_names")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--lr", type=float, default=1e-2)
    parser.add_argument("--run-dir", default="", help="Optional ml/runs/<id> directory for experiment manifest")
    parser.add_argument(
        "--allow-empty-fallback",
        action="store_true",
        help="If JSONL missing/empty, emit random-init checkpoint (integration only)",
    )
    args = parser.parse_args()

    repo = _repo_root()
    sys.path.insert(0, str(repo / "backend"))

    from app.models.entrypoints.xray_monai import TinyXRClassifier, save_tiny_checkpoint
    from app.models.entrypoints._common import require_torch

    torch = require_torch()
    device = "cuda" if torch.cuda.is_available() else "cpu"

    rows: list[dict[str, Any]] = []
    if args.jsonl:
        jsonl_path = Path(args.jsonl)
        if not jsonl_path.is_file():
            raise SystemExit(f"JSONL not found: {jsonl_path}")
        rows = _load_jsonl(jsonl_path)

    label_names: list[str] | None = None
    if args.manifest:
        raw = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
        label_names = list(raw.get("label_names") or []) or None

    labeled = [(r, _label_of(r)) for r in rows]
    labeled = [(r, lab) for r, lab in labeled if lab]
    if not labeled:
        if not args.allow_empty_fallback and args.jsonl:
            raise SystemExit(
                "No labeled rows (need finding_code/label). Refusing silent random checkpoint. "
                "Pass --allow-empty-fallback only for wiring smoke tests."
            )
        out = save_tiny_checkpoint(args.out, label_names=label_names, seed=args.seed)
        print(f"Wrote non-clinical fallback checkpoint (clinically_approved=false): {out}")
        return 0

    labels_sorted = sorted({lab for _, lab in labeled})
    if label_names:
        # Keep declared order; append any extras from data.
        for lab in labels_sorted:
            if lab not in label_names:
                label_names.append(lab)
    else:
        label_names = labels_sorted
    label_to_idx = {name: i for i, name in enumerate(label_names)}

    torch.manual_seed(args.seed)
    module = TinyXRClassifier(num_classes=len(label_names)).to(device)
    module.net.train()
    opt = torch.optim.Adam(module.net.parameters(), lr=args.lr)
    loss_fn = torch.nn.CrossEntropyLoss()

    xs = []
    ys = []
    for row, lab in labeled:
        idx = label_to_idx[lab]
        arr = _synthetic_chw(str(row.get("evidence_id") or row.get("finding_id") or lab), idx)
        xs.append(torch.from_numpy(arr))
        ys.append(idx)
    x = torch.stack(xs).to(device)
    y = torch.tensor(ys, dtype=torch.long, device=device)

    started = time.time()
    last_loss = None
    for epoch in range(max(1, args.epochs)):
        opt.zero_grad(set_to_none=True)
        logits = module.forward(x)
        loss = loss_fn(logits, y)
        loss.backward()
        opt.step()
        last_loss = float(loss.detach().cpu().item())
        print(f"epoch={epoch + 1}/{args.epochs} loss={last_loss:.4f} device={device}")

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "model_id": "vet-xr-thorax-v1",
        "version": "0.0.2-cpu-train",
        "architecture": "tiny_xr_classifier",
        "label_names": label_names,
        "num_classes": len(label_names),
        "clinically_approved": False,
        "state_dict": module.state_dict(),
        "train_meta": {
            "epochs": args.epochs,
            "final_loss": last_loss,
            "n_rows": len(labeled),
            "device": device,
            "synthetic_pixels": True,
            "source_jsonl": str(Path(args.jsonl).resolve()) if args.jsonl else None,
        },
    }
    torch.save(payload, str(out_path))

    run_dir = Path(args.run_dir) if args.run_dir else (repo / "ml" / "runs" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    manifest = {
        "schema": "vetmind.experiment_manifest.v1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "framework": "pytorch",
        "device": device,
        "checkpoint_path": str(out_path.resolve()),
        "clinically_approved": False,
        "promotable_to_production": False,
        "production_routing": "never_auto_promote_gemini_path",
        "n_rows": len(labeled),
        "label_names": label_names,
        "epochs": args.epochs,
        "final_loss": last_loss,
        "duration_s": round(time.time() - started, 3),
        "notes": "CPU-safe contract train on synthetic pixels from export labels. Not clinical.",
    }
    _write_experiment_manifest(run_dir / "manifest.json", manifest)
    print(f"Wrote non-clinical checkpoint (clinically_approved=false): {out_path}")
    print(f"Experiment manifest: {run_dir / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
