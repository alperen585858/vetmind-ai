"""Which local PyTorch entrypoints and checkpoints are tiny contract models.

The CT and MR entrypoints (``ct_monai`` / ``mri_monai``) only ever build a tiny pooled
classifier that exists to exercise the bridge contract in tests. They are not trained on
imaging data and contain no MONAI network, so the platform must never present them as a
real Vision model: they are registered as mock / synthetic probes and are not routed
into analysis. A tiny checkpoint loaded by the XR entrypoint is flagged with a warning.

Import-light on purpose (no torch, no entrypoint modules): routing and readiness code
import this at startup.
"""

from __future__ import annotations

TINY_CONTRACT = "tiny_contract"
TRAINED_NETWORK = "trained_network"

CONTRACT_ONLY_ENTRYPOINT_MODULES = frozenset(
    {
        "app.models.entrypoints.ct_monai",
        "app.models.entrypoints.mri_monai",
    }
)

TINY_ARCHITECTURES = frozenset(
    {
        "tiny_ct_classifier",
        "tiny_mri_classifier",
        "tiny_xr_classifier",
    }
)

TINY_CONTRACT_WARNING = (
    "Tiny contract model: a wiring/contract test network that was not trained on imaging "
    "data. Its scores are not findings."
)

CONTRACT_ONLY_DESCRIPTION = (
    "Tiny contract model (CT/MR; no trained network) — mock, not routed into analysis"
)


def entrypoint_module(spec: str | None) -> str:
    """``package.module:factory`` → ``package.module``."""
    return (spec or "").split(":", 1)[0].strip()


def is_contract_only_entrypoint(spec: str | None) -> bool:
    """True for entrypoints that can only run a tiny contract classifier."""
    return entrypoint_module(spec) in CONTRACT_ONLY_ENTRYPOINT_MODULES


def is_tiny_architecture(architecture: str | None) -> bool:
    return str(architecture or "").strip().lower() in TINY_ARCHITECTURES


def entrypoint_model_kind(spec: str | None) -> str:
    return TINY_CONTRACT if is_contract_only_entrypoint(spec) else TRAINED_NETWORK
