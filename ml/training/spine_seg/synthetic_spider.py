#!/usr/bin/env python3
"""Write a tiny fake dataset in the SPIDER layout (software smoke tests only).

The volumes are geometric toys: stacked vertebral blocks with discs between
them and a canal strip behind. They exercise prepare -> train -> evaluate on
CPU without downloading anything; they say nothing about model quality.

Usage:
  python -m ml.training.spine_seg.synthetic_spider --out /tmp/fake_spider
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import numpy as np

from ml.training.spine_seg.labels import to_classes


def synthetic_volume(rng: np.random.Generator, shape_zyx=(64, 48, 10)) -> tuple[np.ndarray, np.ndarray]:
    """Return (image int16, raw SPIDER-valued mask int16) with axes (z, y, x)."""
    nz, ny, nx = shape_zyx
    mask = np.zeros(shape_zyx, dtype=np.int16)
    y0 = int(rng.integers(8, 14))
    body_depth, canal_depth = 14, 5
    x_lo, x_hi = 2, nx - 2
    z, level = 4, 1
    while z + 8 < nz:
        h_vert = int(rng.integers(6, 9))
        mask[z : z + h_vert, y0 : y0 + body_depth, x_lo:x_hi] = level
        z += h_vert
        mask[z : z + 2, y0 + 1 : y0 + body_depth - 1, x_lo:x_hi] = 200 + level
        z += 2
        level += 1
    mask[2 : nz - 2, y0 + body_depth + 1 : y0 + body_depth + 1 + canal_depth, x_lo + 1 : x_hi - 1] = 100
    intensity = {0: 200.0, 1: 600.0, 2: 900.0, 3: 800.0}
    classes = to_classes(mask)
    image = np.vectorize(intensity.get, otypes=[np.float32])(classes)
    image += rng.normal(0, 40, size=image.shape).astype(np.float32)
    return np.clip(image, 0, None).astype(np.int16), mask


def write_mha(path: Path, arr_zyx: np.ndarray, spacing_xyz=(3.3, 0.6, 0.6)) -> None:
    import SimpleITK as sitk

    img = sitk.GetImageFromArray(arr_zyx)
    img.SetSpacing(spacing_xyz)
    sitk.WriteImage(img, str(path), useCompression=True)


def make_dataset(out: Path, *, n_patients: int = 6, n_test: int = 2, seed: int = 0) -> list[str]:
    rng = np.random.default_rng(seed)
    (out / "images").mkdir(parents=True, exist_ok=True)
    (out / "masks").mkdir(parents=True, exist_ok=True)
    rows = []
    for p in range(1, n_patients + 1):
        subset = "validation" if p > n_patients - n_test else "training"
        for seq in ("t1", "t2"):
            name = f"{p}_{seq}"
            image, mask = synthetic_volume(rng)
            write_mha(out / "images" / f"{name}.mha", image)
            write_mha(out / "masks" / f"{name}.mha", mask)
            rows.append({"new_file_name": name, "subset": subset})
    with (out / "overview.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["new_file_name", "subset"])
        writer.writeheader()
        writer.writerows(rows)
    return [r["new_file_name"] for r in rows]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--patients", type=int, default=6)
    args = ap.parse_args(argv)
    names = make_dataset(args.out, n_patients=args.patients)
    print(f"wrote {len(names)} fake series to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
