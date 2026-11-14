from app.llm.anatomy_dictionary import AnatomyDictionary
from app.llm.interfaces import (
    LLMFindingRef,
    LLMGenerationInput,
    LLMProvider,
    LLMProviderError,
    LLMRequest,
    LLMResponse,
    RevisionContext,
)
from app.llm.lessons import LessonContext, LessonStore
from app.llm.privacy import redact_personal_data
from app.models.ontology import is_technique_code
from app.rag.relevance import RagFilter, build_retrieval_query
from app.rag.retriever import RagRetriever
from app.schemas.case import CaseRecord
from app.schemas.enums import (
    AnatomicalRegion, FindingStatus, Modality, ModelExecutionStatus, SourceKind, Species,
)
from app.schemas.findings import StructuredFindings
from app.schemas.report import DraftReport, ReportAnatomyTerminology


def build_rag_query(case: CaseRecord, findings: StructuredFindings) -> str:
    """Turkish content query (region/modality words, history, finding text; no enum codes)."""
    history = case.clinical_history or ""
    structured = case.clinical_history_structured
    if structured is not None and structured.complaint and structured.complaint.strip() not in history:
        history = f"{structured.complaint.strip()}. {history}".strip()
    document_text = None
    if case.document_context and case.document_context.combined_text_preview:
        document_text = case.document_context.combined_text_preview
    return build_retrieval_query(
        species=case.species.value,
        modality=case.modality.value,
        region=case.anatomical_region.value,
        history=history,
        findings=[(f.description, f.anatomical_location) for f in findings.findings],
        document_text=document_text,
    )


def build_lesson_context(case: CaseRecord, findings: StructuredFindings | None) -> LessonContext:
    return LessonContext(
        region=case.anatomical_region.value,
        species=case.species.value,
        modality=case.modality.value,
        finding_codes=[f.finding_code for f in (findings.findings if findings else [])],
    )


def build_rag_filter(case: CaseRecord) -> RagFilter:
    return RagFilter(
        region=case.anatomical_region.value,
        species=case.species.value,
        modality=case.modality.value,
    )


_STRUCTURED_HISTORY_LABELS = (
    ("complaint", "Şikâyet"),
    ("onset", "Başlangıç"),
    ("course", "Seyir"),
    ("medications", "İlaçlar"),
    ("relevant_history", "İlgili öykü"),
)


def compose_history(case: CaseRecord) -> str:
    """Free-text + structured history (handoff notes excluded), unredacted."""
    parts = [case.clinical_history.strip()] if case.clinical_history and case.clinical_history.strip() else []
    structured = case.clinical_history_structured
    if structured is not None:
        for attr, label in _STRUCTURED_HISTORY_LABELS:
            value = getattr(structured, attr)
            if value and value.strip():
                parts.append(f"{label}: {value.strip()}")
    return "\n".join(parts)


def build_generation_input(
    case: CaseRecord,
    findings: StructuredFindings,
    *,
    rag_passages: list | None = None,
    language: str = "tr",
    anatomy_dictionary: AnatomyDictionary | None = None,
) -> LLMGenerationInput:
    """Project case/findings into a minimal outbound DTO (no quarantine/credentials/PII names)."""
    doc_count = 0
    if case.document_context is not None:
        doc_count = len(case.document_context.documents)
    redacted = redact_personal_data(
        compose_history(case),
        known=[(case.patient_name, "[HASTA]"), (case.referring_clinic, "[KLİNİK]")],
    )
    lang = (language or "tr").strip().lower() or "tr"
    if lang not in {"tr", "en"}:
        lang = "tr"
    if (
        lang != "tr"
        or case.modality != Modality.MR
        or case.anatomical_region not in {AnatomicalRegion.BRAIN, AnatomicalRegion.CERVICAL}
        or case.species not in {Species.CANINE, Species.FELINE}
        or findings.execution_status not in {ModelExecutionStatus.SUCCESS, ModelExecutionStatus.PARTIAL}
        or findings.no_findings_returned
        or not findings.findings
        or (
            anatomy_dictionary is not None
            and anatomy_dictionary.version.mode == "demo"
            and findings.source_kind != SourceKind.MOCK
        )
    ):
        anatomy_dictionary = None
    cov = findings.analysis_coverage
    return LLMGenerationInput(
        case_id=case.case_id,
        species=case.species,
        breed=case.breed,
        patient_age_years=case.patient_age_years,
        modality=case.modality,
        anatomical_region=case.anatomical_region,
        clinical_history=redacted.text or None,
        redaction_counts=redacted.counts,
        findings=[
            LLMFindingRef(
                finding_id=f.finding_id,
                finding_code=f.finding_code,
                description=f.description,
                anatomical_location=f.anatomical_location,
                finding_status=f.finding_status,
                source_model=f.source_model,
                evidence_locus=(
                    (f.evidence_references[0].description if f.evidence_references else None)
                ),
                uncertainty_note=f.uncertainty_note,
                laterality=f.laterality if f.laterality != "UNKNOWN" else None,
                anatomy_term=(
                    anatomy_dictionary.resolve(f.anatomical_location, species=case.species)
                    if anatomy_dictionary is not None
                    and (anatomy_dictionary.version.mode == "reviewed" or f.synthetic)
                    and (
                        f.anatomical_location_reported
                        if f.anatomical_location_reported is not None
                        # Legacy adapters fill missing locations with the case's uppercase enum.
                        else f.anatomical_location != findings.anatomical_region.value
                    )
                    and f.finding_status != FindingStatus.NOT_ASSESSED
                    and not is_technique_code(f.finding_code)
                    else None
                ),
            )
            for f in findings.findings
        ],
        findings_source_kind=findings.source_kind,
        findings_model_id=findings.source_model_id,
        findings_model_version=findings.source_model_version,
        execution_status=findings.execution_status,
        no_findings_returned=findings.no_findings_returned,
        document_context_file_count=doc_count,
        analysis_scope=(cov.analysis_scope if cov is not None else None),
        frames_detected=(cov.frames_detected if cov is not None else None),
        frames_decoded=(cov.frames_decoded if cov is not None else None),
        frames_visually_analyzed=(cov.frames_visually_analyzed if cov is not None else None),
        series_total=(cov.series_total if cov is not None else None),
        dicom_files_total=(cov.dicom_files_total if cov is not None else None),
        conflict_notes=[
            (c.reason or "").strip()
            for c in (findings.potential_conflicts or [])
            if (c.reason or "").strip()
        ][:6],
        rag_passages=list(rag_passages or []),
        rag_is_clinical_validation=False,
        language=lang,
        anatomy_dictionary=anatomy_dictionary.version if anatomy_dictionary is not None else None,
    )


