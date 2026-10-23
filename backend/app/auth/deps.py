"""FastAPI auth + RBAC dependencies. No-op when auth is disabled."""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.api.deps import get_container
from app.auth.principal import AuthPrincipal
from app.auth.security import decode_token, resolve_jwt_identity, verify_api_key
from app.container import AppContainer
from app.security.audit import AuditLogger, AuditOutcome

_bearer = HTTPBearer(auto_error=False)

# Re-export for existing imports
__all__ = ["AuthPrincipal", "require_auth", "require_capability", "require_roles"]


def require_auth(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    container: AppContainer = Depends(get_container),
) -> AuthPrincipal:
    auth = container.auth
    audit: AuditLogger | None = getattr(container, "audit", None)
    if not auth.enabled:
        # Demo-only principal when auth is off — never minted as a signed JWT.
        return AuthPrincipal(subject="anonymous", role="demo", via="disabled", clinic_id=None)

    api_key = request.headers.get("X-API-Key")
    if verify_api_key(api_key, auth.api_key):
        # service role only via API key — not via JWT role claim.
        return AuthPrincipal(subject="api-key", role="service", via="api_key", clinic_id=None)

    if credentials is None or credentials.scheme.lower() != "bearer":
        if audit is not None:
            audit.record(
                event_type="auth.failure",
                actor="anonymous",
                resource=str(request.url.path),
                outcome=AuditOutcome.DENIED,
                detail="missing_credentials",
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Use Bearer JWT or X-API-Key.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = decode_token(credentials.credentials, auth.jwt_secret)
        subject, role, clinic_id = resolve_jwt_identity(payload, auth.users)
    except ValueError as exc:
        if audit is not None:
            audit.record(
                event_type="auth.failure",
                actor="anonymous",
                resource=str(request.url.path),
                outcome=AuditOutcome.DENIED,
                detail="invalid_token",
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired credentials.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    return AuthPrincipal(
        subject=subject,
        role=role,
        via="jwt",
        clinic_id=clinic_id,
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
