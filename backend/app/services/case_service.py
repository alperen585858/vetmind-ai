from __future__ import annotations

import threading
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException, status

from app.models.model_input_builder import build_imaging_model_input
from app.orchestration.orchestrator import AIOrchestrator
from app.schemas.case import CaseCreate, CaseRecord, CaseSummary, ReviewFeedback
from app.schemas.enums import CaseLifecycleStatus, ExpertReviewStatus, JobStatus, ReportStatus, ReviewAction
from app.schemas.findings import StructuredFindings
from app.schemas.jobs import AnalysisJob, PipelineResult
from app.schemas.model_input import ImagingModelInput
from app.schemas.report import DraftReport
from app.services.repository import CaseRepository
from app.validation.report_validator import ReportValidator
from app.workers.job_backend import JobBackend, ThreadJobBackend


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CaseService:
    def __init__(
        self,
        repo: CaseRepository,
        orchestrator: AIOrchestrator,
        validator: ReportValidator | None = None,
        *,
        async_delay_ms: int = 0,
        job_backend: JobBackend | None = None,
    ) -> None:
        self._repo = repo
        self._orchestrator = orchestrator
        self._validator = validator or orchestrator.validator
        self._async_delay_ms = max(0, async_delay_ms)
        self._lock = threading.Lock()
        self._jobs = job_backend or ThreadJobBackend(delay_ms=self._async_delay_ms)

    def create_case(self, payload: CaseCreate) -> CaseRecord:
        case = CaseRecord(
            case_id=f"case-{uuid4().hex[:12]}",
            patient_name=payload.patient_name.strip(),
            species=payload.species,
            breed=payload.breed,
            modality=payload.modality,
            anatomical_region=payload.anatomical_region,
            clinical_history=payload.clinical_history,
            scenario=payload.scenario,
            study=payload.study,
            referring_clinic=payload.referring_clinic,
            status=CaseLifecycleStatus.CREATED,
        )
        case.model_input = build_imaging_model_input(case)
        return self._repo.save_case(case)

    def prepare_model_input(self, case_id: str) -> ImagingModelInput:
        """Build/refresh the AI-facing ImagingModelInput package for a case."""
        case = self.get_case(case_id)
        case.model_input = build_imaging_model_input(case)
        case.updated_at = _now()
        self._repo.save_case(case)
        return case.model_input

    def list_cases(self) -> list[CaseSummary]:
        return [
            CaseSummary(
                case_id=c.case_id,
                patient_name=c.patient_name,
                species=c.species,
                modality=c.modality,
                anatomical_region=c.anatomical_region,
                status=c.status,
                scenario=c.scenario,
                created_at=c.created_at,
                latest_job_id=c.latest_job_id,
            )
            for c in self._repo.list_cases()
        ]

    def get_case(self, case_id: str) -> CaseRecord:
        case = self._repo.get_case(case_id)
        if case is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found.")
        return case

    def _assert_analyzable(self, case: CaseRecord) -> None:
        if case.status == CaseLifecycleStatus.AWAITING_CLASSIFICATION_CONFIRMATION:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot analyze until DICOM metadata classification is confirmed.",
            )
        if not case.classification_confirmed:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot analyze: classification_confirmed is false.",
            )
        if case.status == CaseLifecycleStatus.ANALYZING:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Analysis already in progress for this case.",
            )

    def analyze(self, case_id: str) -> PipelineResult:
        """Run the mock pipeline synchronously and return the completed job result."""
        case = self.get_case(case_id)
        self._assert_analyzable(case)
        job = AIOrchestrator.new_job(case.case_id)
        case.latest_job_id = job.job_id
        case.status = CaseLifecycleStatus.ANALYZING
        case.updated_at = _now()
        self._repo.save_case(case)
        self._repo.save_job(job)
        result = self._orchestrator.run(case, job)
        self._repo.save_job(result.job)
        self._repo.save_case(case)
        return result

    def enqueue_analyze(self, case_id: str) -> AnalysisJob:
        """Queue analysis via job backend (thread default, optional RQ).

        Poll GET /jobs/{job_id}. RQ requires durable storage (sqlite/postgres), not memory.
        """
        case = self.get_case(case_id)
        self._assert_analyzable(case)
        if getattr(self._jobs, "name", "") == "rq":
            from app.services.repository import InMemoryCaseRepository

            if isinstance(self._repo, InMemoryCaseRepository):
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="RQ job backend requires durable storage (sqlite/postgres), not memory.",
                )
        job = AIOrchestrator.new_job(case.case_id)
        job.status = JobStatus.QUEUED
        case.latest_job_id = job.job_id
        case.status = CaseLifecycleStatus.ANALYZING
        case.updated_at = _now()
        self._repo.save_case(case)
        self._repo.save_job(job)

        def _worker() -> None:
            with self._lock:
                current = self._repo.get_case(case_id)
                queued = self._repo.get_job(job.job_id)
                if current is None or queued is None:
                    return
                result = self._orchestrator.run(current, queued)
                self._repo.save_job(result.job)
                self._repo.save_case(current)

        self._jobs.enqueue_analyze(case_id, job.job_id, _worker)
        return job

    def get_job(self, job_id: str) -> AnalysisJob:
        job = self._repo.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
        return job

    def get_findings(self, case_id: str) -> StructuredFindings:
        case = self.get_case(case_id)
        if case.structured_findings is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Structured findings are not available yet.")
        return case.structured_findings

    def get_report(self, case_id: str) -> DraftReport:
        case = self.get_case(case_id)
        if case.draft_report is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Draft report is not available (failed/unsupported cases do not produce an AI draft).",
            )
        return case.draft_report

    def submit_review(self, case_id: str, feedback: ReviewFeedback) -> CaseRecord:
        """Apply expert review. AI draft approval is distinct from unsupported manual review."""
        case = self.get_case(case_id)

        if feedback.action == ReviewAction.APPROVE:
            return self._approve_ai_draft(case, feedback)

        # Reject / revision require an existing AI draft (not unsupported/failed without draft).
        if case.draft_report is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Cannot reject/revise without an AI draft. "
                    "Failed and unsupported cases have no approvable AI draft; use manual workflow outside AI approval."
                ),
            )
        if case.status == CaseLifecycleStatus.FAILED:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot review a failed analysis as an AI draft.")
        if case.status == CaseLifecycleStatus.MANUAL_REVIEW:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Unsupported case is for manual review only; AI draft reject/revision does not apply.",
            )

        report = case.draft_report
        self._apply_edits(report, feedback)
        report.reviewer_comment = feedback.comment

        if feedback.action == ReviewAction.REJECT:
            report.status = ReportStatus.REJECTED
            report.expert_review_status = ExpertReviewStatus.REJECTED
            case.status = CaseLifecycleStatus.REJECTED
        else:
            report.status = ReportStatus.REVISION_REQUESTED
            report.expert_review_status = ExpertReviewStatus.REVISION_REQUESTED
            case.status = CaseLifecycleStatus.REVISION_REQUESTED

        case.review_history.append(feedback)
        case.updated_at = _now()
        return self._repo.save_case(case)

    def _approve_ai_draft(self, case: CaseRecord, feedback: ReviewFeedback) -> CaseRecord:
        if case.status == CaseLifecycleStatus.FAILED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot approve: analysis failed and produced no AI draft.",
            )
        if case.status == CaseLifecycleStatus.MANUAL_REVIEW:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Cannot approve an AI draft for an unsupported case. "
                    "This case requires manual radiologist review, which is distinct from AI draft approval."
                ),
            )
        if case.draft_report is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot approve: there is no AI-generated draft report.",
            )

        report = case.draft_report
        if report.status == ReportStatus.VALIDATION_FAILED:
            # Still allow edits + revalidation path below; block only if revalidation fails.
            pass

        self._apply_edits(report, feedback)
        report.reviewer_comment = feedback.comment

        validation = self._validator.validate(report, case.structured_findings)
        if not validation.ok or report.status == ReportStatus.VALIDATION_FAILED:
            case.updated_at = _now()
            self._repo.save_case(case)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": "Cannot approve: draft failed structural revalidation.",
                    "errors": validation.errors,
                    "warnings": validation.warnings,
                },
            )

        if report.status not in {ReportStatus.AWAITING_REVIEW, ReportStatus.DRAFT}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot approve draft in status '{report.status.value}'.",
            )

        report.status = ReportStatus.APPROVED
        report.expert_review_status = ExpertReviewStatus.APPROVED
        case.status = CaseLifecycleStatus.APPROVED
        case.review_history.append(feedback)
        case.updated_at = _now()
        return self._repo.save_case(case)

    @staticmethod
    def _apply_edits(report: DraftReport, feedback: ReviewFeedback) -> None:
        if feedback.edited_technique is not None:
            report.technique.text = feedback.edited_technique
        if feedback.edited_findings is not None:
            report.findings.text = feedback.edited_findings
        if feedback.edited_impression is not None:
            report.impression.text = feedback.edited_impression
        if feedback.edited_recommendations is not None:
            report.recommendations.text = feedback.edited_recommendations
