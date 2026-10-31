from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from app.imaging.metadata_prep import MetadataOnlyPreparationPipeline
from app.llm.gateway import LLMGateway
from app.llm.interfaces import LLMProviderError
from app.models.interfaces import ImagingAdapterError, ImagingModel
from app.models.normalizer import normalize_outputs
from app.routing.execution_policy import ModelExecutionPolicy
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
from app.review_sla import apply_review_sla
from app.schemas.findings import StructuredFindings
from app.orchestration.progress import apply_pipeline_progress
from app.schemas.jobs import AnalysisJob, PipelineResult
from app.schemas.report import DraftReport
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
        execution_policy: ModelExecutionPolicy | None = None,
        *,
        pixel_analysis_opt_in: bool = False,
        quarantine_root: Path | None = None,
    ) -> None:
        self._router = router
        self._models = model_registry
        self._llm = llm_gateway
        self._validator = validator
        self._scenario_policy = scenario_policy or ScenarioRoutingPolicy()
        # Default exclusive_real with empty caps is a no-op filter (no REAL matches).
        self._execution_policy = execution_policy or ModelExecutionPolicy()
        self._pixel_analysis_opt_in = bool(pixel_analysis_opt_in)
        self._quarantine_root = quarantine_root
        self._prep = MetadataOnlyPreparationPipeline(
            capabilities=list(self._router.list_capabilities()),
            pixel_analysis_opt_in=self._pixel_analysis_opt_in,
            quarantine_root=self._quarantine_root,
        )

    @property
    def validator(self) -> ReportValidator:
        return self._validator

    def regenerate_report(self, case: CaseRecord, expert_note: str) -> DraftReport:
        """LLM-only rerun for an expert revision request. Imaging adapters are not re-run.

        Raises LLMProviderError on provider failure (no mock fallback); the caller keeps the old draft.
        """
        if case.structured_findings is None or case.draft_report is None:
            raise ValueError("Case has no findings/draft to revise.")
        report = self._llm.revise_draft(case, case.structured_findings, case.draft_report, expert_note)
        self._validator.validate(report, case.structured_findings)
        return report

    def run(
        self,
        case: CaseRecord,
        job: AnalysisJob,
        *,
        cancel_probe: Callable[[], bool] | None = None,
        on_progress: Callable[[AnalysisJob], None] | None = None,
    ) -> PipelineResult:
        def _cancelled() -> bool:
            if job.cancel_requested or job.status == JobStatus.CANCEL_REQUESTED:
                return True
            if cancel_probe is None:
                return False
            try:
                if cancel_probe():
                    job.cancel_requested = True
                    return True
            except Exception:  # noqa: BLE001 — probe must never crash the pipeline
                return False
            return False

        def _checkpoint(
            stage: str,
            *,
            vision_adapter_index: int | None = None,
            vision_adapter_total: int | None = None,
            done: bool = False,
        ) -> None:
            apply_pipeline_progress(
                job,
                stage,
                vision_adapter_index=vision_adapter_index,
                vision_adapter_total=vision_adapter_total,
                done=done,
            )
            if on_progress is None:
                return
            try:
                on_progress(job)
            except Exception:  # noqa: BLE001 — progress persistence must not fail the run
                return

        if _cancelled():
            job.status = JobStatus.CANCELLED
            job.outcome = PipelineOutcome.FAILED
            job.error_message = "Cancelled before start (cooperative cancel)."
            job.completed_at = _now()
            case.status = CaseLifecycleStatus.FAILED
            case.updated_at = _now()
            return PipelineResult(
                job=job,
                outcome=PipelineOutcome.FAILED,
                messages=["Job cancelled before adapter execution."],
            )

        job.status = JobStatus.RUNNING
        job.started_at = _now()
        _checkpoint("prep_metadata")
        messages: list[str] = [
            "Orchestrator run (sync within worker/request). FE poll abort does not cancel this job."
        ]

        try:
            # Always refresh via metadata-only prep (F4) — adapters must not mutate case.
            caps = self._router.list_capabilities()
            self._prep = MetadataOnlyPreparationPipeline(
                capabilities=list(caps),
                pixel_analysis_opt_in=self._pixel_analysis_opt_in,
                quarantine_root=self._quarantine_root,
            )
            case.model_input = self._prep.prepare(case=case)
            model_input = case.model_input
            messages.append(
                f"ImagingModelInput v{model_input.schema_version} ready "
                f"({model_input.total_instances} instances, prepared_for={model_input.prepared_for_models})."
            )
            messages.append(
                "pixel_authorization="
                f"{'authorized' if model_input.pixel_analysis_authorized else 'denied'} "
                f"codes={list(model_input.pixel_authorization.reason_codes)}"
            )

            _checkpoint("route_models")
            # Capability route → mock scenario overrides → REAL/MOCK execution policy.
            decision = self._execution_policy.apply(
                self._scenario_policy.apply(case, self._router.route(case))
            )
            job.routed_model_ids = decision.model_ids
            job.route_reason = decision.reason
            job.route_rule_id = decision.rule_id
            job.matched_capabilities = list(decision.matched_capabilities or decision.model_ids)
            cap_by_id = {c.model_id: c for c in caps}
            job.routed_model_versions = [
                cap_by_id[m].model_version for m in decision.model_ids if m in cap_by_id
            ]
            kinds = {cap_by_id[m].source_kind.value for m in decision.model_ids if m in cap_by_id}
            if kinds == {"real"}:
                job.analysis_mode = "real"
            elif kinds == {"mock"} or not kinds:
                job.analysis_mode = "mock"
            else:
                job.analysis_mode = "mixed"
            if decision.model_ids:
                timeouts = [cap_by_id[m].timeout_s for m in decision.model_ids if m in cap_by_id]
                if timeouts:
                    job.timeout_s = max(timeouts)
            messages.append(decision.reason)
            if decision.rule_id:
                messages.append(f"route_rule_id={decision.rule_id}")
            if model_input.selection is not None:
                messages.append(
                    f"series_selection={model_input.selection.mode}:"
                    f"{len(model_input.selection.series_instance_uids)} series"
                )
            messages.append(f"analysis_mode={job.analysis_mode}")

            if _cancelled():
                job.status = JobStatus.CANCELLED
                job.outcome = PipelineOutcome.FAILED
                job.error_message = "Cancelled after routing (before adapters)."
                job.completed_at = _now()
                case.status = CaseLifecycleStatus.FAILED
                case.updated_at = _now()
                return PipelineResult(
                    job=job,
                    outcome=PipelineOutcome.FAILED,
                    messages=messages + [job.error_message],
                )

            outputs: list[StructuredFindings] = []
            failures: list[str] = []
            model_ids = list(decision.model_ids)
            vision_total = len(model_ids)
            for idx, model_id in enumerate(model_ids):
                _checkpoint(
                    "vision_adapters",
                    vision_adapter_index=idx,
                    vision_adapter_total=max(vision_total, 1),
                )
                if _cancelled():
                    job.status = JobStatus.CANCELLED
                    job.outcome = PipelineOutcome.FAILED
                    job.error_message = "Cancelled during adapter loop."
                    job.completed_at = _now()
                    case.status = CaseLifecycleStatus.FAILED
                    case.updated_at = _now()
                    return PipelineResult(
                        job=job,
                        outcome=PipelineOutcome.FAILED,
                        messages=messages + [job.error_message],
                    )
                adapter = self._models.get(model_id)
                if adapter is None:
                    failures.append(f"Unknown model id '{model_id}'.")
                    continue
                try:
                    outputs.append(adapter.analyze(case))
                except ImagingAdapterError as exc:
                    msg = str(exc)
                    failures.append(msg)
                    from app.models.errors import InferenceTimeoutError

                    if isinstance(exc, InferenceTimeoutError) or "timed out" in msg.lower():
                        job.status = JobStatus.TIMED_OUT
                except Exception as exc:  # noqa: BLE001 — convert unexpected adapter crashes
                    failures.append(f"Adapter {model_id} raised {type(exc).__name__}.")

            if not outputs:
                if job.status != JobStatus.TIMED_OUT:
                    job.status = JobStatus.FAILED
                job.outcome = PipelineOutcome.FAILED
                job.error_message = "; ".join(failures) or "No imaging adapter produced output."
                job.completed_at = _now()
                case.status = CaseLifecycleStatus.FAILED
                case.structured_findings = None
                case.draft_report = None
                case.updated_at = _now()
                return PipelineResult(job=job, outcome=PipelineOutcome.FAILED, messages=messages + failures)

            _checkpoint("normalize_findings", vision_adapter_total=max(vision_total, 1))
            findings = normalize_outputs(outputs, model_input=model_input)
            if failures:
                findings.warnings.extend(failures)
                if findings.execution_status == ModelExecutionStatus.SUCCESS:
                    findings.execution_status = ModelExecutionStatus.PARTIAL

            if findings.execution_status == ModelExecutionStatus.UNSUPPORTED or not decision.supported:
                apply_pipeline_progress(job, "finalize", done=True)
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

            if _cancelled():
                job.status = JobStatus.CANCELLED
                job.outcome = PipelineOutcome.FAILED
                job.error_message = "Cancelled after imaging (before LLM draft)."
                job.completed_at = _now()
                case.status = CaseLifecycleStatus.FAILED
                case.structured_findings = findings
                case.updated_at = _now()
                return PipelineResult(
                    job=job,
                    findings=findings,
                    report=None,
                    outcome=PipelineOutcome.FAILED,
                    messages=messages + [job.error_message],
                )

            _checkpoint("llm_draft")
            try:
                report = self._llm.generate_draft(case, findings)
            except LLMProviderError as exc:
                # Typed LLM failure: keep findings, never attach an approvable draft, no mock fallback.
                job.status = JobStatus.FAILED
                job.outcome = PipelineOutcome.FAILED
                job.error_message = f"LLM provider error ({exc.kind.value}): {exc}"
                job.completed_at = _now()
                case.status = CaseLifecycleStatus.FAILED
                case.structured_findings = findings
                case.draft_report = None
                case.updated_at = _now()
                messages.append(job.error_message)
                return PipelineResult(
                    job=job,
                    findings=findings,
                    report=None,
                    outcome=PipelineOutcome.FAILED,
                    messages=list(dict.fromkeys(messages)),
                )

            # Cooperative cancel during/after LLM: discard draft if cancel was requested
            # while the (blocking) provider call ran (ISS-LLM-04).
            if _cancelled():
                job.status = JobStatus.CANCELLED
                job.outcome = PipelineOutcome.FAILED
                job.error_message = "Cancelled during/after LLM draft (cooperative cancel)."
                job.completed_at = _now()
                case.status = CaseLifecycleStatus.FAILED
                case.structured_findings = findings
                case.draft_report = None
                case.updated_at = _now()
                return PipelineResult(
                    job=job,
                    findings=findings,
                    report=None,
                    outcome=PipelineOutcome.FAILED,
                    messages=messages + [job.error_message],
                )

            _checkpoint("validate_report")
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

            apply_review_sla(case)
            _checkpoint("finalize", done=True)
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
        job = AnalysisJob(job_id=f"job-{uuid4().hex[:12]}", case_id=case_id, status=JobStatus.QUEUED)
        apply_pipeline_progress(job, "queued")
        return job
