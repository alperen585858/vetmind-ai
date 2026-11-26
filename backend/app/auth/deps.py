"""FastAPI auth + RBAC dependencies. No-op when auth is disabled."""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.api.deps import get_container
from app.auth.principal import AuthPrincipal
from app.auth.security import decode_token, resolve_jwt_identity, verify_api_key
from app.container import AppContainer
from app.http_errors import api_error
from app.security.audit import AuditLogger, AuditOutcome

_bearer = HTTPBearer(auto_error=False)

# Re-export for existing imports
__all__ = ["AuthPrincipal", "require_actor", "require_auth", "require_capability", "require_roles"]


# Roles the demo UI can switch between (issue #104).
DEMO_SWITCHABLE_ROLES = frozenset({"vet", "expert", "clinic_owner", "admin"})


def _demo_session_principal(request: Request, container: AppContainer) -> AuthPrincipal | None:
    """Auth off + deployment_mode=demo: act as the role picked in the UI ("Rol değiştir").

    The frontend sends ``X-VetMind-Demo-Role`` / ``X-VetMind-Demo-Subject``. The role's real
    capabilities apply, so a vet still cannot do admin work. Protected mode never reaches
    here (auth is always on there) and the headers are ignored.
    """
    if getattr(container.settings, "deployment_mode", "demo") != "demo":
        return None
    role = (request.headers.get("X-VetMind-Demo-Role") or "").strip().lower()
    if role not in DEMO_SWITCHABLE_ROLES:
        return None
    subject = (request.headers.get("X-VetMind-Demo-Subject") or "").strip().lower()
    if not subject:
        subject = "clinic-owner@demo.local" if role == "clinic_owner" else f"{role}@demo.local"
    entry = (container.auth.users or {}).get(subject)
    clinic_id = getattr(entry, "clinic_id", None) if entry is not None else None
    return AuthPrincipal(subject=subject, role=role, via="disabled", clinic_id=clinic_id)


# Issue #107: what a "set up 2FA first" session may call.
MFA_SETUP_ALLOWED_PREFIXES = (
    "/api/v1/auth/mfa/",
    "/api/v1/auth/me",
    "/api/v1/auth/logout",
    "/api/v1/auth/status",
    "/api/v1/auth/refresh",
    # Own UI preferences (language, display name): the Settings page loads them first.
    "/api/v1/settings/me",
)


def require_auth(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    container: AppContainer = Depends(get_container),
) -> AuthPrincipal:
    auth = container.auth
    audit: AuditLogger | None = getattr(container, "audit", None)
    if not auth.enabled:
        # Demo-only principal when auth is off — never minted as a signed JWT.
        # Full "*" admin only with VETMIND_ALLOW_INSECURE_DEMO=1 (uses service role).
        insecure = bool(getattr(container.settings, "allow_insecure_demo", False))
        if insecure:
            return AuthPrincipal(subject="anonymous", role="service", via="disabled", clinic_id=None)
        demo = _demo_session_principal(request, container)
        if demo is not None:
            return demo
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
    if payload.get("mfa_setup") and not request.url.path.startswith(MFA_SETUP_ALLOWED_PREFIXES):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=api_error(
                "mfa_setup_required",
                "Your role requires two-step sign-in. Set it up in Settings to continue.",
            ),
        )
    return AuthPrincipal(
        subject=subject,
        role=role,
        via="jwt",
        clinic_id=clinic_id,
    )


def require_capability(capability: str):
    """Dependency factory: 403 unless principal has the capability (or auth disabled)."""

    def _dep(principal: AuthPrincipal = Depends(require_auth)) -> AuthPrincipal:
        # Even auth-off demo principals must pass capability checks (limited demo set).
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
        if principal.role in {"admin", "service"} or principal.role in allowed:
            return principal
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Role '{principal.role}' not in allowed roles: {sorted(allowed)}.",
        )

    return _dep


def require_actor(request: Request, principal: AuthPrincipal = Depends(require_auth)) -> AuthPrincipal:
    """Principal whose ``subject`` names the person, for per-user data (notifications).

    With auth off every request is ``anonymous``; the frontend sends the demo session's
    email in ``X-VetMind-Demo-Subject``, so use it as the subject. Role and permissions
    are unchanged. With auth on the header is ignored and the JWT subject is used.
    """
    if principal.via != "disabled":
        return principal
    subject = (request.headers.get("X-VetMind-Demo-Subject") or "").strip().lower()
    if not subject:
        return principal
    return AuthPrincipal(subject=subject, role=principal.role, via=principal.via, clinic_id=principal.clinic_id)
