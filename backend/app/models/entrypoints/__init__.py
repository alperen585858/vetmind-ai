"""Pluggable VisionEntrypoint factories (PyTorch / MONAI).

Importing this package does not import torch. Individual modules lazy-import
deep learning deps inside load()/infer().
"""

from __future__ import annotations

from app.models.entrypoints.ct_monai import build_entrypoint as build_ct_entrypoint
from app.models.entrypoints.mri_monai import build_entrypoint as build_mri_entrypoint
from app.models.entrypoints.xray_monai import build_entrypoint as build_xray_entrypoint

__all__ = [
    "build_xray_entrypoint",
    "build_ct_entrypoint",
    "build_mri_entrypoint",
]
