"""Versioned imaging model input contract — what Vision AI / VLM adapters consume.

Models must not receive ad-hoc file dumps. They receive this structured package
built from confirmed DICOM metadata (+ optional frame descriptors). Pixel tensors
for real inference are referenced here; Phase mock adapters read the contract
without claiming clinical pixel diagnosis.
"""

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.enums import AnatomicalRegion, ClassificationConfidence, Modality, Species

IMAGING_MODEL_INPUT_VERSION = "1.0.0"


class PixelAuthorizationSummary(BaseModel):
    """Policy outcome only — never implies pixels were loaded or transmitted."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    authorized: bool = False
    reason_codes: list[str] = Field(default_factory=list)
    evaluated_model_ids: list[str] = Field(default_factory=list)
    note: str = (
        "Authorization decision only. Does not load, decode, or transmit pixel data. "
        "source_kind=real / authorized=true does not imply clinical validation."
    )


class ModelInputFrameRef(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    sop_instance_uid: str
    series_instance_uid: str
    instance_number: Optional[int] = None
    filename: Optional[str] = None
    rows: Optional[int] = None
    columns: Optional[int] = None
    has_pixel_data: bool = False
    pixel_tensor_ready: bool = False
    quarantine_relative_path: Optional[str] = None
    note: str = "Frame reference only. Real adapters may load pixels via quarantine/secure store."


class ModelInputSeriesRef(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    series_instance_uid: str
    modality: Optional[Modality] = None
    series_description: Optional[str] = None
    body_part_examined: Optional[str] = None
    frame_count: int = 0
    frames: list[ModelInputFrameRef] = Field(default_factory=list)


class ImagingModelInput(BaseModel):
    """Canonical AI-facing study package. Swappable adapters analyze this, not raw folders."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: str = IMAGING_MODEL_INPUT_VERSION
    case_id: str
    study_instance_uid: Optional[str] = None
    species: Species
    modality: Modality
    anatomical_region: AnatomicalRegion
    classification_confidence: Optional[ClassificationConfidence] = None
    clinical_history: Optional[str] = None
    series: list[ModelInputSeriesRef] = Field(default_factory=list)
    total_instances: int = 0
    metadata_only: bool = True
    pixel_analysis_authorized: bool = False
    pixel_authorization: PixelAuthorizationSummary = Field(
        default_factory=PixelAuthorizationSummary
    )
    quarantine_dir: Optional[str] = None
    quarantined_instance_count: int = 0
    prepared_for_models: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    note: str = (
        "Structured model input. Mock adapters do not diagnose from pixels. "
        "pixel_analysis_authorized reflects policy only; this package does not embed pixel tensors."
    )
