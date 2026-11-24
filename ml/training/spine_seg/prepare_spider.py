#!/usr/bin/env python3
"""Convert the SPIDER dataset into sagittal slice stacks for 2D training.

Input  (Zenodo 10159290, unzipped):
  <spider-dir>/images/<id>_<seq>.mha
  <spider-dir>/masks/<id>_<seq>.mha
  <spider-dir>/overview.csv

Output:
  <out>/series/<name>_image.npy   float16 (n_sagittal, rows, cols), values in [0, 1]
  <out>/series/<name>_label.npy   uint8   same shape, classes from labels.CLASS_NAMES
  <out>/splits.json               {"train": [...], "val": [...], "test": [...]}
  <out>/series_info.json          per-series shape, spacing, sequence, patient

Slices are oriented with superior at the top row and anterior at the left column.

Usage:
  python -m ml.training.spine_seg.prepare_spider --spider-dir /data/spider --out /data/spider_prepared
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import numpy as np

from ml.training.spine_seg.labels import SEQUENCES, build_splits, parse_series_name, to_classes


def to_sagittal_stack(arr_zyx: np.ndarray) -> np.ndarray:
    """Array from an LPS-oriented image (z=S, y=P, x=L) -> (x, rows=S..I, cols=A..P)."""
    if arr_zyx.ndim != 3:
        raise ValueError(f"Expected 3D array, got shape {arr_zyx.shape}")
    return np.ascontiguousarray(np.transpose(arr_zyx, (2, 0, 1))[:, ::-1, :])


def normalize_intensity(vol: np.ndarray, low: float = 0.5, high: float = 99.5) -> np.ndarray:
    """Per-series percentile clipping to [0, 1] (MRI has no absolute intensity scale)."""
    v = vol.astype(np.float32)
    nonzero = v[v > 0]
    ref = nonzero if nonzero.size else v.ravel()
    lo, hi = np.percentile(ref, [low, high])
    if hi <= lo:
        return np.zeros_like(v, dtype=np.float16)
    return ((np.clip(v, lo, hi) - lo) / (hi - lo)).astype(np.float16)


def read_lps(path: Path):
    import SimpleITK as sitk

    img = sitk.DICOMOrient(sitk.ReadImage(str(path)), "LPS")
    return sitk.GetArrayFromImage(img), img.GetSpacing()


def prepare_series(image_path: Path, mask_path: Path) -> tuple[np.ndarray, np.ndarray, dict]:
    img_arr, spacing = read_lps(image_path)
    mask_arr, _ = read_lps(mask_path)
    if img_arr.shape != mask_arr.shape:
        raise ValueError(f"image {img_arr.shape} and mask {mask_arr.shape} differ")
    image = normalize_intensity(to_sagittal_stack(img_arr))
    label = to_classes(to_sagittal_stack(mask_arr))
    sx, sy, sz = spacing
    info = {
        "shape": list(image.shape),
        "spacing_mm": [float(sz), float(sy)],
        "slice_thickness_mm": float(sx),
    }
    return image, label, info


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--spider-dir", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--val-frac", type=float, default=0.15)
    ap.add_argument("--sequences", default=",".join(SEQUENCES), help="comma list of t1,t2,t2_SPACE")
    ap.add_argument("--limit", type=int, default=0, help="process only the first N series (quick check)")
    args = ap.parse_args(argv)

    with (args.spider_dir / "overview.csv").open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    splits = build_splits(rows, val_frac=args.val_frac, sequences=args.sequences.split(","))
    names = sorted(n for names in splits.values() for n in names)
    if args.limit:
        names = names[: args.limit]

    series_dir = args.out / "series"
    series_dir.mkdir(parents=True, exist_ok=True)
    info: dict[str, dict] = {}
    failed: dict[str, str] = {}
    for i, name in enumerate(names, 1):
        patient, sequence = parse_series_name(name)
        try:
            image, label, meta = prepare_series(
                args.spider_dir / "images" / f"{name}.mha", args.spider_dir / "masks" / f"{name}.mha"
            )
        except Exception as exc:  # keep going; report at the end
            failed[name] = f"{type(exc).__name__}: {exc}"
            continue
        np.save(series_dir / f"{name}_image.npy", image)
        np.save(series_dir / f"{name}_label.npy", label)
        info[name] = {**meta, "patient": patient, "sequence": sequence}
        if i % 25 == 0 or i == len(names):
            print(f"[{i}/{len(names)}] {name} {meta['shape']}", flush=True)

    done = set(info)
    kept = {k: [n for n in v if n in done] for k, v in splits.items()}
    (args.out / "splits.json").write_text(json.dumps(kept, indent=2), encoding="utf-8")
    (args.out / "series_info.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    print(json.dumps({k: len(v) for k, v in kept.items()}), f"failed={len(failed)}")
    for name, err in failed.items():
        print(f"  FAILED {name}: {err}", file=sys.stderr)
    return 0 if info else 1


if __name__ == "__main__":
    raise SystemExit(main())
