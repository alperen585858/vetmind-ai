from enum import Enum


class Species(str, Enum):
    CANINE = "canine"
    FELINE = "feline"
    OTHER = "other"


class Modality(str, Enum):
    MR = "MR"
    CT = "CT"
    OTHER = "OTHER"


class AnatomicalRegion(str, Enum):
    BRAIN = "BRAIN"
    CERVICAL = "CERVICAL"
    OTHER = "OTHER"
    UNKNOWN = "UNKNOWN"


class FindingStatus(str, Enum):
    """Finding-level status. Absence of disease is never inferred from missing items."""

    SUSPECTED = "suspected"
    POSSIBLE = "possible"
    UNCERTAIN = "uncertain"
    NOT_ASSESSED = "not_assessed"


class ModelExecutionStatus(str, Enum):
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILED = "failed"
    UNSUPPORTED = "unsupported"


class SourceKind(str, Enum):
    """Imaging/report provenance. MIXED means adapters disagreed on mock vs real."""

    MOCK = "mock"
    REAL = "real"
    MIXED = "mixed"


class ReportStatus(str, Enum):
    DRAFT = "draft"
    VALIDATION_FAILED = "validation_failed"
    AWAITING_REVIEW = "awaiting_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    REVISION_REQUESTED = "revision_requested"


class ExpertReviewStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    REVISION_REQUESTED = "revision_requested"


class ReviewAction(str, Enum):
    APPROVE = "approve"
    REJECT = "reject"
    REQUEST_REVISION = "request_revision"


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class PipelineOutcome(str, Enum):
    SUCCESS = "success"
    PARTIAL = "partial"
    UNSUPPORTED = "unsupported"
    FAILED = "failed"


class MockScenario(str, Enum):
    """Deterministic mock fixtures. Not clinical interpretations."""

    BRAIN_MRI_SUSPECTED = "brain_mri_suspected"
    CERVICAL_MRI_SUSPECTED = "cervical_mri_suspected"
    NO_FINDINGS = "no_findings"
    UNSUPPORTED = "unsupported"
    MODEL_FAILURE = "model_failure"
    CONFLICTING = "conflicting"


class CaseLifecycleStatus(str, Enum):
    CREATED = "created"
    AWAITING_CLASSIFICATION_CONFIRMATION = "awaiting_classification_confirmation"
    ANALYZING = "analyzing"
    AWAITING_REVIEW = "awaiting_review"
    MANUAL_REVIEW = "manual_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    REVISION_REQUESTED = "revision_requested"
    FAILED = "failed"


class DicomValidationSeverity(str, Enum):
    ERROR = "error"
    WARNING = "warning"


class DicomValidationCode(str, Enum):
    MALFORMED = "malformed"
    MISSING_STUDY_UID = "missing_study_uid"
    MISSING_SERIES_UID = "missing_series_uid"
    MISSING_SOP_UID = "missing_sop_uid"
    DUPLICATE_SOP = "duplicate_sop"
    INCONSISTENT_STUDY = "inconsistent_study"
    UNSUPPORTED_MODALITY = "unsupported_modality"
    MIXED_MODALITY = "mixed_modality"
    EMPTY_UPLOAD = "empty_upload"
    PIXEL_DATA_PRESENT_IGNORED = "pixel_data_present_ignored"


class ClassificationConfidence(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    UNKNOWN = "unknown"
