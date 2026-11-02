"""MRI 3D VisionEntrypoint (PyTorch + optional MONAI).

No HU assumptions — intensity normalization is owned by the MRI prep profile.
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
    "BRAIN_LESION_SUSPECTED",
    "MASS_EFFECT_SUSPECTED",
    "SPINAL_CORD_COMPRESSION_SUSPECTED",
]


class TinyMRIClassifier:
    def __init__(self, num_classes: int = 3) -> None:
        torch = require_torch()
        self.net = torch.nn.Sequential(
            torch.nn.AdaptiveAvgPool3d((4, 4, 4)),
            torch.nn.Flatten(),
            torch.nn.Linear(4 * 4 * 4, 32),
            torch.nn.ReLU(),
            torch.nn.Linear(32, num_classes),
        )

    def to(self, device: str) -> "TinyMRIClassifier":
        self.net.to(device)
        return self

    def eval(self) -> "TinyMRIClassifier":
        self.net.eval()
        return self

    def load_state_dict(self, state: dict[str, Any]) -> None:
        self.net.load_state_dict(state)

    def state_dict(self) -> dict[str, Any]:
        return self.net.state_dict()

    def forward(self, x):  # noqa: ANN001
        return self.net(x)


class MRIMonaiEntrypoint:
    def __init__(
        self,
        *,
        model_id: str,
        version: str,
        weights_path: str | None = None,
        device: str = "cpu",
        timeout_s: float = 60.0,
        score_threshold: float = 0.5,
        **_kwargs: Any,
    ) -> None:
        self.model_id = model_id
        self.version = version
        self.weights_path = weights_path
        self.device = device
        self.timeout_s = timeout_s
        self.score_threshold = score_threshold
        self._ready = False
        self._cached: CachedWeights | None = None
        self._module: Any = None
        self._label_names = list(_DEFAULT_LABELS)
        self._clinically_approved = False

    def load(self) -> None:
        require_torch()
        self._cached = load_torch_checkpoint(
            self.weights_path,
            model_id=self.model_id,
            version=self.version,
            device=self.device,
        )
        payload = self._cached.payload
        self._label_names = checkpoint_label_names(payload, _DEFAULT_LABELS)
        self._clinically_approved = bool(
            isinstance(payload, dict) and payload.get("clinically_approved") is True
        )
        module = TinyMRIClassifier(num_classes=len(self._label_names)).to(self.device).eval()
        state = None
        if isinstance(payload, dict):
            state = payload.get("state_dict") or payload.get("model")
        elif payload is not None:
            state = payload
        if state is None:
            raise ModelUnavailableError(
                f"MRI checkpoint for {self.model_id!r} has no state_dict."
            )
        try:
            module.load_state_dict(state)
        except Exception as exc:  # noqa: BLE001
            raise ModelUnavailableError(
                f"Incompatible MRI weights for {self.model_id!r}: {type(exc).__name__}."
            ) from exc
        self._module = module
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
            if arr.ndim != 3:
                raise InferenceFailedError(
                    f"MRI entrypoint expects DHW volume, got shape {arr.shape}."
                )
            if arr.shape[0] < 2:
                raise InferenceFailedError(
                    "MRI 3D entrypoint requires depth ≥ 2 slices."
                )
            # Reject accidental 2D XR tensors routed here (CHW with C=1,H,W looks 3D
            # but depth would be 1 for single-slice — already guarded). Also reject
            # layouts that are clearly CHW with channels-first tiny depth.
            if request.modality.upper() == "XR":
                raise InferenceFailedError(
                    "MRI entrypoint rejected XR modality input."
                )
            x = torch.from_numpy(arr).unsqueeze(0).unsqueeze(0).to(self.device)
            with torch.no_grad():
                logits = self._module.forward(x)
                probs = torch.sigmoid(logits).detach().cpu().numpy().reshape(-1)
            scores = [float(p) for p in probs.tolist()]
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
                    f"MRI inference timed out after {self.timeout_s}s."
                ) from exc
            raise InferenceFailedError(
                f"MRI inference failed: {type(exc).__name__}: {exc}"
            ) from exc

        if time.monotonic() - start > self.timeout_s:
            raise InferenceTimeoutError(
                f"MRI inference timed out after {self.timeout_s}s."
            )

        warnings = [
            "MRI Vision output is decision-support only; not clinically validated.",
            "No HU window applied (MRI intensity profile).",
            "Brain MR/CT localization (bbox/mask) is emitted only when the checkpoint "
            "includes a detection/segmentation head — never invented from classification alone.",
        ]
        if not self._clinically_approved:
            warnings.append("Checkpoint clinically_approved=false.")

        detection = None
        segmentation = None
        # Optional localization heads when checkpoint declares them (no silent fabrication).
        if isinstance(self._cached.payload, dict):
            raw_boxes = self._cached.payload.get("detection_boxes")
            if isinstance(raw_boxes, list) and raw_boxes:
                from app.schemas.model_outputs import BoundingBox2D, DetectionOutput

                boxes = []
                for b in raw_boxes:
                    if not isinstance(b, dict):
                        continue
                    boxes.append(
                        BoundingBox2D(
                            x_min=float(b["x_min"]),
                            y_min=float(b["y_min"]),
                            x_max=float(b["x_max"]),
                            y_max=float(b["y_max"]),
                            label=str(b.get("label") or "BRAIN_LESION_SUSPECTED"),
                            score=float(b["score"]) if b.get("score") is not None else None,
                            frame_index=int(b["frame_index"]) if b.get("frame_index") is not None else None,
                            sop_instance_uid=b.get("sop_instance_uid"),
                        )
                    )
                if boxes:
                    detection = DetectionOutput(
                        boxes=boxes,
                        coordinate_space=str(
                            self._cached.payload.get("detection_coordinate_space")
                            or "model_input"
                        ),
                    )
                    warnings.append(
                        "Detection boxes loaded from checkpoint metadata; "
                        "pending veterinary review before report inclusion."
                    )

        return ModelTaskOutputs(
            model_id=self.model_id,
            model_version=self.version,
            case_id=request.case_id,
            execution_status=ModelExecutionStatus.SUCCESS,
            source_kind=SourceKind.REAL,
            classification=classification,
            detection=detection,
            segmentation=segmentation,
            warnings=warnings,
            processing_metadata={
                "adapter": "mri_monai",
                "device": self.device,
                "weight_digest_sha256": self._cached.digest_sha256,
                "calibrated": "false",
                "clinically_validated": "false",
                "brain_priority": "true",
                "localization_emitted": "true" if detection or segmentation else "false",
                "raw_scores": ",".join(
                    f"{n}={s:.4f}" for n, s in zip(self._label_names, scores)
                ),
            },
        )


def build_entrypoint(
    *,
    model_id: str,
    version: str,
    weights_path: str | None = None,
    device: str = "cpu",
    timeout_s: float = 60.0,
    **kwargs: Any,
) -> MRIMonaiEntrypoint:
    return MRIMonaiEntrypoint(
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
    model_id: str = "vet-mri-brain-v1",
    version: str = "0.0.1-test",
    label_names: list[str] | None = None,
    seed: int = 0,
) -> str:
    torch = require_torch()
    labels = list(label_names or _DEFAULT_LABELS)
    torch.manual_seed(seed)
    module = TinyMRIClassifier(num_classes=len(labels))
    payload = {
        "model_id": model_id,
        "version": version,
        "architecture": "tiny_mri_classifier",
        "label_names": labels,
        "num_classes": len(labels),
        "clinically_approved": False,
        "state_dict": module.state_dict(),
    }
    torch.save(payload, path)
    return path
