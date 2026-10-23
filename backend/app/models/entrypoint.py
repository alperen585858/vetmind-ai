"""Configurable load + inference entrypoint contracts (local torch / remote HTTP).

No weights are loaded at import time. Entrypoints are resolved from
``module:attr`` strings only when an adapter is configured.
"""

from __future__ import annotations

import importlib
import time
from dataclasses import dataclass, field
from typing import Any, Optional, Protocol, Union, runtime_checkable

from app.imaging.contracts import TransformProvenance
from app.models.bridge_resources import ResourceLimits
from app.models.errors import (
    InferenceFailedError,
    InferenceTimeoutError,
    ModelUnavailableError,
)
from app.schemas.case import CaseRecord
from app.schemas.findings import StructuredFindings
from app.schemas.model_input import ImagingModelInput
from app.schemas.model_outputs import ModelTaskOutputs

InferenceResult = Union[ModelTaskOutputs, StructuredFindings]


@dataclass(frozen=True)
class PreparedTensorBundle:
    """Authorized prep result. Tensor may be in-memory (tests) or artifact-backed."""

    layout: str
    tensor_shape: tuple[int, ...]
    provenance: TransformProvenance
    artifact_path: Optional[str] = None
    # In-process array for synthetic/local probes only — never HTTP-serialized by default.
    tensor: Any = None
    pixel_spacing_mm: Optional[tuple[float, float]] = None
    note: str = "Prepared under PreprocessingContract + pixel authorization."


@dataclass(frozen=True)
class InferenceRequest:
    """Canonical request passed to Vision entrypoints."""

    case_id: str
    model_id: str
    model_version: str
    model_input: ImagingModelInput
    prepared: Optional[PreparedTensorBundle] = None
    species: str = ""
    modality: str = ""
    anatomical_region: str = ""
    clinical_history: Optional[str] = None
    transmit_pixels: bool = False
    metadata: dict[str, str] = field(default_factory=dict)


@runtime_checkable
class VisionEntrypoint(Protocol):
    """Plug-in contract for load + infer. Implementations must not invent findings."""

    def load(self) -> None:
        """Load weights / open remote session. Raise ModelUnavailableError on failure."""
        ...

    def is_ready(self) -> bool:
        ...

    def infer(self, request: InferenceRequest) -> InferenceResult:
        """Run inference. Raise typed ImagingAdapterError subclasses on failure."""
        ...


def resolve_entrypoint(spec: str) -> Any:
    """Resolve ``package.module:attribute`` without importing torch globally."""
    if not spec or ":" not in spec:
        raise ModelUnavailableError(
            f"Invalid entrypoint spec {spec!r}; expected 'module.path:callable_or_factory'."
        )
    module_name, attr = spec.split(":", 1)
    module_name = module_name.strip()
    attr = attr.strip()
    if not module_name or not attr:
        raise ModelUnavailableError(f"Invalid entrypoint spec {spec!r}.")
    try:
        mod = importlib.import_module(module_name)
    except Exception as exc:  # noqa: BLE001
        raise ModelUnavailableError(
            f"Entrypoint module {module_name!r} could not be imported: {type(exc).__name__}."
        ) from exc
    try:
        obj = getattr(mod, attr)
    except AttributeError as exc:
        raise ModelUnavailableError(
            f"Entrypoint attribute {attr!r} missing on {module_name!r}."
        ) from exc
    return obj


def build_entrypoint_from_spec(
    spec: str,
    *,
    weights_path: str | None = None,
    device: str = "cpu",
    model_id: str,
    version: str,
    timeout_s: float = 30.0,
    **kwargs: Any,
) -> VisionEntrypoint:
    """Instantiate a VisionEntrypoint from a factory or class."""
    obj = resolve_entrypoint(spec)
    if callable(obj):
        try:
            instance = obj(
                model_id=model_id,
                version=version,
                weights_path=weights_path,
                device=device,
                timeout_s=timeout_s,
                **kwargs,
            )
        except TypeError:
            try:
                instance = obj(
                    model_id=model_id,
                    version=version,
                    weights_path=weights_path,
                    device=device,
                    timeout_s=timeout_s,
                )
            except TypeError:
                instance = obj()
    else:
        instance = obj
    if not all(hasattr(instance, n) for n in ("load", "is_ready", "infer")):
        raise ModelUnavailableError(
            f"Entrypoint {spec!r} does not implement VisionEntrypoint (load/is_ready/infer)."
        )
    return instance  # type: ignore[return-value]


