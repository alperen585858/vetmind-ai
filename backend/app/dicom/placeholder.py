"""Legacy stub. Prefer app.dicom.ingest.ingest_dicom_files."""

from app.dicom.ingest import ingest_dicom_files


class DicomIngestNotImplemented(NotImplementedError):
    """Kept for import compatibility; metadata ingest lives in app.dicom.ingest."""


def ingest_study(_path: str) -> None:
    raise DicomIngestNotImplemented(
        "Path-based ingest is not used. Upload DICOM bytes via POST /api/v1/dicom/upload "
        "or call ingest_dicom_files([...])."
    )


__all__ = ["DicomIngestNotImplemented", "ingest_study", "ingest_dicom_files"]
