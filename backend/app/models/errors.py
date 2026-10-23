"""Typed Vision adapter failures. Never trigger silent mock fallback."""

from __future__ import annotations

from app.models.interfaces import ImagingAdapterError


class ModelUnavailableError(ImagingAdapterError):
    """Adapter not configured, weights missing, or remote service unavailable."""


class IncompatibleInputError(ImagingAdapterError):
    """Case/model input cannot satisfy adapter preprocessing or schema requirements."""


class InferenceTimeoutError(ImagingAdapterError):
    """Inference exceeded configured timeout."""

    def __init__(self, message: str = "Vision inference timed out.") -> None:
        super().__init__(message)


class InferenceFailedError(ImagingAdapterError):
    """Entrypoint/runtime inference failure (non-timeout)."""
