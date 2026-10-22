"""Auth principal type (no FastAPI imports — safe for services)."""

from __future__ import annotations

from dataclasses import dataclass

from app.auth.rbac import role_has_capability


@dataclass(frozen=True)
class AuthPrincipal:
    subject: str
    role: str
    via: str  # "jwt" | "api_key" | "disabled"
    clinic_id: str | None = None

    def can(self, capability: str) -> bool:
        return role_has_capability(self.role, capability)
