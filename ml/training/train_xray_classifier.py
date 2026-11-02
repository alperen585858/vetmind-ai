#!/usr/bin/env python3
"""Offline XR classifier training stub (PyTorch).

Requires: pip install -r backend/requirements-vision.txt

This script does NOT run inside FastAPI. It writes a checkpoint compatible with
``app.models.entrypoints.xray_monai`` (state_dict + label_names + clinically_approved=False).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Train tiny XR classifier (offline)")
    parser.add_argument("--out", required=True, help="Output .pt path")
    parser.add_argument("--manifest", default="", help="Optional dataset manifest JSON")
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    # Ensure backend package importable when run from repo root.
    repo = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(repo / "backend"))

    from app.models.entrypoints.xray_monai import save_tiny_checkpoint

    labels = None
    if args.manifest:
        raw = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
        labels = list(raw.get("label_names") or []) or None

    # Real training loops belong here once governed data exists.
    # Until then we only emit a random-init checkpoint for integration wiring.
    _ = args.epochs
    out = save_tiny_checkpoint(args.out, label_names=labels, seed=args.seed)
    print(f"Wrote non-clinical checkpoint (clinically_approved=false): {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
