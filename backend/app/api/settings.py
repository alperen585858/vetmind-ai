"""User account / preference settings API."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_container
from app.auth.deps import AuthPrincipal, require_actor, require_auth
from app.container import AppContainer
from app.schemas.user_settings import UserSettings, UserSettingsUpdate

router = APIRouter(prefix="/api/v1/settings", tags=["settings"], dependencies=[Depends(require_auth)])


@router.get("/me", response_model=UserSettings)
def get_my_settings(
    principal: AuthPrincipal = Depends(require_actor),
    container: AppContainer = Depends(get_container),
) -> UserSettings:
    if not principal.subject or principal.subject == "anonymous":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Signed-in subject required for settings.",
        )
    return container.user_settings.get(principal.subject)


@router.put("/me", response_model=UserSettings)
def update_my_settings(
    payload: UserSettingsUpdate,
    principal: AuthPrincipal = Depends(require_actor),
    container: AppContainer = Depends(get_container),
) -> UserSettings:
    if not principal.subject or principal.subject == "anonymous":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Signed-in subject required for settings.",
        )
    return container.user_settings.update(principal.subject, payload)
