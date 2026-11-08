"""DICOM identity scrub for quarantine writes (PHI minimization).

Removes / blanks common patient identity tags. Does not claim full DICOM
de-identification (Supplement 142). Protected deployments should require this.
"""

from __future__ import annotations

from io import BytesIO
from typing import Iterable

from pydicom import dcmread
from pydicom.errors import InvalidDicomError

# Tags commonly carrying direct identifiers — blank or remove.
_IDENTITY_ATTRS: tuple[str, ...] = (
    "PatientName",
    "PatientID",
    "PatientBirthDate",
    "PatientBirthTime",
    "PatientSex",
    "OtherPatientIDs",
    "OtherPatientNames",
    "PatientAddress",
    "PatientTelephoneNumbers",
    "IssuerOfPatientID",
    "EthnicGroup",
    "Occupation",
    "AdditionalPatientHistory",
    "PatientComments",
    "ReferringPhysicianName",
    "PerformingPhysicianName",
    "OperatorsName",
    "InstitutionName",
    "InstitutionAddress",
    "StationName",
)


def scrub_dicom_bytes(
    data: bytes,
    *,
    replacement_patient_id: str = "ANON",
    keep_uids: bool = True,
) -> bytes:
    """Return Part-10 DICOM bytes with identity attributes cleared.

    On non-DICOM or parse failure, returns the original bytes unchanged
    (caller may still reject via malware/validation).
    """
    if not data or len(data) < 132 or data[128:132] != b"DICM":
        return data
    try:
        ds = dcmread(BytesIO(data), force=True)
    except (InvalidDicomError, Exception):
        return data
    for name in _IDENTITY_ATTRS:
        if hasattr(ds, name):
            try:
                if name == "PatientID":
                    setattr(ds, name, replacement_patient_id)
                elif name == "PatientName":
                    setattr(ds, name, "ANONYMIZED")
                else:
                    delattr(ds, name)
            except Exception:
                try:
                    setattr(ds, name, "")
                except Exception:
                    pass
    if not keep_uids:
        # Optional hard remint — default keep study graph UIDs for merge integrity.
        pass
    buf = BytesIO()
    try:
        ds.save_as(buf, enforce_file_format=True)
    except Exception:
        return data
    return buf.getvalue()


def scrub_dicom_files(
    files: Iterable[tuple[str, bytes]],
    *,
    enabled: bool = True,
) -> list[tuple[str, bytes]]:
    if not enabled:
        return list(files)
    return [(name, scrub_dicom_bytes(data)) for name, data in files]
