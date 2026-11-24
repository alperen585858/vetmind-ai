#!/usr/bin/env python3
"""Evaluate a spine segmentation checkpoint with per-series 3D Dice.

Usage:
  python -m ml.training.spine_seg.evaluate \
    --checkpoint ml/runs/spine-seg/best.pt --data /data/spider_prepared --split test \
    --out ml/runs/spine-seg/test_results.json
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Sequence

import numpy as np
import torch

from ml.evaluation.segmentation import dice_per_class, mean_foreground_dice, summarize
from ml.training.spine_seg.data import build_unet, load_series, load_split, predict_volume
from ml.training.spine_seg.labels import CLASS_NAMES, NUM_CLASSES, parse_series_name

FOREGROUND = CLASS_NAMES[1:]


def pick_device(name: str = "auto") -> torch.device:
    if name == "auto":
        name = "cuda" if torch.cuda.is_available() else "cpu"
    return torch.device(name)


def evaluate_series(
    model: torch.nn.Module,
    data_dir: Path,
    names: Sequence[str],
    *,
    size: int,
    device: torch.device,
    batch_size: int = 16,
) -> list[dict]:
    rows: list[dict] = []
    for name in names:
        image, label = load_series(data_dir, name)
        pred = predict_volume(model, image, size=size, device=device, batch_size=batch_size)
        scores = dice_per_class(pred, np.asarray(label), NUM_CLASSES)
        rows.append({"series": name, "sequence": parse_series_name(name)[1], **dict(zip(FOREGROUND, scores))})
    return rows


def summarize_rows(rows: Sequence[dict]) -> dict:
    sequences = sorted({r["sequence"] for r in rows})
    return {
        "n_series": len(rows),
        "mean_foreground_dice": mean_foreground_dice(rows, FOREGROUND),
        "per_class": {c: summarize(r[c] for r in rows) for c in FOREGROUND},
        "per_sequence": {
            s: {c: summarize(r[c] for r in rows if r["sequence"] == s) for c in FOREGROUND} for s in sequences
        },
    }


def load_checkpoint(path: Path, device: torch.device) -> tuple[torch.nn.Module, dict]:
    ckpt = torch.load(path, map_location=device, weights_only=True)
    cfg = ckpt["config"]
    model = build_unet(cfg["base_channels"], cfg["depth"]).to(device)
    model.load_state_dict(ckpt["model"])
    return model, ckpt


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--checkpoint", type=Path, required=True)
    ap.add_argument("--data", type=Path, required=True, help="output dir of prepare_spider")
    ap.add_argument("--split", default="test", choices=("train", "val", "test"))
    ap.add_argument("--out", type=Path, required=True, help="summary JSON (per-series CSV is written next to it)")
    ap.add_argument("--device", default="auto")
    ap.add_argument("--batch-size", type=int, default=16)
    args = ap.parse_args(argv)

    device = pick_device(args.device)
    model, ckpt = load_checkpoint(args.checkpoint, device)
    names = load_split(args.data, args.split)
    rows = evaluate_series(model, args.data, names, size=ckpt["config"]["size"], device=device,
                           batch_size=args.batch_size)

    summary = {
        "checkpoint": str(args.checkpoint),
        "epoch": ckpt["epoch"],
        "split": args.split,
        "dataset": ckpt["dataset"],
        "clinically_approved": False,
        "note": "Human lumbar MRI (SPIDER). Not validated on veterinary images.",
        **summarize_rows(rows),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    with args.out.with_suffix(".csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["series", "sequence", *FOREGROUND])
        writer.writeheader()
        writer.writerows(rows)
    print(json.dumps({"mean_foreground_dice": summary["mean_foreground_dice"],
                      **{c: summary["per_class"][c]["mean"] for c in FOREGROUND}}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
