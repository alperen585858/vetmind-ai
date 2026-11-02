"""X-ray 2D VisionEntrypoint (PyTorch; optional torchvision/MONAI).

Weights are required. Untrained / non-approved checkpoints may emit raw scores
with explicit warnings — never claim clinical validation.
"""

from __future__ import annotations

import time
from typing import Any

import numpy as np

from app.models.entrypoint import InferenceRequest, InferenceResult
from app.models.entrypoints._common import (
    checkpoint_label_names,
    load_prepared_array,
    require_torch,
    scores_to_classification,
)
from app.models.errors import InferenceFailedError, InferenceTimeoutError, ModelUnavailableError
from app.models.weight_cache import CachedWeights, load_torch_checkpoint
from app.schemas.enums import ModelExecutionStatus, SourceKind
from app.schemas.model_outputs import ModelTaskOutputs

_DEFAULT_LABELS = [
    "PULMONARY_OPACITY",
    "CARDIOMEGALY_SUSPECTED",
    "PLEURAL_EFFUSION_SUSPECTED",
]


class TinyXRClassifier:
    """Minimal CHW → logits module used for contract/integration tests."""

    def __init__(self, num_classes: int = 3) -> None:
        torch = require_torch()
        self.net = torch.nn.Sequential(
            torch.nn.AdaptiveAvgPool2d((8, 8)),
            torch.nn.Flatten(),
            torch.nn.Linear(8 * 8, 32),
            torch.nn.ReLU(),
            torch.nn.Linear(32, num_classes),
        )

    def to(self, device: str) -> "TinyXRClassifier":
        self.net.to(device)
        return self

    def eval(self) -> "TinyXRClassifier":
        self.net.eval()
        return self

    def load_state_dict(self, state: dict[str, Any]) -> None:
        self.net.load_state_dict(state)

    def state_dict(self) -> dict[str, Any]:
        return self.net.state_dict()

    def forward(self, x):  # noqa: ANN001
        return self.net(x)


