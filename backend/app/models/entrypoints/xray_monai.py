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


# Pretrained chest-radiograph DenseNet121 from TorchXRayVision (human data). The checkpoint
# keeps its 18 human pathologies as ``source_labels``; ``label_map`` picks the ones reported
# as vet finding codes. Outputs are already sigmoid + operating-point normalized (0.5 = cut).
TXRV_ARCHITECTURE = "txrv_densenet121"
_TXRV_INPUT_SIZE = 224
_TXRV_INTENSITY = 1024.0  # the model expects pixels in [-1024, 1024]

DEFAULT_TXRV_LABEL_MAP: dict[str, str] = {
    "Cardiomegaly": "CARDIOMEGALY_SUSPECTED",
    "Effusion": "PLEURAL_EFFUSION_SUSPECTED",
    "Lung Opacity": "PULMONARY_OPACITY",
    "Pneumothorax": "PNEUMOTHORAX_SUSPECTED",
    "Consolidation": "PULMONARY_CONSOLIDATION_SUSPECTED",
    "Edema": "PULMONARY_EDEMA_SUSPECTED",
    "Nodule": "PULMONARY_NODULE_SUSPECTED",
    "Mass": "THORACIC_MASS_SUSPECTED",
    "Fracture": "FRACTURE_SUSPECTED",
}


def _require_txrv():
    try:
        import torchxrayvision  # type: ignore[import-not-found]

        return torchxrayvision
    except Exception as exc:  # noqa: BLE001
        raise ModelUnavailableError(
            "torchxrayvision unavailable. Install backend/requirements-vision.txt "
            f"({type(exc).__name__})."
        ) from exc


def _build_txrv_module(state: dict[str, Any], *, num_classes: int):
    xrv = _require_txrv()
    op_threshs = state.get("op_threshs")
    module = xrv.models.DenseNet(weights=None, num_classes=num_classes, op_threshs=op_threshs)
    module.load_state_dict(state)
    return module


def _txrv_input(x):  # noqa: ANN001 — torch tensor (1, H, W) in [0, 1]
    """Pad to square (no anatomy cropped), resize to 224 with MONAI, scale to [-1024, 1024]."""
    try:
        from monai.transforms import Resize, SpatialPad  # type: ignore[import-not-found]
    except Exception as exc:  # noqa: BLE001
        raise ModelUnavailableError(
            f"MONAI unavailable. Install backend/requirements-vision.txt ({type(exc).__name__})."
        ) from exc
    side = int(max(x.shape[-2], x.shape[-1]))
    x = SpatialPad((side, side))(x)
    x = Resize((_TXRV_INPUT_SIZE, _TXRV_INPUT_SIZE), mode="area")(x)
    x = x.as_tensor() if hasattr(x, "as_tensor") else x
    return (x * 2.0 - 1.0) * _TXRV_INTENSITY


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
        self._architecture = "tiny_xr_classifier"
        self._output_index: list[int] | None = None  # txrv: model outputs reported, in label order

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
        if isinstance(payload, dict) and payload.get("architecture") == TXRV_ARCHITECTURE:
            self._load_txrv(payload)
            return
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

    def _load_txrv(self, payload: dict[str, Any]) -> None:
        source = payload.get("source_labels")
        state = payload.get("state_dict")
        if not isinstance(source, (list, tuple)) or not source or not isinstance(state, dict):
            raise ModelUnavailableError(
                f"Checkpoint for {self.model_id!r} ({TXRV_ARCHITECTURE}) needs source_labels "
                "and state_dict. No silent mock fallback."
            )
        label_map = payload.get("label_map") or DEFAULT_TXRV_LABEL_MAP
        picked = [(i, str(label_map[name])) for i, name in enumerate(source) if name in label_map]
        if not picked:
            raise ModelUnavailableError(
                f"Checkpoint for {self.model_id!r}: label_map matches none of source_labels."
            )
        try:
            module = _build_txrv_module(state, num_classes=len(source))
        except ModelUnavailableError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise ModelUnavailableError(
                f"Incompatible XR weights for {self.model_id!r}: {type(exc).__name__}."
            ) from exc
        self._module = module.to(self.device).eval()
        self._output_index = [i for i, _ in picked]
        self._label_names = [code for _, code in picked]
        self._architecture = TXRV_ARCHITECTURE
        self._ready = True

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
            if self._output_index is not None:
                x = _txrv_input(x[0].cpu()).unsqueeze(0).to(self.device)
            with torch.no_grad():
                out = self._module.forward(x)
                if self._output_index is None:
                    out = torch.sigmoid(out)
                probs = out.detach().cpu().numpy().reshape(-1)
            if self._output_index is not None:
                probs = probs[self._output_index]
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
        if self._architecture == TXRV_ARCHITECTURE:
            warnings.append(
                "Weights were trained on human chest radiographs (TorchXRayVision); "
                "performance on animal radiographs is unknown."
            )

        meta = {
            "adapter": "xray_monai",
            "device": self.device,
            "weight_digest_sha256": self._cached.digest_sha256,
            "calibrated": "false",
            "clinically_validated": "false",
            "raw_scores": ",".join(f"{n}={s:.4f}" for n, s in zip(self._label_names, scores)),
            "architecture": self._architecture,
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


def save_txrv_checkpoint(
    path: str,
    *,
    weights: str = "densenet121-res224-all",
    model_id: str = "vet-xr-thorax-v1",
    version: str = "0.1.0-txrv-human",
    label_map: dict[str, str] | None = None,
) -> str:
    """Export a TorchXRayVision DenseNet121 into a plain (weights_only-loadable) checkpoint.

    Downloads the pretrained weights on first use (~30 MB into ~/.torchxrayvision).
    """
    torch = require_torch()
    xrv = _require_txrv()
    module = xrv.models.DenseNet(weights=weights)
    payload = {
        "model_id": model_id,
        "version": version,
        "architecture": TXRV_ARCHITECTURE,
        "source_weights": f"torchxrayvision:{weights}",
        "source_labels": list(module.pathologies),
        "label_map": dict(label_map or DEFAULT_TXRV_LABEL_MAP),
        "clinically_approved": False,
        "notes": "Human chest radiograph weights; demo/initialization only, not veterinary-validated.",
        "state_dict": module.state_dict(),
    }
    torch.save(payload, path)
    return path
