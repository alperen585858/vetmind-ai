"""Authorized DICOM pixel decode. Default path never calls this without a contract."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np
from pydicom import dcmread
from pydicom.errors import InvalidDicomError

from app.imaging.contracts import PreprocessingContract
from app.imaging.interfaces import PrepValidationError
from app.imaging.pixel_ops import TRANSFORM_EXTRACT_PIXELS, apply_photometric, as_float_array


class AuthorizedDicomDecoder:
    """Decode instance pixels when contract allows extract_pixels.

    Does not perform authorization itself — callers (prep pipeline) must call
    ``assert_pixel_access_allowed`` first and pass a contract with requires_pixels.
    """

    def __init__(self, *, quarantine_root: Path | None = None) -> None:
        self._root = quarantine_root

    def decode_instance(
        self,
        *,
        quarantine_relative_path: str,
        contract: PreprocessingContract,
    ) -> dict:
        if not contract.requires_pixels:
            raise PrepValidationError("Contract does not require pixels; decode denied.")
        if TRANSFORM_EXTRACT_PIXELS not in contract.allowed_transforms:
            raise PrepValidationError(
                f"Transform {TRANSFORM_EXTRACT_PIXELS!r} not listed in contract "
                f"{contract.contract_id}."
            )
        if self._root is None:
            raise PrepValidationError("Quarantine root is not configured for decode.")
        path = (self._root / quarantine_relative_path).resolve()
        try:
            path.relative_to(self._root.resolve())
        except ValueError as exc:
            raise PrepValidationError("Quarantine path escapes store root.") from exc
        if not path.is_file():
            raise PrepValidationError("DICOM instance file not found in quarantine.")
        return self.decode_bytes(path.read_bytes(), contract=contract)

    def decode_bytes(self, data: bytes, *, contract: PreprocessingContract) -> dict:
        """Decode from bytes (tests / authorized callers). Same contract gates."""
        if not contract.requires_pixels:
            raise PrepValidationError("Contract does not require pixels; decode denied.")
        if TRANSFORM_EXTRACT_PIXELS not in contract.allowed_transforms:
            raise PrepValidationError(
                f"Transform {TRANSFORM_EXTRACT_PIXELS!r} not listed in contract."
            )
        try:
            ds = dcmread(BytesIO(data), force=True)
        except (InvalidDicomError, Exception) as exc:  # noqa: BLE001 — map to prep error
            raise PrepValidationError(f"DICOM decode failed: {type(exc).__name__}") from exc

        if not hasattr(ds, "PixelData") and not hasattr(ds, "FloatPixelData"):
            raise PrepValidationError("Instance has no PixelData.")

        try:
            raw = ds.pixel_array
        except Exception as exc:  # noqa: BLE001
            raise PrepValidationError(f"pixel_array unavailable: {type(exc).__name__}") from exc

        arr = as_float_array(np.asarray(raw))
        photometric = str(getattr(ds, "PhotometricInterpretation", "MONOCHROME2") or "MONOCHROME2")
        # Photometric invert is applied only when contract lists it; otherwise leave raw.
        from app.imaging.pixel_ops import TRANSFORM_MONOCHROME_INVERT

        if TRANSFORM_MONOCHROME_INVERT in contract.allowed_transforms:
            arr = apply_photometric(arr, photometric)

        ts = None
        if getattr(ds, "file_meta", None) is not None:
            ts = str(getattr(ds.file_meta, "TransferSyntaxUID", "") or "") or None
        if contract.allowed_transfer_syntaxes and ts:
            if ts not in contract.allowed_transfer_syntaxes:
                raise PrepValidationError(f"Unsupported transfer syntax {ts}.")

        return {
            "pixels": arr,
            "rows": int(getattr(ds, "Rows", arr.shape[-2] if arr.ndim >= 2 else 0) or 0),
            "columns": int(getattr(ds, "Columns", arr.shape[-1] if arr.ndim >= 1 else 0) or 0),
            "photometric_interpretation": photometric,
            "pixel_spacing": _spacing_str(ds),
            "slice_thickness": _optional_str(getattr(ds, "SliceThickness", None)),
            "image_orientation_patient": _multi_str(getattr(ds, "ImageOrientationPatient", None)),
            "image_position_patient": _multi_str(getattr(ds, "ImagePositionPatient", None)),
            "instance_number": _optional_int(getattr(ds, "InstanceNumber", None)),
            "sop_instance_uid": _optional_str(getattr(ds, "SOPInstanceUID", None)),
            "series_instance_uid": _optional_str(getattr(ds, "SeriesInstanceUID", None)),
            "transfer_syntax_uid": ts,
            "pixels_loaded": True,
            "note": "Decoded under PreprocessingContract. Not clinical validation.",
        }


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _optional_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _multi_str(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        return "\\".join(str(v) for v in value)
    return _optional_str(value)


def _spacing_str(ds: Any) -> str | None:
    spacing = getattr(ds, "PixelSpacing", None)
    if spacing is None:
        return None
    if isinstance(spacing, (list, tuple)) and len(spacing) >= 2:
        return f"{spacing[0]}\\{spacing[1]}"
    return _optional_str(spacing)
