"""Secure DICOM → model preparation layer (Phase 3/8 readiness).

Default path is metadata-only. Pixel decode requires explicit authorization
and a model preprocessing contract. No medically significant transforms are
applied without a declared contract.

Heavy pixel modules (decoder/numpy) are imported lazily from submodules so
metadata-only startup does not pull them in via ``app.imaging``.
"""

from app.imaging.contracts import (
    PreprocessingContract,
    TransformProvenance,
    metadata_only_contract,
    pixel_2d_contract,
    pixel_3d_contract,
)
from app.imaging.interfaces import (
    DicomDecoder,
    ImagePreprocessor,
    ModelInputPreparer,
    PrepValidationError,
    VolumeAssembler,
)
from app.imaging.metadata_prep import MetadataOnlyPreparationPipeline

__all__ = [
    "AuthorizedDicomDecoder",
    "ContractImagePreprocessor",
    "DicomDecoder",
    "ImagePreprocessor",
    "MetadataOnlyPreparationPipeline",
    "ModelInputPreparer",
    "PrepValidationError",
    "PreprocessingContract",
    "SliceOrderedVolumeAssembler",
    "TransformProvenance",
    "VolumeAssembler",
    "metadata_only_contract",
    "pixel_2d_contract",
    "pixel_3d_contract",
]


def __getattr__(name: str):
    if name == "AuthorizedDicomDecoder":
        from app.imaging.decoder import AuthorizedDicomDecoder

        return AuthorizedDicomDecoder
    if name == "ContractImagePreprocessor":
        from app.imaging.preprocessor import ContractImagePreprocessor

        return ContractImagePreprocessor
    if name == "SliceOrderedVolumeAssembler":
        from app.imaging.volume import SliceOrderedVolumeAssembler

        return SliceOrderedVolumeAssembler
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
