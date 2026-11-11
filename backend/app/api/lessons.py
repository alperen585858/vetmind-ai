"""Expert revision lessons: save a correction once, apply it to similar future drafts."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_case_service, get_container
from app.auth.deps import AuthPrincipal, require_auth, require_capability
from app.auth.rbac import CAP_REVIEW
from app.container import AppContainer
from app.llm.gateway import build_lesson_context
from app.llm.lessons import MAX_LESSON_CHARS, RevisionLesson, clean_instruction
from app.services.case_service import CaseService

router = APIRouter(prefix="/api/v1/lessons", tags=["lessons"], dependencies=[Depends(require_auth)])


class LessonCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    case_id: str = Field(min_length=1, max_length=120)
    instruction: str = Field(min_length=10, max_length=2000)
    reason_codes: list[str] = Field(default_factory=list, max_length=10)


class LessonPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active: bool | None = None
    instruction: str | None = Field(default=None, min_length=10, max_length=MAX_LESSON_CHARS)


@router.get("", response_model=list[RevisionLesson])
def list_lessons(
    container: AppContainer = Depends(get_container),
    _auth: AuthPrincipal = Depends(require_capability(CAP_REVIEW)),
) -> list[RevisionLesson]:
    return container.lessons.list()


@router.post("", response_model=RevisionLesson, status_code=status.HTTP_201_CREATED)
def create_lesson(
    payload: LessonCreate,
    container: AppContainer = Depends(get_container),
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_REVIEW)),
) -> RevisionLesson:
    """Remember an expert's revision note for cases like ``case_id`` (same region / species)."""
    case = service.get_case(payload.case_id, principal=principal)
    instruction = clean_instruction(
        payload.instruction,
        known=[(case.patient_name, "[HASTA]"), (case.referring_clinic, "[KLİNİK]")],
    )
    if len(instruction) < 10:
        raise HTTPException(status_code=422, detail="Lesson text is too short after removing personal data.")
    return container.lessons.add(
        instruction=instruction,
        context=build_lesson_context(case, case.structured_findings),
        created_by=principal.subject,
        source_case_id=case.case_id,
        reason_codes=payload.reason_codes,
    )


@router.patch("/{lesson_id}", response_model=RevisionLesson)
def update_lesson(
    lesson_id: str,
    payload: LessonPatch,
    container: AppContainer = Depends(get_container),
    _auth: AuthPrincipal = Depends(require_capability(CAP_REVIEW)),
) -> RevisionLesson:
    instruction = clean_instruction(payload.instruction) if payload.instruction is not None else None
    lesson = container.lessons.update(lesson_id, active=payload.active, instruction=instruction)
    if lesson is None:
        raise HTTPException(status_code=404, detail="Lesson not found.")
    return lesson


@router.delete("/{lesson_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lesson(
    lesson_id: str,
    container: AppContainer = Depends(get_container),
    _auth: AuthPrincipal = Depends(require_capability(CAP_REVIEW)),
) -> None:
    if not container.lessons.delete(lesson_id):
        raise HTTPException(status_code=404, detail="Lesson not found.")
