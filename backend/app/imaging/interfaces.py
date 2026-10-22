"""Protocols for future real imaging pipelines. Implementations must stay pluggable."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.imaging.contracts import PreprocessingContract, TransformProvenance
from app.schemas.case import CaseRecord
from app.schemas.model_input import ImagingModelInput


class PrepValidationError(ValueError):
    """Invalid prep input / unsupported transfer syntax / missing metadata."""


@runtime_checkable
class DicomDecoder(Protocol):
    """Decode DICOM instances. Must not run unless pixel authorization allows."""

    def decode_instance(
        self,
        *,
        quarantine_relative_path: str,
        contract: PreprocessingContract,
    ) -> dict:
        """Return opaque decode descriptor (never logs PHI). Raises PrepValidationError."""
        ...


@runtime_checkable
class VolumeAssembler(Protocol):
    """Assemble multi-slice / multi-series volumes per contract."""

    def assemble(
        self,
        *,
        case: CaseRecord,
        contract: PreprocessingContract,
        decoded: list[dict],
    ) -> dict:
        ...


@runtime_checkable
class ImagePreprocessor(Protocol):
    """Apply only contract-listed transforms."""

    def preprocess(
        self,
        *,
        volume: dict,
        contract: PreprocessingContract,
    ) -> tuple[dict, TransformProvenance]:
        ...


@runtime_checkable
class ModelInputPreparer(Protocol):
    """Build / refresh ImagingModelInput for adapters."""

    def prepare(
        self,
        *,
        case: CaseRecord,
        contract: PreprocessingContract | None = None,
    ) -> ImagingModelInput:
        ...

    def validate_input(self, model_input: ImagingModelInput, contract: PreprocessingContract) -> None:
        ...
