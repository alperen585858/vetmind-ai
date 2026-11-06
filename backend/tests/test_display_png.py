"""Unit tests for shared DICOM → display PNG helper."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

import numpy as np
from pydicom.dataset import Dataset, FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

from app.imaging.display_png import (
    dicom_bytes_to_png,
    is_localizer_label,
    select_frame_indices,
    window_to_u8,
)


def _write_mono_dicom(path: Path, *, photo: str, pixels: np.ndarray) -> bytes:
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = generate_uid()
    meta.MediaStorageSOPInstanceUID = generate_uid()
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds = FileDataset(str(path), {}, file_meta=meta, preamble=b"\0" * 128)
    ds.SOPClassUID = meta.MediaStorageSOPClassUID
    ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    ds.StudyInstanceUID = generate_uid()
    ds.SeriesInstanceUID = generate_uid()
    ds.Modality = "MR"
    ds.Rows, ds.Columns = pixels.shape[-2], pixels.shape[-1]
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = photo
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 0
    if pixels.ndim == 3:
        ds.NumberOfFrames = pixels.shape[0]
        ds.PixelData = pixels.astype(np.uint16).tobytes()
    else:
        ds.PixelData = pixels.astype(np.uint16).tobytes()
    buf = BytesIO()
    ds.save_as(buf, write_like_original=False)
    return buf.getvalue()


def test_monochrome1_is_inverted_relative_to_monochrome2(tmp_path: Path) -> None:
    # Bright corner should invert under MONOCHROME1.
    pixels = np.zeros((8, 8), dtype=np.uint16)
    pixels[0, 0] = 1000
    m2 = _write_mono_dicom(tmp_path / "m2.dcm", photo="MONOCHROME2", pixels=pixels)
    m1 = _write_mono_dicom(tmp_path / "m1.dcm", photo="MONOCHROME1", pixels=pixels)
    r2 = dicom_bytes_to_png(m2, as_rgb=False)
    r1 = dicom_bytes_to_png(m1, as_rgb=False)
    assert r2 is not None and r1 is not None
    assert r2.png_bytes != r1.png_bytes
    assert r1.photometric.upper() == "MONOCHROME1"


def test_percentile_window_handles_outliers() -> None:
    arr = np.ones((32, 32), dtype=np.float64) * 100.0
    arr[0, 0] = 10_000.0
    u8 = window_to_u8(arr)
    # Rare spike must not force bulk pixels to black via min–max expansion.
    assert int(u8[16, 16]) >= 128
    assert int(u8[0, 0]) >= 128


def test_select_frame_indices_mid_and_quartiles() -> None:
    assert select_frame_indices(1) == [0]
    assert select_frame_indices(8, max_frames=3) == [2, 4, 5]
    idxs = select_frame_indices(100, max_frames=3)
    assert idxs == [25, 50, 74]


def test_is_localizer_label() -> None:
    assert is_localizer_label("Localizer")
    assert is_localizer_label("Scout T1")
    assert is_localizer_label("Survey", "slice.dcm")
    assert not is_localizer_label("T2 FLAIR axial")
