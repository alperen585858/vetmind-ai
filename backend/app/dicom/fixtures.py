"""Synthetic DICOM fixtures for tests. No real patient data."""

from __future__ import annotations

from io import BytesIO

from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import (
    ExplicitVRLittleEndian,
    MRImageStorage,
    SecondaryCaptureImageStorage,
    generate_uid,
)


def _base_file_meta(sop_class_uid: str) -> FileMetaDataset:
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = sop_class_uid
    meta.MediaStorageSOPInstanceUID = generate_uid()
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    meta.ImplementationClassUID = generate_uid()
    return meta


def build_synthetic_instance(
    *,
    study_uid: str | None = None,
    series_uid: str | None = None,
    sop_uid: str | None = None,
    modality: str = "MR",
    study_description: str = "SYNTHETIC BRAIN MRI",
    series_description: str = "SYNTHETIC T2 BRAIN",
    body_part: str = "BRAIN",
    patient_name: str = "SYNTHETIC^DEMO",
    patient_id: str = "SYN-0001",
    instance_number: int = 1,
    series_number: int = 1,
    include_pixels: bool = True,
    sop_class_uid: str = MRImageStorage,
) -> bytes:
    """Return DICOM file bytes with synthetic UIDs and labels."""
    study_uid = study_uid or generate_uid()
    series_uid = series_uid or generate_uid()
    sop_uid = sop_uid or generate_uid()

    meta = _base_file_meta(sop_class_uid)
    meta.MediaStorageSOPInstanceUID = sop_uid

    ds = FileDataset(
        "synthetic.dcm",
        {},
        file_meta=meta,
        preamble=b"\0" * 128,
    )

    ds.SOPClassUID = sop_class_uid
    ds.SOPInstanceUID = sop_uid
    ds.StudyInstanceUID = study_uid
    ds.SeriesInstanceUID = series_uid
    ds.Modality = modality
    ds.StudyDescription = study_description
    ds.SeriesDescription = series_description
    ds.BodyPartExamined = body_part
    ds.PatientName = patient_name
    ds.PatientID = patient_id
    ds.StudyDate = "20200101"
    ds.AccessionNumber = "SYN-ACC-001"
    ds.InstanceNumber = instance_number
    ds.SeriesNumber = series_number
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    # Large enough to see in the browser viewer; still synthetic (not clinical).
    rows, cols = 128, 128
    ds.Rows = rows
    ds.Columns = cols
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 0

    if include_pixels:
        # Synthetic gradient raster — not clinical imagery.
        buf = bytearray(rows * cols * 2)
        for y in range(rows):
            for x in range(cols):
                # Soft radial + stripe pattern so windowing is visible.
                cx, cy = cols / 2, rows / 2
                dist = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
                val = int(max(0, min(4000, 3500 - dist * 18 + (x % 16) * 20)))
                i = (y * cols + x) * 2
                buf[i] = val & 0xFF
                buf[i + 1] = (val >> 8) & 0xFF
        ds.PixelData = bytes(buf)

    buffer = BytesIO()
    ds.save_as(buffer, enforce_file_format=True)
    return buffer.getvalue()

def brain_mri_study_files(instance_count: int = 2) -> list[tuple[str, bytes]]:
    study_uid = generate_uid()
    series_uid = generate_uid()
    files: list[tuple[str, bytes]] = []
    for i in range(1, instance_count + 1):
        data = build_synthetic_instance(
            study_uid=study_uid,
            series_uid=series_uid,
            modality="MR",
            study_description="SYNTHETIC CANINE BRAIN MRI",
            series_description="SYNTHETIC AXIAL T2 BRAIN",
            body_part="BRAIN",
            instance_number=i,
        )
        files.append((f"brain_mr_{i}.dcm", data))
    return files


def cervical_mri_study_files(instance_count: int = 2) -> list[tuple[str, bytes]]:
    study_uid = generate_uid()
    series_uid = generate_uid()
    files: list[tuple[str, bytes]] = []
    for i in range(1, instance_count + 1):
        data = build_synthetic_instance(
            study_uid=study_uid,
            series_uid=series_uid,
            modality="MR",
            study_description="SYNTHETIC CERVICAL SPINE MRI",
            series_description="SYNTHETIC SAGITTAL T2 C-SPINE",
            body_part="CSPINE",
            instance_number=i,
        )
        files.append((f"cervical_mr_{i}.dcm", data))
    return files


def unsupported_modality_file() -> tuple[str, bytes]:
    data = build_synthetic_instance(
        modality="US",
        study_description="SYNTHETIC ULTRASOUND",
        series_description="SYNTHETIC US",
        body_part="ABDOMEN",
        sop_class_uid=SecondaryCaptureImageStorage,
    )
    return ("unsupported_us.dcm", data)


def inconsistent_study_files() -> list[tuple[str, bytes]]:
    a = build_synthetic_instance(study_description="SYNTHETIC BRAIN MRI A", body_part="BRAIN")
    b = build_synthetic_instance(study_description="SYNTHETIC BRAIN MRI B", body_part="BRAIN")
    return [("study_a.dcm", a), ("study_b.dcm", b)]
