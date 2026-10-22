"""DICOM metadata ingest.

Parses and validates Study → Series → Instance hierarchy from DICOM tags.
Does **not** perform pixel-based diagnosis. Real Vision AI adapters remain mock.
"""

from app.dicom.classifier import classify_study
from app.dicom.ingest import ingest_dicom_files
from app.dicom.parser import parse_dicom_bytes
from app.dicom.validator import validate_parsed_instances

__all__ = [
    "classify_study",
    "ingest_dicom_files",
    "parse_dicom_bytes",
    "validate_parsed_instances",
]
