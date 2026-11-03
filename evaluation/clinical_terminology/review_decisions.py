"""Review decision submissions that cannot grant clinical approval.

Review notes are restricted to controlled codes; patient identifiers, free-form
clinical claims and unverified synonyms must not enter machine-facing outputs.

An authorized expert must review a separate final catalog change via the
team's existing governance process. A decision here never updates TermCatalog.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from evaluation.clinical_terminology.corpus_candidates import CorpusReviewQueue

Action = Literal["propose_for_expert_review", "defer", "exclude"]
Reason = Literal[
    "needs_primary_source", "composite_or_qualified_label", "scope_uncertain",
    "possible_duplicate", "not_relevant", "review_requested",
]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)


class ReviewDecision(_Strict):
    candidate_id: str = Field(pattern=r"^SRC_[0-9a-f]{20}$")
    action: Action
    reason: Reason


class ReviewSubmission(_Strict):
    schema_version: Literal["1.0.0"] = "1.0.0"
    source_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    decisions: tuple[ReviewDecision, ...] = Field(max_length=500)

    @model_validator(mode="after")
    def unique_candidates(self) -> "ReviewSubmission":
        ids = [item.candidate_id for item in self.decisions]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate candidate decision")
        return self


@dataclass(frozen=True, slots=True)
class ReviewDecisionSummary:
    status: Literal["review_plan_recorded"]
    proposed_for_expert_review: int
    deferred: int
    excluded: int
    outstanding: int
    expert_approved: Literal[0] = 0
    active_catalog_modified: Literal[False] = False
    clinical_validation: Literal["not_evaluated"] = "not_evaluated"
    clinical_metrics: None = None


def validate_review_submission(queue: CorpusReviewQueue, submission: ReviewSubmission) -> ReviewDecisionSummary:
    """Reject stale, missing, or unknown candidate proposals without echoing text."""
    if not isinstance(queue, CorpusReviewQueue) or not isinstance(submission, ReviewSubmission):
        raise TypeError("validated queue and submission required")
    if queue.source_sha256 != submission.source_sha256:
        raise ValueError("stale_source_digest")
    valid = {candidate.candidate_id for candidate in queue.candidates}
    decisions = {item.candidate_id for item in submission.decisions}
    if not decisions.issubset(valid):
        raise ValueError("unknown_candidate_id")
    return ReviewDecisionSummary(
        status="review_plan_recorded",
        proposed_for_expert_review=sum(d.action == "propose_for_expert_review" for d in submission.decisions),
        deferred=sum(d.action == "defer" for d in submission.decisions),
        excluded=sum(d.action == "exclude" for d in submission.decisions),
        outstanding=len(valid - decisions),
    )
