"""Multi-file DICOM ingest orchestration (metadata only)."""

from __future__ import annotations

from app.dicom.classifier import classify_study
from app.dicom.parser import parse_dicom_bytes
from app.dicom.validator import validate_parsed_instances
from app.schemas.dicom import (
    ClassificationSuggestion,
    DicomStudyMeta,
    DicomValidationIssue,
)
from app.schemas.enums import DicomValidationCode, DicomValidationSeverity


class DicomIngestResult:
    def __init__(
        self,
        *,
        study: DicomStudyMeta | None,
        issues: list[DicomValidationIssue],
        classification: ClassificationSuggestion | None,
        blocked: bool,
        block_reason: str | None,
    ) -> None:
        self.study = study
        self.issues = issues
        self.classification = classification
        self.blocked = blocked
        self.block_reason = block_reason


def ingest_dicom_files(files: list[tuple[str, bytes]]) -> DicomIngestResult:
    """Parse, validate, and classify uploaded DICOM files. Does not create a Case."""
    if not files:
        empty = validate_parsed_instances([])
        return DicomIngestResult(
            study=None,
            issues=empty.issues,
            classification=None,
            blocked=True,
            block_reason=empty.block_reason,
        )

    parsed = [parse_dicom_bytes(data, filename) for filename, data in files]
    validation = validate_parsed_instances(parsed)

    classification: ClassificationSuggestion | None = None
    if validation.study is not None and not validation.blocked:
        classification = classify_study(validation.study)
    elif validation.study is not None:
        # Still attach a classification hint for blocked unsupported studies when useful.
        classification = classify_study(validation.study)

    return DicomIngestResult(
        study=validation.study,
        issues=validation.issues,
        classification=classification,
        blocked=validation.blocked,
        block_reason=validation.block_reason,
    )


def has_blocking_errors(issues: list[DicomValidationIssue]) -> bool:
    return any(i.severity == DicomValidationSeverity.ERROR for i in issues)


def issue_codes(issues: list[DicomValidationIssue]) -> set[DicomValidationCode]:
    return {i.code for i in issues}
