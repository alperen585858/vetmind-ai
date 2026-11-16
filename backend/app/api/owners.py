"""Vet-facing pet-owner directory search (clinic-scoped when isolation is on)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_container
from app.auth.deps import AuthPrincipal, require_auth, require_capability
from app.auth.rbac import CAP_CASE_WRITE
from app.container import AppContainer

router = APIRouter(
    prefix="/api/v1/owners",
    tags=["owners"],
    dependencies=[Depends(require_auth)],
)


class OwnerSearchHit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject: str
    display_name: str
    email: str
    role: str
    clinic_id: str | None = None


class OwnerSearchResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[OwnerSearchHit] = Field(default_factory=list)


@router.get("/search", response_model=OwnerSearchResponse)
def search_owners(
    q: str = Query(min_length=1, max_length=120),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_WRITE)),
    container: AppContainer = Depends(get_container),
) -> OwnerSearchResponse:
    """Search registered accounts (prefer owners) by email or display name."""
    needle = q.strip().lower()
    hits: list[OwnerSearchHit] = []
    seen: set[str] = set()

    def _add(email: str, role: str, clinic_id: str | None, display: str | None) -> None:
        email_l = email.strip().lower()
        if email_l in seen:
            return
        if principal.clinic_id and clinic_id and clinic_id != principal.clinic_id:
            # Clinic staff only see their clinic's owners when isolation is on.
            if container.settings.tenant_isolation and principal.role in {"vet", "clinic_owner", "expert"}:
                return
        hay = f"{email_l} {(display or '').lower()}"
        if needle not in hay:
            return
        seen.add(email_l)
        hits.append(
            OwnerSearchHit(
                subject=email_l,
                display_name=(display or email_l.split("@")[0])[:80],
                email=email_l,
                role=role,
                clinic_id=clinic_id,
            )
        )

    # Auth directory (demo + registered).
    for email, entry in (container.auth.users or {}).items():
        role = getattr(entry, "role", "") or ""
        if role not in {"owner", "vet", "clinic_owner"}:
            continue
        _add(email, role, getattr(entry, "clinic_id", None), None)

    # Workflow managed users (display_name).
    store = container.workflow_store
    if hasattr(store, "list_users"):
        try:
            for user in store.list_users():  # type: ignore[attr-defined]
                role = getattr(user, "role", "") or ""
                if role not in {"owner", "vet", "clinic_owner"}:
                    continue
                if not getattr(user, "active", True):
                    continue
                _add(
                    getattr(user, "email", ""),
                    role,
                    getattr(user, "clinic_id", None),
                    getattr(user, "display_name", None),
                )
        except Exception:
            pass

    # Prefer role=owner first.
    hits.sort(key=lambda h: (0 if h.role == "owner" else 1, h.email))
    return OwnerSearchResponse(items=hits[:25])