class LocalTorchEntrypoint:
    """Configurable local entrypoint shell — loads only when ``load()`` is called."""

    def __init__(
        self,
        *,
        model_id: str,
        version: str,
        weights_path: str | None = None,
        device: str = "cpu",
        timeout_s: float = 30.0,
        infer_fn: Any = None,
    ) -> None:
        self.model_id = model_id
        self.version = version
        self.weights_path = weights_path
        self.device = device
        self.timeout_s = timeout_s
        self._infer_fn = infer_fn
        self._ready = False

    def load(self) -> None:
        from pathlib import Path

        if not self.weights_path or not Path(self.weights_path).is_file():
            raise ModelUnavailableError(
                f"Local torch weights missing for {self.model_id!r}."
            )
        # Weights on disk mark the slot configured. Torch is imported only by a
        # custom infer_fn / factory — never here by default.
        if self._infer_fn is None:
            self._ready = True
            return
        try:
            import torch  # type: ignore[import-not-found]  # noqa: F401
        except Exception as exc:  # noqa: BLE001
            raise ModelUnavailableError(
                f"PyTorch unavailable for {self.model_id!r}: {type(exc).__name__}."
            ) from exc
        self._ready = True

    def is_ready(self) -> bool:
        return self._ready

    def infer(self, request: InferenceRequest) -> InferenceResult:
        if not self._ready:
            raise ModelUnavailableError(f"Entrypoint {self.model_id!r} not loaded.")
        start = time.monotonic()
        if self._infer_fn is not None:
            try:
                result = self._infer_fn(request)
            except Exception as exc:  # noqa: BLE001
                if time.monotonic() - start > self.timeout_s:
                    raise InferenceTimeoutError(
                        f"Local inference timed out after {self.timeout_s}s."
                    ) from exc
                raise InferenceFailedError(
                    f"Local inference failed: {type(exc).__name__}: {exc}"
                ) from exc
            if time.monotonic() - start > self.timeout_s:
                raise InferenceTimeoutError(
                    f"Local inference timed out after {self.timeout_s}s."
                )
            if isinstance(result, (ModelTaskOutputs, StructuredFindings)):
                return result
            raise InferenceFailedError(
                "infer_fn must return ModelTaskOutputs or StructuredFindings."
            )
        raise InferenceFailedError(
            f"LocalTorchEntrypoint {self.model_id!r} has no infer_fn. "
            "Provide a factory that supplies infer_fn — no silent mock fallback."
        )


class HttpVisionEntrypoint:
    """Remote HTTP inference entrypoint. Never transmits pixel tensors by default."""

    def __init__(
        self,
        *,
        model_id: str,
        version: str,
        endpoint: str,
        api_key: str | None = None,
        timeout_s: float = 30.0,
        limits: ResourceLimits | None = None,
        weights_path: str | None = None,
        device: str = "cpu",
    ) -> None:
        self.model_id = model_id
        self.version = version
        self.endpoint = endpoint.rstrip("/")
        self.api_key = api_key
        self.timeout_s = timeout_s
        self.limits = limits or ResourceLimits(inference_timeout_s=timeout_s)
        self._ready = False
        _ = (weights_path, device)

    def load(self) -> None:
        if not self.endpoint:
            raise ModelUnavailableError("HTTP Vision endpoint is empty.")
        self._ready = True

    def is_ready(self) -> bool:
        return self._ready

    def infer(self, request: InferenceRequest) -> InferenceResult:
        if not self._ready:
            raise ModelUnavailableError(f"HTTP entrypoint {self.model_id!r} not loaded.")
        from app.models.http_vision import HttpRemoteVisionModel
        from app.models.interfaces import ImagingAdapterError
        from app.schemas.enums import AnatomicalRegion, Modality, Species
        from app.schemas.findings import StudyInfo

        transmit = bool(request.transmit_pixels and self.limits.transmit_pixels_over_http)
        if transmit:
            raise InferenceFailedError(
                "HTTP pixel transmission is not enabled in this build "
                "(transmit_pixels_over_http=False by default)."
            )

        adapter = HttpRemoteVisionModel(
            model_id=self.model_id,
            endpoint=self.endpoint,
            version=self.version,
            timeout_s=self.timeout_s,
            api_key=self.api_key,
        )
        case = CaseRecord(
            case_id=request.case_id,
            patient_name="",
            species=Species(request.species or "other"),
            modality=Modality(request.modality or "OTHER"),
            anatomical_region=AnatomicalRegion(request.anatomical_region or "UNKNOWN"),
            clinical_history=request.clinical_history,
            study=StudyInfo(),
            model_input=request.model_input,
        )
        try:
            findings = adapter.analyze(case)
        except ImagingAdapterError as exc:
            msg = str(exc)
            if "timed out" in msg.lower():
                raise InferenceTimeoutError(msg) from exc
            raise InferenceFailedError(msg) from exc
        except Exception as exc:  # noqa: BLE001
            raise InferenceFailedError(f"HTTP vision error: {type(exc).__name__}") from exc

        findings.processing_metadata = {
            **findings.processing_metadata,
            "entrypoint": "http_vision",
            "pixels_transmitted": "false",
        }
        return findings


def inference_request_from_case(
    case: CaseRecord,
    *,
    model_id: str,
    model_version: str,
    prepared: PreparedTensorBundle | None = None,
    transmit_pixels: bool = False,
) -> InferenceRequest:
    from app.models.model_input_builder import require_model_input

    mi = require_model_input(case)
    return InferenceRequest(
        case_id=case.case_id,
        model_id=model_id,
        model_version=model_version,
        model_input=mi,
        prepared=prepared,
        species=case.species.value,
        modality=case.modality.value,
        anatomical_region=case.anatomical_region.value,
        clinical_history=case.clinical_history,
        transmit_pixels=transmit_pixels,
    )
