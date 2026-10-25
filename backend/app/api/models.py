"""AI model readiness inventory (no inference)."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_container
from app.auth.deps import require_auth
from app.container import AppContainer

router = APIRouter(
    prefix="/api/v1/models",
    tags=["models"],
    # Demo auth-off still yields anonymous principal; protected/auth-on requires a token.
    dependencies=[Depends(require_auth)],
)


@router.get("/readiness")
def model_readiness(container: AppContainer = Depends(get_container)) -> dict:
    """Configured models, capabilities, and availability. Pixel path remains default-deny."""
    return container.model_registry_view.readiness_payload()
