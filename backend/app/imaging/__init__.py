"""Secure DICOM → model preparation layer (Phase 3 readiness).

Default path is metadata-only. Pixel decode requires explicit authorization
and a model preprocessing contract. No medically significant transforms are
applied without a declared contract.
"""

from app.imaging.contracts import PreprocessingContract, TransformProvenance
from app.imaging.interfaces import (
    DicomDecoder,
    ImagePreprocessor,
    ModelInputPreparer,
    PrepValidationError,
    VolumeAssembler,
)
from app.imaging.metadata_prep import MetadataOnlyPreparationPipeline

__all__ = [
    "DicomDecoder",
    "ImagePreprocessor",
    "ModelInputPreparer",
    "MetadataOnlyPreparationPipeline",
    "PrepValidationError",
    "PreprocessingContract",
    "TransformProvenance",
    "VolumeAssembler",
]
