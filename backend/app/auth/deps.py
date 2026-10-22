"""FastAPI auth + RBAC dependencies. No-op when auth is disabled."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.api.deps import get_container
from app.auth.rbac import role_has_capability
from app.auth.security import decode_token, verify_api_key
from app.container import AppContainer

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthPrincipal:
    subject: str
    role: str
    via: str  # "jwt" | "api_key" | "disabled"

    def can(self, capability: str) -> bool:
        return role_has_capability(self.role, capability)


def require_auth(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    container: AppContainer = Depends(get_container),
) -> AuthPrincipal:
    auth = container.auth
    if not auth.enabled:
        return AuthPrincipal(subject="anonymous", role="demo", via="disabled")

    api_key = request.headers.get("X-API-Key")
    if verify_api_key(api_key, auth.api_key):
        return AuthPrincipal(subject="api-key", role="service", via="api_key")

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Use Bearer JWT or X-API-Key.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = decode_token(credentials.credentials, auth.jwt_secret)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    return AuthPrincipal(
        subject=str(payload.get("sub", "unknown")),
        role=str(payload.get("role", "vet")),
        via="jwt",
    )


def require_capability(capability: str):
    """Dependency factory: 403 unless principal has the capability (or auth disabled)."""

    def _dep(principal: AuthPrincipal = Depends(require_auth)) -> AuthPrincipal:
        if principal.via == "disabled":
            return principal
        if not principal.can(capability):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{principal.role}' lacks capability '{capability}'.",
            )
        return principal

    return _dep


def require_roles(*roles: str):
    """Dependency factory: 403 unless principal.role is in roles (admin/service always ok)."""

    allowed = set(roles)

    def _dep(principal: AuthPrincipal = Depends(require_auth)) -> AuthPrincipal:
        if principal.via == "disabled":
            return principal
        if principal.role in {"admin", "service"} or principal.role in allowed:
            return principal
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Role '{principal.role}' not in allowed roles: {sorted(allowed)}.",
        )

    return _dep
