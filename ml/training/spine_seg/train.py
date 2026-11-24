#!/usr/bin/env python3
"""Train the 2D spine segmentation U-Net on prepared SPIDER slices.

Every epoch writes <run-dir>/last.pt (resume point) and log.csv; the checkpoint
with the best validation mean Dice is kept as <run-dir>/best.pt. Re-running the
same command with --resume continues after an interrupted session.

Usage:
  python -m ml.training.spine_seg.train --data /data/spider_prepared --run-dir ml/runs/spine-seg
  python -m ml.training.spine_seg.train --data /data/spider_prepared --run-dir ml/runs/spine-seg --resume
"""

from __future__ import annotations

import argparse
import csv
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from ml.evaluation.segmentation import mean_foreground_dice, summarize
from ml.training.spine_seg.data import SliceDataset, build_unet, load_split
from ml.training.spine_seg.evaluate import FOREGROUND, evaluate_series, pick_device
from ml.training.spine_seg.labels import CLASS_NAMES

DATASET = "SPIDER lumbar spine MRI (human), Zenodo 10159290, CC BY 4.0"


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, required=True, help="output dir of prepare_spider")
    ap.add_argument("--run-dir", type=Path, required=True)
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--size", type=int, default=256, help="slice size fed to the network")
    ap.add_argument("--base-channels", type=int, default=32)
    ap.add_argument("--depth", type=int, default=5)
    ap.add_argument("--empty-fraction", type=float, default=0.1)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--val-every", type=int, default=1)
    ap.add_argument("--max-steps", type=int, default=0, help="cap steps per epoch (smoke tests)")
    ap.add_argument("--device", default="auto")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--resume", action="store_true")
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    from monai.losses import DiceCELoss

    args = parse_args(argv)
    torch.manual_seed(args.seed)
    device = pick_device(args.device)
    cuda = device.type == "cuda"
    args.run_dir.mkdir(parents=True, exist_ok=True)
    config = {
        "size": args.size,
        "base_channels": args.base_channels,
        "depth": args.depth,
        "class_names": list(CLASS_NAMES),
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "lr": args.lr,
        "seed": args.seed,
    }

    train_ds = SliceDataset(args.data, load_split(args.data, "train"), size=args.size, augment=True,
                            empty_fraction=args.empty_fraction, seed=args.seed)
    val_names = load_split(args.data, "val")
    loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, num_workers=args.workers,
                        pin_memory=cuda, drop_last=len(train_ds) > args.batch_size,
                        persistent_workers=args.workers > 0)
    print(f"device={device} train_slices={len(train_ds)} val_series={len(val_names)}", flush=True)

    model = build_unet(args.base_channels, args.depth).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)
    scaler = torch.amp.GradScaler(device.type, enabled=cuda)
    loss_fn = DiceCELoss(to_onehot_y=True, softmax=True)

    start_epoch, best = 0, -1.0
    last_path, best_path = args.run_dir / "last.pt", args.run_dir / "best.pt"
    if args.resume and last_path.exists():
        ckpt = torch.load(last_path, map_location=device, weights_only=True)
        model.load_state_dict(ckpt["model"])
        opt.load_state_dict(ckpt["optimizer"])
        sched.load_state_dict(ckpt["scheduler"])
        scaler.load_state_dict(ckpt["scaler"])
        start_epoch, best = ckpt["epoch"] + 1, ckpt["best_val_dice"]
        print(f"resumed from epoch {ckpt['epoch']} (best val dice {best:.4f})", flush=True)

    log_path = args.run_dir / "log.csv"
    log_fields = ["epoch", "train_loss", "val_mean_dice", *(f"val_{c}" for c in FOREGROUND), "lr", "seconds"]
    if not log_path.exists():
        with log_path.open("w", newline="", encoding="utf-8") as f:
            csv.DictWriter(f, fieldnames=log_fields).writeheader()

    for epoch in range(start_epoch, args.epochs):
        t0 = time.time()
        model.train()
        total, steps = 0.0, 0
        for x, y in loader:
            x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
            opt.zero_grad(set_to_none=True)
            with torch.autocast(device_type=device.type, enabled=cuda):
                loss = loss_fn(model(x), y)
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
            total += float(loss.detach())
            steps += 1
            if args.max_steps and steps >= args.max_steps:
                break
        lr = opt.param_groups[0]["lr"]
        sched.step()

        row = {"epoch": epoch, "train_loss": total / max(steps, 1), "lr": lr}
        is_last = epoch == args.epochs - 1
        if val_names and ((epoch + 1) % args.val_every == 0 or is_last):
            rows = evaluate_series(model, args.data, val_names, size=args.size, device=device)
            row["val_mean_dice"] = mean_foreground_dice(rows, FOREGROUND)
            for c in FOREGROUND:
                row[f"val_{c}"] = summarize(r[c] for r in rows)["mean"]
        row["seconds"] = round(time.time() - t0, 1)

        score = row.get("val_mean_dice")
        improved = score is not None and score == score and score > best
        if improved:
            best = score
        state = {
            "model": model.state_dict(),
            "optimizer": opt.state_dict(),
            "scheduler": sched.state_dict(),
            "scaler": scaler.state_dict(),
            "epoch": epoch,
            "best_val_dice": best,
            "config": config,
            "dataset": DATASET,
            "clinically_approved": False,
        }
        torch.save(state, last_path)
        if improved:
            torch.save(state, best_path)
        with log_path.open("a", newline="", encoding="utf-8") as f:
            csv.DictWriter(f, fieldnames=log_fields).writerow(row)
        val_txt = f" val_dice={score:.4f}{' *' if improved else ''}" if score is not None else ""
        print(f"epoch {epoch + 1}/{args.epochs} loss={row['train_loss']:.4f}{val_txt} ({row['seconds']}s)", flush=True)

    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "dataset": DATASET,
        "config": config,
        "best_val_mean_dice": best,
        "checkpoint": best_path.name if best_path.exists() else last_path.name,
        "clinically_approved": False,
        "note": "Human lumbar MRI. Initialization for veterinary spine MRI only; not validated on animals.",
    }
    (args.run_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
