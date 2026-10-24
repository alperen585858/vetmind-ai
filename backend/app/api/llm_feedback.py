"""Expert feedback on LLM drafts (admin only). See app/llm/feedback.py."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse

from app.api.deps import get_container
from app.auth.deps import require_auth, require_capability
from app.auth.rbac import CAP_ADMIN
from app.container import AppContainer
from app.llm.factory import ANTHROPIC_KINDS, OLLAMA_KINDS, OPENAI_KINDS
from app.llm.feedback import collect_feedback, export_chat_jsonl, export_jsonl, summarize
from app.llm.prompts import PROMPT_VERSION

router = APIRouter(prefix="/api/v1/llm", tags=["llm"], dependencies=[Depends(require_auth)])

EVAL_RESULTS_DIR = Path(__file__).resolve().parents[2] / "eval" / "results"
PROMPT_PROVIDERS = OPENAI_KINDS | OLLAMA_KINDS | ANTHROPIC_KINDS


@router.get("/status")
def llm_status(
    container: AppContainer = Depends(get_container),
    _auth=Depends(require_capability(CAP_ADMIN)),
) -> dict:
    """Active report model. ``prompt_version`` is null for template (mock/stub/http) providers."""
    provider = container.llm_provider
    kind = (container.settings.llm_provider or "mock").lower()
    return {
        "kind": kind,
        "provider_id": provider.provider_id,
        "model_id": provider.model_id,
        "model_version": provider.model_version,
        "prompt_version": PROMPT_VERSION if kind in PROMPT_PROVIDERS else None,
        "report_language": container.settings.llm_report_language,
    }


@router.get("/eval/latest")
def latest_eval(
    _auth=Depends(require_capability(CAP_ADMIN)),
) -> dict:
    """Newest offline evaluation (scripts/llm_eval.py), without report texts."""
    files = sorted(EVAL_RESULTS_DIR.glob("*.json")) if EVAL_RESULTS_DIR.is_dir() else []
    if not files:
        raise HTTPException(status_code=404, detail="No evaluation results yet. Run scripts/llm_eval.py.")
    data = json.loads(files[-1].read_text(encoding="utf-8"))
    for run in data.get("runs", []):
        for case in run.get("cases", []):
            case.pop("sections", None)
    return {"file": files[-1].name, **data}


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
