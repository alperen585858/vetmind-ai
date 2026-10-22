"""Parse DICOM file bytes into metadata structs. Pixel payloads are never decoded for diagnosis."""

from __future__ import annotations

from dataclasses import dataclass, field
from io import BytesIO
from typing import Any, Optional

from pydicom import dcmread
from pydicom.errors import InvalidDicomError

from app.schemas.enums import Modality


@dataclass
class ParsedInstance:
    filename: str
    study_instance_uid: Optional[str] = None
    series_instance_uid: Optional[str] = None
    sop_instance_uid: Optional[str] = None
    instance_number: Optional[int] = None
    modality_raw: Optional[str] = None
    modality: Optional[Modality] = None
    study_description: Optional[str] = None
    series_description: Optional[str] = None
    body_part_examined: Optional[str] = None
    accession_number: Optional[str] = None
    study_date: Optional[str] = None
    patient_id: Optional[str] = None
    patient_name: Optional[str] = None
    transfer_syntax_uid: Optional[str] = None
    series_number: Optional[int] = None
    has_pixel_data: bool = False
    malformed: bool = False
    error_message: Optional[str] = None
    extras: dict[str, Any] = field(default_factory=dict)


def map_modality(raw: Optional[str]) -> Optional[Modality]:
    if raw is None:
        return None
    value = str(raw).strip().upper()
    if value in {"MR", "MRI"}:
        return Modality.MR
    if value == "CT":
        return Modality.CT
    if value:
        return Modality.OTHER
    return None


def _tag_str(ds: Any, name: str) -> Optional[str]:
    value = getattr(ds, name, None)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _tag_int(ds: Any, name: str) -> Optional[int]:
    value = getattr(ds, name, None)
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _looks_like_dicom(data: bytes) -> bool:
    """DICOM Part 10 files have 'DICM' at offset 128."""
    return len(data) >= 132 and data[128:132] == b"DICM"


def parse_dicom_bytes(data: bytes, filename: str) -> ParsedInstance:
    """Read metadata. Never calls pixel_array / never interprets image content clinically."""
    if not data:
        return ParsedInstance(
            filename=filename,
            malformed=True,
            error_message="Empty file.",
        )
    if not _looks_like_dicom(data):
        return ParsedInstance(
            filename=filename,
            malformed=True,
            error_message="Not a Part 10 DICOM file (missing DICM preamble).",
        )

    try:
        # Read full dataset for small fixtures so PixelData tag presence is visible,
        # but never decode samples via pixel_array.
        ds = dcmread(BytesIO(data), force=False)
    except InvalidDicomError as exc:
        return ParsedInstance(
            filename=filename,
            malformed=True,
            error_message=f"Invalid DICOM: {exc}",
        )
    except Exception as exc:  # noqa: BLE001 — surface as malformed for ingest UX
        return ParsedInstance(
            filename=filename,
            malformed=True,
            error_message=f"Parse failure: {type(exc).__name__}: {exc}",
        )

    has_pixel = "PixelData" in ds or "FloatPixelData" in ds or "DoubleFloatPixelData" in ds
    modality_raw = _tag_str(ds, "Modality")
    transfer_syntax: Optional[str] = None
    meta = getattr(ds, "file_meta", None)
    if meta is not None:
        ts = getattr(meta, "TransferSyntaxUID", None)
        if ts:
            transfer_syntax = str(ts)

    return ParsedInstance(
        filename=filename,
        study_instance_uid=_tag_str(ds, "StudyInstanceUID"),
        series_instance_uid=_tag_str(ds, "SeriesInstanceUID"),
        sop_instance_uid=_tag_str(ds, "SOPInstanceUID"),
        instance_number=_tag_int(ds, "InstanceNumber"),
        modality_raw=modality_raw,
        modality=map_modality(modality_raw),
        study_description=_tag_str(ds, "StudyDescription"),
        series_description=_tag_str(ds, "SeriesDescription"),
        body_part_examined=_tag_str(ds, "BodyPartExamined"),
        accession_number=_tag_str(ds, "AccessionNumber"),
        study_date=_tag_str(ds, "StudyDate"),
        patient_id=_tag_str(ds, "PatientID"),
        patient_name=_tag_str(ds, "PatientName"),
        transfer_syntax_uid=transfer_syntax,
        series_number=_tag_int(ds, "SeriesNumber"),
        has_pixel_data=has_pixel,
    )
