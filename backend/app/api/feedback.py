"""Admin Feedback / Audit Store API (training-signal events)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse

from app.api.deps import get_container
from app.auth.deps import require_auth, require_capability
from app.auth.rbac import CAP_ADMIN
from app.container import AppContainer

router = APIRouter(prefix="/api/v1/feedback", tags=["feedback"], dependencies=[Depends(require_auth)])


@router.get("")
def list_feedback(
    clinic_id: str | None = Query(None),
    limit: int = Query(200, ge=1, le=2000),
    container: AppContainer = Depends(get_container),
    _auth=Depends(require_capability(CAP_ADMIN)),
) -> dict:
    events = container.feedback.list_events(clinic_id=clinic_id, limit=limit)
    return {
        "count": len(events),
        "events": [e.to_json() for e in events],
        "note": "Training-signal store. Not clinical validation. Separate from security audit.",
    }


@router.get("/export", response_class=PlainTextResponse)
def export_feedback(
    clinic_id: str | None = Query(None),
    container: AppContainer = Depends(get_container),
    _auth=Depends(require_capability(CAP_ADMIN)),
) -> PlainTextResponse:
    body = container.feedback.export_jsonl(clinic_id=clinic_id)
    return PlainTextResponse(body, media_type="application/x-ndjson")