class LLMGateway:
    """Provider-independent gateway. Optional RAG retriever enriches the draft."""

    def __init__(
        self,
        provider: LLMProvider,
        rag: RagRetriever | None = None,
        *,
        rag_top_k: int = 4,
        lessons: LessonStore | None = None,
        anatomy_dictionary: AnatomyDictionary | None = None,
    ) -> None:
        self._provider = provider
        self._rag = rag
        self._rag_top_k = rag_top_k
        self._lessons = lessons
        self._anatomy_dictionary = anatomy_dictionary

    @property
    def provider_id(self) -> str:
        return self._provider.provider_id

    def set_provider(self, provider: LLMProvider) -> None:
        self._provider = provider

    def set_rag(self, rag: RagRetriever | None) -> None:
        self._rag = rag

    def _retrieve(self, case: CaseRecord, findings: StructuredFindings) -> list:
        assert self._rag is not None
        return self._rag.retrieve(
            build_rag_query(case, findings),
            top_k=self._rag_top_k,
            filters=build_rag_filter(case),
        )

    def _with_lessons(self, case: CaseRecord, findings: StructuredFindings, generation):  # noqa: ANN001
        """Attach matching expert lessons; returns (generation, lesson_ids)."""
        if self._lessons is None:
            return generation, []
        matched = self._lessons.match(build_lesson_context(case, findings))
        if not matched:
            return generation, []
        updated = generation.model_copy(update={"expert_lessons": [m.instruction for m in matched]})
        return updated, [m.lesson_id for m in matched]

    def _record_generation_metadata(
        self, report: DraftReport, lesson_ids: list[str], generation: LLMGenerationInput,
    ) -> DraftReport:
        # Template providers (mock/stub) never read the prompt, so they did not "apply" anything.
        if lesson_ids and report.generation.prompt_version is not None:
            report.generation.applied_lesson_ids = list(lesson_ids)
            if self._lessons is not None:
                self._lessons.mark_applied(lesson_ids)
        if generation.anatomy_dictionary is not None:
            report.generation.anatomy_terminology = ReportAnatomyTerminology(
                dictionary=generation.anatomy_dictionary,
                matches={
                    f.finding_id: f.anatomy_term
                    for f in generation.findings
                    if f.anatomy_term is not None
                },
            )
        return report

    def _draft_input(
        self, case: CaseRecord, findings: StructuredFindings, language: str,
    ) -> LLMGenerationInput:
        return build_generation_input(
            case,
            findings,
            rag_passages=self._retrieve(case, findings) if self._rag is not None else None,
            language=language,
            anatomy_dictionary=self._anatomy_dictionary,
        )

    def generate_draft(
        self,
        case: CaseRecord,
        findings: StructuredFindings,
        *,
        language: str = "tr",
    ) -> DraftReport:
        generation = self._draft_input(case, findings, language)
        generation, lesson_ids = self._with_lessons(case, findings, generation)
        try:
            response: LLMResponse = self._provider.generate(
                LLMRequest(generation=generation)
            )
        except LLMProviderError:
            # Do not fall back to a mock draft after a real provider failure.
            raise
        return self._record_generation_metadata(response.report, lesson_ids, generation)

    def revise_draft(
        self,
        case: CaseRecord,
        findings: StructuredFindings,
        previous: DraftReport,
        expert_note: str,
        *,
        language: str = "tr",
    ) -> DraftReport:
        """Regenerate the draft with the expert's revision request; same findings, fresh retrieval."""
        generation = self._draft_input(case, findings, language)
        generation, lesson_ids = self._with_lessons(case, findings, generation)
        known = [(case.patient_name, "[HASTA]"), (case.referring_clinic, "[KLİNİK]")]
        revision = RevisionContext(
            previous_sections={
                k: redact_personal_data(getattr(previous, k).text, known=known).text
                for k in ("technique", "findings", "impression", "recommendations")
            },
            expert_note=redact_personal_data(expert_note, known=known).text,
        )
        response = self._provider.generate(LLMRequest(generation=generation, revision=revision))
        return self._record_generation_metadata(response.report, lesson_ids, generation)