class XRayMonaiEntrypoint:
    """Local XR classifier entrypoint."""

    def __init__(
        self,
        *,
        model_id: str,
        version: str,
        weights_path: str | None = None,
        weights_sha256: str | None = None,
        device: str = "cpu",
        timeout_s: float = 30.0,
        score_threshold: float = 0.5,
        **_kwargs: Any,
    ) -> None:
        self.model_id = model_id
        self.version = version
        self.weights_path = weights_path
        self.weights_sha256 = weights_sha256
        self.device = device
        self.timeout_s = timeout_s
        self.score_threshold = score_threshold
        self._ready = False
        self._cached: CachedWeights | None = None
        self._module: Any = None
        self._label_names: list[str] = list(_DEFAULT_LABELS)
        self._clinically_approved = False

    def load(self) -> None:
        torch = require_torch()
        self._cached = load_torch_checkpoint(
            self.weights_path,
            model_id=self.model_id,
            version=self.version,
            device=self.device,
            expected_sha256=self.weights_sha256,
        )
        payload = self._cached.payload
        self._label_names = checkpoint_label_names(payload, _DEFAULT_LABELS)
        self._clinically_approved = bool(
            isinstance(payload, dict) and payload.get("clinically_approved") is True
        )
        num_classes = len(self._label_names)
        module = TinyXRClassifier(num_classes=num_classes).to(self.device).eval()
        state = None
        if isinstance(payload, dict):
            state = payload.get("state_dict") or payload.get("model")
        if state is None and not isinstance(payload, dict):
            # Raw state_dict
            state = payload
        if state is None:
            raise ModelUnavailableError(
                f"Checkpoint for {self.model_id!r} has no state_dict. "
                "No silent mock fallback."
            )
        try:
            module.load_state_dict(state)
        except Exception as exc:  # noqa: BLE001
            raise ModelUnavailableError(
                f"Incompatible XR weights for {self.model_id!r}: {type(exc).__name__}."
            ) from exc
        self._module = module
        self._ready = True
        _ = torch  # silence lint if unused beyond require

    def is_ready(self) -> bool:
        return self._ready

    def infer(self, request: InferenceRequest) -> InferenceResult:
        if not self._ready or self._module is None or self._cached is None:
            raise ModelUnavailableError(f"Entrypoint {self.model_id!r} not loaded.")
        torch = require_torch()
        start = time.monotonic()
        try:
            arr = load_prepared_array(request.prepared)
            if arr.ndim == 2:
                arr = arr[np.newaxis, ...]
            if arr.ndim != 3:
                raise InferenceFailedError(
                    f"XR entrypoint expects CHW/HW tensor, got shape {arr.shape}."
                )
            # Ensure C=1
            if arr.shape[0] not in (1, 3):
                raise InferenceFailedError(
                    f"XR channel axis unexpected: shape {arr.shape} (want CHW)."
                )
            x = torch.from_numpy(arr).unsqueeze(0).to(self.device)
            if x.shape[1] == 3:
                x = x.mean(dim=1, keepdim=True)
            with torch.no_grad():
                logits = self._module.forward(x)
                probs = torch.sigmoid(logits).detach().cpu().numpy().reshape(-1)
            scores = [float(p) for p in probs.tolist()]
            # Pad/truncate to label count
            while len(scores) < len(self._label_names):
                scores.append(0.0)
            scores = scores[: len(self._label_names)]
            classification = scores_to_classification(
                label_names=self._label_names,
                scores=scores,
                threshold=self.score_threshold,
            )
        except (InferenceFailedError, ModelUnavailableError):
            raise
        except Exception as exc:  # noqa: BLE001
            if time.monotonic() - start > self.timeout_s:
                raise InferenceTimeoutError(
                    f"XR inference timed out after {self.timeout_s}s."
                ) from exc
            raise InferenceFailedError(
                f"XR inference failed: {type(exc).__name__}: {exc}"
            ) from exc

        if time.monotonic() - start > self.timeout_s:
            raise InferenceTimeoutError(
                f"XR inference timed out after {self.timeout_s}s."
            )

        warnings = [
            "X-ray Vision output is decision-support only; not clinically validated.",
            "Absences are not confirmed; empty/low-score labels do not mean a normal study.",
        ]
        if not self._clinically_approved:
            warnings.append(
                "Checkpoint clinically_approved=false — raw model scores only."
            )

        meta = {
            "adapter": "xray_monai",
            "device": self.device,
            "weight_digest_sha256": self._cached.digest_sha256,
            "calibrated": "false",
            "clinically_validated": "false",
            "raw_scores": ",".join(f"{n}={s:.4f}" for n, s in zip(self._label_names, scores)),
            "architecture": str(
                (self._cached.meta or {}).get("architecture") or "tiny_xr_classifier"
            ),
        }
        status = ModelExecutionStatus.SUCCESS
        if not classification.labels:
            # No label crossed threshold — success with empty findings (not mock).
            warnings.append(
                "No labels exceeded score threshold; no findings emitted "
                "(does not imply normal study)."
            )

        return ModelTaskOutputs(
            model_id=self.model_id,
            model_version=self.version,
            case_id=request.case_id,
            execution_status=status,
            source_kind=SourceKind.REAL,
            classification=classification,
            warnings=warnings,
            processing_metadata=meta,
        )


def build_entrypoint(
    *,
    model_id: str,
    version: str,
    weights_path: str | None = None,
    device: str = "cpu",
    timeout_s: float = 30.0,
    **kwargs: Any,
) -> XRayMonaiEntrypoint:
    """Factory for ``VETMIND_LOCAL_TORCH_ENTRYPOINT=app.models.entrypoints.xray_monai:build_entrypoint``."""
    return XRayMonaiEntrypoint(
        model_id=model_id,
        version=version,
        weights_path=weights_path,
        device=device,
        timeout_s=timeout_s,
        **kwargs,
    )


def save_tiny_checkpoint(
    path: str,
    *,
    model_id: str = "vet-xr-thorax-v1",
    version: str = "0.0.1-test",
    label_names: list[str] | None = None,
    seed: int = 0,
) -> str:
    """Write a tiny random-init checkpoint for integration tests (requires torch)."""
    torch = require_torch()
    labels = list(label_names or _DEFAULT_LABELS)
    torch.manual_seed(seed)
    module = TinyXRClassifier(num_classes=len(labels))
    payload = {
        "model_id": model_id,
        "version": version,
        "architecture": "tiny_xr_classifier",
        "label_names": labels,
        "num_classes": len(labels),
        "clinically_approved": False,
        "state_dict": module.state_dict(),
    }
    out = path
    torch.save(payload, out)
    return out
