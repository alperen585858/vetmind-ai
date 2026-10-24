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

# Codes that alone make an upload non-confirmable when they dominate the result.
# Confirm gating still uses ValidationResult.blocked as the authoritative flag.
_HARD_BLOCK_CODES = frozenset(
    {
        DicomValidationCode.EMPTY_UPLOAD,
        DicomValidationCode.INCONSISTENT_STUDY,
        DicomValidationCode.UNSUPPORTED_MODALITY,
    }
)


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

    @property
    def confirmable(self) -> bool:
        """True when a case may be created after explicit classification confirmation."""
        return not self.blocked and self.study is not None and self.classification is not None


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


def has_blocking_errors(
    issues: list[DicomValidationIssue],
    *,
    blocked: bool | None = None,
) -> bool:
    """Whether ingest must not create a case.

    Prefer passing ``blocked=ValidationResult.blocked``. When omitted, falls back to
    hard-block ERROR codes (empty / inconsistent study / unsupported modality).
    Soft exclusions (duplicate SOP, incomplete UIDs, mixed modality) are advisory.
    """
    if blocked is not None:
        return blocked
    return any(
        i.severity == DicomValidationSeverity.ERROR and i.code in _HARD_BLOCK_CODES
        for i in issues
    )


def issue_codes(issues: list[DicomValidationIssue]) -> set[DicomValidationCode]:
    return {i.code for i in issues}
