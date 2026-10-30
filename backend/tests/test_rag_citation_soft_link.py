"""ISS-RAG-05 — draft citations soft-link finding ids."""

from __future__ import annotations

from app.llm.rag_grounding import apply_used_passages_to_report
from app.schemas.enums import ReportStatus, SourceKind
from app.schemas.rag import RagPassage
from app.schemas.report import DraftReport, GenerationMetadata, ReportSection


def test_apply_used_passages_links_related_finding_ids() -> None:
    report = DraftReport(
        report_id="r1",
        case_id="case-1",
        status=ReportStatus.DRAFT,
        generation=GenerationMetadata(
            provider_id="http",
            model_id="m",
            model_version="1",
            source_kind=SourceKind.MOCK,
        ),
        technique=ReportSection(text="t", cited_finding_ids=[]),
        findings=ReportSection(text="f", cited_finding_ids=["find-a"]),
        impression=ReportSection(text="i", cited_finding_ids=[]),
        recommendations=ReportSection(text="r", cited_finding_ids=[]),
    )
    passages = [
        RagPassage(source_id="kb-1", title="T", section="s", passage="p", score=0.8),
    ]
    updated = apply_used_passages_to_report(
        report,
        passages,
        ["kb-1"],
        related_finding_ids=["find-a", "find-b"],
    )
    assert "find-a" in updated.rag_citations[0].related_finding_ids
