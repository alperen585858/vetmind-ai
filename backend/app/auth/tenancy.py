"""Clinic / owner isolation helpers.

Demo mode (auth disabled): no isolation — all principals see all records.
Protected mode (auth enabled + tenant_isolation): default-deny when ownership
cannot be established. Legacy rows with null clinic_id and owner_subject are
visible only to admin/service (not reassigned to arbitrary clinics).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from fastapi import HTTPException, status

from app.auth.principal import AuthPrincipal


class OwnedResource(Protocol):
    clinic_id: str | None
    owner_subject: str | None


@dataclass(frozen=True)
class TenancyConfig:
    """Runtime tenancy policy derived from settings."""

    isolation_enabled: bool

    @property
    def active(self) -> bool:
        return self.isolation_enabled


def principal_is_global(principal: AuthPrincipal) -> bool:
    """Bypass clinic filters only for trusted auth channels / admin JWT.

    ``role=demo`` is never global via JWT (Phase 8). It only appears when
    ``via=disabled`` (auth off). ``service`` is only via API key.
    """
    if principal.via == "disabled":
        return True
    if principal.via == "api_key":
        return True
    if principal.via == "jwt" and principal.role == "admin":
        return True
    return False


def can_access_owned(principal: AuthPrincipal, resource: OwnedResource, *, isolation: bool) -> bool:
    if not isolation or principal_is_global(principal):
        return True
    clinic = resource.clinic_id
    owner = resource.owner_subject
    if clinic is None and owner is None:
        # Legacy / unscoped — default deny under isolation.
        return False
    if clinic is not None and principal.clinic_id is not None and clinic == principal.clinic_id:
        return True
    if owner is not None and owner == principal.subject:
        return True
    return False


def assert_case_access(principal: AuthPrincipal, resource: OwnedResource, *, isolation: bool) -> None:
    if can_access_owned(principal, resource, isolation=isolation):
        return
    # 404 (not 403) to avoid confirming existence across tenants.
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found.")


def bind_reviewer_id(principal: AuthPrincipal, client_reviewer_id: str) -> str:
    """Prefer JWT subject when auth is enforced; keep client id in demo mode."""
    if principal.via == "disabled":
        return client_reviewer_id
    if principal.via == "api_key":
        return client_reviewer_id or "api-key"
    return principal.subject
