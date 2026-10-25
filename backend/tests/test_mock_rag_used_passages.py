"""ISS-RAG-04/05 — mock used_passage_ids + related_finding_ids."""

from __future__ import annotations

from app.llm.mock_provider import MockLLMProvider
from app.llm.interfaces import LLMFindingRef, LLMGenerationInput, LLMRequest
from app.schemas.enums import AnatomicalRegion, FindingStatus, Modality, ModelExecutionStatus, SourceKind, Species
from app.schemas.rag import RagPassage


def test_mock_uses_subset_of_retrieved_passages() -> None:
    passages = [
        RagPassage(source_id=f"src-{i}", title=f"T{i}", section="s", passage=f"passage {i}", score=0.9 - i * 0.1)
        for i in range(4)
    ]
    gen = LLMGenerationInput(
        case_id="case-x",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        findings=[
            LLMFindingRef(
                finding_id="f-1",
                finding_code="CODE-A",
                description="d",
                anatomical_location="brain",
                finding_status=FindingStatus.SUSPECTED,
                source_model="mock",
            )
        ],
        findings_source_kind=SourceKind.MOCK,
        findings_model_id="mock",
        findings_model_version="0.1.0",
        execution_status=ModelExecutionStatus.SUCCESS,
        no_findings_returned=False,
        rag_passages=passages,
    )
    report = MockLLMProvider().generate(LLMRequest(generation=gen)).report
    assert report.used_passage_ids
    assert len(report.used_passage_ids) <= 2
    assert len(report.rag_citations) == len(report.used_passage_ids)
    assert set(report.used_passage_ids) == {c.source_id for c in report.rag_citations}
    assert all(c.related_finding_ids for c in report.rag_citations)
    assert "src-3" not in report.used_passage_ids  # unused retrieved
