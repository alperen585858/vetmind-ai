"""ISS-RAG-04 — HTTP LLM wire used_passage_ids filters citations."""

from __future__ import annotations

import json

import httpx

from app.llm.http_provider import HttpLLMProvider
from app.llm.interfaces import LLMFindingRef, LLMGenerationInput, LLMRequest
from app.schemas.enums import AnatomicalRegion, FindingStatus, Modality, ModelExecutionStatus, SourceKind, Species
from app.schemas.rag import RagPassage


def _gen(passages: list[RagPassage]) -> LLMGenerationInput:
    return LLMGenerationInput(
        case_id="case-http-rag",
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
                source_model="remote",
            )
        ],
        findings_source_kind=SourceKind.REAL,
        findings_model_id="remote",
        findings_model_version="0.1.0",
        execution_status=ModelExecutionStatus.SUCCESS,
        no_findings_returned=False,
        rag_passages=passages,
    )


def test_http_llm_filters_to_used_passage_ids(monkeypatch) -> None:
    passages = [
        RagPassage(source_id=f"src-{i}", title=f"T{i}", section="s", passage=f"p{i}", score=0.9)
        for i in range(3)
    ]

    class FakeClient:
        def __init__(self, *args, **kwargs):  # noqa: ANN002, ANN003
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):  # noqa: ANN002
            return False

        def post(self, *args, **kwargs):  # noqa: ANN002, ANN003
            body = {
                "technique": "MR brain",
                "findings": "Suspected finding.",
                "impression": "Needs review.",
                "recommendations": "Radiologist review.",
                "cited_finding_ids": ["f-1"],
                "used_passage_ids": ["src-0", "src-2"],
            }
            return httpx.Response(200, json=body)

    monkeypatch.setattr("app.llm.http_provider.httpx.Client", FakeClient)
    report = HttpLLMProvider(endpoint="http://127.0.0.1:9/draft").generate(
        LLMRequest(generation=_gen(passages))
    ).report
    assert report.used_passage_ids == ["src-0", "src-2"]
    assert {c.source_id for c in report.rag_citations} == {"src-0", "src-2"}
    assert "src-1" not in report.used_passage_ids


def test_http_llm_legacy_without_used_ids(monkeypatch) -> None:
    passages = [
        RagPassage(source_id="src-0", title="T", section="s", passage="p", score=0.5),
        RagPassage(source_id="src-1", title="T2", section="s", passage="p2", score=0.4),
    ]

    class FakeClient:
        def __init__(self, *args, **kwargs):  # noqa: ANN002, ANN003
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):  # noqa: ANN002
            return False

        def post(self, *args, **kwargs):  # noqa: ANN002, ANN003
            return httpx.Response(
                200,
                content=json.dumps(
                    {
                        "technique": "t",
                        "findings": "f",
                        "impression": "i",
                        "recommendations": "r",
                    }
                ),
                headers={"Content-Type": "application/json"},
            )

    monkeypatch.setattr("app.llm.http_provider.httpx.Client", FakeClient)
    report = HttpLLMProvider(endpoint="http://127.0.0.1:9/draft").generate(
        LLMRequest(generation=_gen(passages))
    ).report
    assert report.used_passage_ids == []
    assert len(report.rag_citations) == 2
    assert "legacy" in (report.rag_note or "").lower() or "used_passage" in (report.rag_note or "")
