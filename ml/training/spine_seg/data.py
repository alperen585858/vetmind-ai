"""Torch side: slice dataset, model, and whole-series prediction."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Sequence

import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.data import Dataset

from ml.training.spine_seg.labels import NUM_CLASSES


def build_unet(base_channels: int = 32, depth: int = 5) -> torch.nn.Module:
    from monai.networks.nets import UNet

    return UNet(
        spatial_dims=2,
        in_channels=1,
        out_channels=NUM_CLASSES,
        channels=tuple(base_channels * 2**i for i in range(depth)),
        strides=(2,) * (depth - 1),
        num_res_units=2,
        norm="batch",
    )


def to_model_space(x: torch.Tensor, size: int, mode: str) -> torch.Tensor:
    """(C, H, W) -> (C, size, size): zero-pad bottom/right to a square, then resize.

    Padding keeps the aspect ratio, so the anatomy is not stretched.
    """
    _, h, w = x.shape
    side = max(h, w)
    x = F.pad(x, (0, side - w, 0, side - h))
    kwargs = {"align_corners": False} if mode == "bilinear" else {}
    return F.interpolate(x[None], size=(size, size), mode=mode, **kwargs)[0]


def from_model_space(logits: torch.Tensor, h: int, w: int) -> torch.Tensor:
    """Inverse of to_model_space for logits: (C, size, size) -> (C, h, w)."""
    side = max(h, w)
    up = F.interpolate(logits[None], size=(side, side), mode="bilinear", align_corners=False)[0]
    return up[:, :h, :w]


def load_split(data_dir: Path, split: str) -> list[str]:
    return json.loads((data_dir / "splits.json").read_text(encoding="utf-8"))[split]


def load_series(data_dir: Path, name: str) -> tuple[np.ndarray, np.ndarray]:
    d = data_dir / "series"
    return (
        np.load(d / f"{name}_image.npy", mmap_mode="r"),
        np.load(d / f"{name}_label.npy", mmap_mode="r"),
    )


def _augmentations():
    from monai.data import set_track_meta
    from monai.transforms import (
        Compose,
        RandAffined,
        RandGaussianNoised,
        RandScaleIntensityd,
        RandShiftIntensityd,
    )

    set_track_meta(False)  # plain tensors out, no MetaTensor bookkeeping
    # No flips: anterior/posterior and superior/inferior are anatomically fixed.
    return Compose(
        [
            RandAffined(
                keys=("image", "label"),
                mode=("bilinear", "nearest"),
                prob=0.5,
                rotate_range=(0.17,),
                scale_range=(0.1, 0.1),
                translate_range=(12, 12),
                padding_mode="zeros",
            ),
            RandScaleIntensityd(keys="image", factors=0.15, prob=0.5),
            RandShiftIntensityd(keys="image", offsets=0.1, prob=0.5),
            RandGaussianNoised(keys="image", std=0.02, prob=0.2),
        ]
    )


class SliceDataset(Dataset):
    """Sagittal slices of prepared series.

    All slices containing anatomy are used; a fraction of empty (lateral) slices
    is kept so the model also learns to predict nothing.
    """

    def __init__(
        self,
        data_dir: Path,
        names: Sequence[str],
        *,
        size: int = 256,
        augment: bool = False,
        empty_fraction: float = 0.1,
        seed: int = 0,
    ) -> None:
        self.size = size
        self.series = {n: load_series(data_dir, n) for n in names}
        rng = np.random.default_rng(seed)
        self.index: list[tuple[str, int]] = []
        for name, (_, label) in self.series.items():
            has_fg = np.asarray(label).reshape(label.shape[0], -1).any(axis=1)
            for k in range(label.shape[0]):
                if has_fg[k] or rng.random() < empty_fraction:
                    self.index.append((name, k))
        self.transform = _augmentations() if augment else None

    def __len__(self) -> int:
        return len(self.index)

    def __getitem__(self, i: int) -> tuple[torch.Tensor, torch.Tensor]:
        name, k = self.index[i]
        image, label = self.series[name]
        img = to_model_space(torch.from_numpy(np.array(image[k], dtype=np.float32))[None], self.size, "bilinear")
        lbl = to_model_space(torch.from_numpy(np.array(label[k], dtype=np.float32))[None], self.size, "nearest")
        if self.transform is not None:
            out = self.transform({"image": img, "label": lbl})
            img, lbl = out["image"], out["label"]
        return torch.as_tensor(img).float(), torch.as_tensor(lbl).round().long()


@torch.no_grad()
def predict_volume(
    model: torch.nn.Module,
    image: np.ndarray,
    *,
    size: int,
    device: torch.device,
    batch_size: int = 16,
) -> np.ndarray:
    """Predict every sagittal slice of a series at its native resolution."""
    model.eval()
    n, h, w = image.shape
    pred = np.zeros((n, h, w), dtype=np.uint8)
    for start in range(0, n, batch_size):
        chunk = np.array(image[start : start + batch_size], dtype=np.float32)
        x = torch.stack([to_model_space(torch.from_numpy(s)[None], size, "bilinear") for s in chunk]).to(device)
        with torch.autocast(device_type=device.type, enabled=device.type == "cuda"):
            logits = model(x).float()
        for j in range(logits.shape[0]):
            pred[start + j] = from_model_space(logits[j], h, w).argmax(0).cpu().numpy().astype(np.uint8)
    return pred
