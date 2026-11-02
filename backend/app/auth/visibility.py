"""Response-side visibility of radiologist-only case fields.

Services always work on the full record; filtering happens only on what is returned
to the caller. (Filtering inside CaseService.get_case made services save the stripped
copy back, which deleted internal notes whenever a vet added a clinical note.)
"""

from __future__ import annotations

from app.auth.principal import AuthPrincipal
from app.schemas.case import CaseRecord

# Roles that may see radiologist working material (internal notes, AI chat).
RADIOLOGIST_VIEW_ROLES = frozenset({"expert", "admin", "demo", "service"})


def can_see_radiologist_fields(principal: AuthPrincipal | None) -> bool:
    if principal is None or principal.via != "jwt":
        return True  # auth disabled / API key: trusted demo or service caller
    return principal.role in RADIOLOGIST_VIEW_ROLES


def case_for_principal(case: CaseRecord, principal: AuthPrincipal | None) -> CaseRecord:
    """Copy of ``case`` with internal notes and the AI chat removed for vets/owners."""
    if can_see_radiologist_fields(principal):
        return case
    return case.model_copy(update={"internal_notes": [], "ai_chat": []})
