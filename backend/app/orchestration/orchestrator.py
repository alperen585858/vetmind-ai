from datetime import datetime, timezone
from uuid import uuid4

from app.llm.gateway import LLMGateway
from app.models.interfaces import ImagingAdapterError, ImagingModel
from app.models.model_input_builder import ensure_model_input
from app.models.normalizer import normalize_outputs
from app.routing.model_router import ModelRouter
from app.routing.scenario_policy import ScenarioRoutingPolicy
from app.schemas.case import CaseRecord
from app.schemas.enums import (
    CaseLifecycleStatus,
    JobStatus,
    ModelExecutionStatus,
    PipelineOutcome,
    ReportStatus,
)
from app.schemas.findings import StructuredFindings
from app.schemas.jobs import AnalysisJob, PipelineResult
from app.validation.report_validator import ReportValidator


def _now() -> datetime:
    return datetime.now(timezone.utc)


class AIOrchestrator:
    """Coordinates Case → Router → ScenarioPolicy → Vision adapters → Fusion → LLM → Validator.

    Adapters are injected via a typed registry. Analysis is synchronous (Phase 1/2A).
    """

    def __init__(
        self,
        router: ModelRouter,
        model_registry: dict[str, ImagingModel],
        llm_gateway: LLMGateway,
        validator: ReportValidator,
        scenario_policy: ScenarioRoutingPolicy | None = None,
    ) -> None:
        self._router = router
        self._models = model_registry
        self._llm = llm_gateway
        self._validator = validator
        self._scenario_policy = scenario_policy or ScenarioRoutingPolicy()

    @property
    def validator(self) -> ReportValidator:
        return self._validator

    def run(self, case: CaseRecord, job: AnalysisJob) -> PipelineResult:
        job.status = JobStatus.RUNNING
        job.started_at = _now()
        messages: list[str] = [
            "Analysis executes synchronously in the HTTP request (no background worker)."
        ]

        try:
            model_input = ensure_model_input(case)
            messages.append(
                f"ImagingModelInput v{model_input.schema_version} ready "
                f"({model_input.total_instances} instances, prepared_for={model_input.prepared_for_models})."
            )

            decision = self._scenario_policy.apply(case, self._router.route(case))
            job.routed_model_ids = decision.model_ids
            job.route_reason = decision.reason
            messages.append(decision.reason)

            outputs: list[StructuredFindings] = []
            failures: list[str] = []
            for model_id in decision.model_ids:
                adapter = self._models.get(model_id)
                if adapter is None:
                    failures.append(f"Unknown model id '{model_id}'.")
                    continue
                try:
                    outputs.append(adapter.analyze(case))
                except ImagingAdapterError as exc:
                    failures.append(str(exc))
                except Exception as exc:  # noqa: BLE001 — convert unexpected adapter crashes
                    failures.append(f"Adapter {model_id} raised {type(exc).__name__}.")

            if not outputs:
                job.status = JobStatus.FAILED
                job.outcome = PipelineOutcome.FAILED
                job.error_message = "; ".join(failures) or "No imaging adapter produced output."
                job.completed_at = _now()
                case.status = CaseLifecycleStatus.FAILED
                case.structured_findings = None
                case.draft_report = None
                case.updated_at = _now()
                return PipelineResult(job=job, outcome=PipelineOutcome.FAILED, messages=messages + failures)

            findings = normalize_outputs(outputs)
            if failures:
                findings.warnings.extend(failures)
                if findings.execution_status == ModelExecutionStatus.SUCCESS:
                    findings.execution_status = ModelExecutionStatus.PARTIAL

            if findings.execution_status == ModelExecutionStatus.UNSUPPORTED or not decision.supported:
                job.status = JobStatus.COMPLETED
                job.outcome = PipelineOutcome.UNSUPPORTED
                job.completed_at = _now()
                job.error_message = "; ".join(failures) if failures else None
                case.status = CaseLifecycleStatus.MANUAL_REVIEW
                case.structured_findings = findings
                case.draft_report = None
                case.updated_at = _now()
                messages.append(
                    "Unsupported study: no AI draft generated. Manual radiologist review required; "
                    "AI draft approval is disabled."
                )
                return PipelineResult(
                    job=job,
                    findings=findings,
                    report=None,
                    outcome=PipelineOutcome.UNSUPPORTED,
                    messages=list(dict.fromkeys(messages)),
                )

            if findings.execution_status == ModelExecutionStatus.FAILED:
                job.status = JobStatus.FAILED
                job.outcome = PipelineOutcome.FAILED
                job.completed_at = _now()
                job.error_message = "; ".join(failures) if failures else "Imaging execution failed."
                case.status = CaseLifecycleStatus.FAILED
                case.structured_findings = findings
                case.draft_report = None
                case.updated_at = _now()
                return PipelineResult(
                    job=job,
                    findings=findings,
                    report=None,
                    outcome=PipelineOutcome.FAILED,
                    messages=list(dict.fromkeys(messages + failures)),
                )

            report = self._llm.generate_draft(case, findings)
            validation = self._validator.validate(report, findings)
            messages.extend(validation.warnings)
            messages.extend(validation.errors)

            if validation.ok and report.status == ReportStatus.DRAFT:
                report.status = ReportStatus.AWAITING_REVIEW

            if not validation.ok:
                outcome = PipelineOutcome.PARTIAL
                case.status = CaseLifecycleStatus.AWAITING_REVIEW
                messages.append("Draft failed structural validation; expert approval of this draft is blocked.")
            elif findings.execution_status == ModelExecutionStatus.PARTIAL or failures:
                outcome = PipelineOutcome.PARTIAL
                case.status = CaseLifecycleStatus.AWAITING_REVIEW
            else:
                outcome = PipelineOutcome.SUCCESS
                case.status = CaseLifecycleStatus.AWAITING_REVIEW

            job.status = JobStatus.COMPLETED
            job.outcome = outcome
            job.completed_at = _now()
            job.error_message = "; ".join(failures) if failures else None
            case.structured_findings = findings
            case.draft_report = report
            case.updated_at = _now()
            return PipelineResult(
                job=job,
                findings=findings,
                report=report,
                outcome=outcome,
                messages=list(dict.fromkeys(messages)),
            )
        except Exception as exc:  # noqa: BLE001
            job.status = JobStatus.FAILED
            job.outcome = PipelineOutcome.FAILED
            job.error_message = f"Orchestrator error: {type(exc).__name__}"
            job.completed_at = _now()
            case.status = CaseLifecycleStatus.FAILED
            case.draft_report = None
            case.updated_at = _now()
            return PipelineResult(job=job, outcome=PipelineOutcome.FAILED, messages=messages + [job.error_message])

    @staticmethod
    def new_job(case_id: str) -> AnalysisJob:
        return AnalysisJob(job_id=f"job-{uuid4().hex[:12]}", case_id=case_id, status=JobStatus.QUEUED)
