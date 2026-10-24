"""Expert feedback on LLM drafts (admin only). See app/llm/feedback.py."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse

from app.api.deps import get_container
from app.auth.deps import require_auth, require_capability
from app.auth.rbac import CAP_ADMIN
from app.container import AppContainer
from app.llm.feedback import collect_feedback, export_chat_jsonl, export_jsonl, summarize

router = APIRouter(prefix="/api/v1/llm", tags=["llm"], dependencies=[Depends(require_auth)])


@router.get("/feedback")
def feedback_summary(
    include_records: bool = Query(False, description="Include per-case records with section texts."),
    container: AppContainer = Depends(get_container),
    _auth=Depends(require_capability(CAP_ADMIN)),
) -> dict:
    records = collect_feedback(container.repo.list_cases())
    out = summarize(records)
    if include_records:
        out["records"] = [r.to_json() for r in records]
    return out


@router.get("/feedback/export", response_class=PlainTextResponse)
def feedback_export(
    format: Literal["jsonl", "chat"] = Query("jsonl"),
    container: AppContainer = Depends(get_container),
    _auth=Depends(require_capability(CAP_ADMIN)),
) -> PlainTextResponse:
    cases = container.repo.list_cases()
    if format == "chat":
        body = export_chat_jsonl(cases, language=container.settings.llm_report_language)
    else:
        body = export_jsonl(collect_feedback(cases))
    return PlainTextResponse(
        body,
        media_type="application/x-ndjson",
        headers={"Content-Disposition": f'attachment; filename="vetmind-feedback-{format}.jsonl"'},
    )
