import math
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_container
from app.auth.deps import AuthPrincipal, require_auth
from app.auth.mailer import OutgoingMail
from app.auth.password_reset import PasswordResetError
from app.auth.passwords import password_policy_error
from app.auth.refresh_tokens import RefreshTokenError
from app.auth.security import DEMO_USERS, DemoUserRecord, create_access_token, verify_password
from app.container import AppContainer
from app.security.audit import AuditOutcome
from app.security.rate_limit import (
    FORGOT_PER_EMAIL,
    FORGOT_PER_IP,
    LOGIN_PER_EMAIL,
    LOGIN_PER_IP,
    PASSWORD_CHANGE_PER_USER,
    REGISTER_PER_IP,
    RESET_PER_IP,
    Limit,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=1, max_length=120)


class TokenResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    access_token: str
    token_type: str = "bearer"
    # Seconds until ``access_token`` expires.
    expires_in: int
    # Opaque, single-use token for POST /auth/refresh. Rotates on every refresh.
    refresh_token: str
    refresh_expires_in: int
    role: str
    email: str
    clinic_id: str | None = None
    auth_enabled: bool
    deployment_mode: str = "demo"
    tenant_isolation: bool = False
    note: str = "Demo JWT. Not a production IdP."


class RefreshRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refresh_token: str = Field(min_length=1, max_length=200)


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=120)
    # Length/strength is checked by the password policy so the error message is specific.
    password: str = Field(min_length=1, max_length=200)
    role: Literal["owner", "vet"] = "owner"
    display_name: str | None = Field(default=None, max_length=80)


class RegisterResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str
    role: str
    # active: signed in (``session`` set). pending_approval: an admin must activate the account.
    status: Literal["active", "pending_approval"]
    session: TokenResponse | None = None


class PasswordChangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=1, max_length=200)


class PasswordForgotRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=120)


class PasswordResetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=1, max_length=200)


class MeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject: str
    role: str
    via: str
    clinic_id: str | None = None
    auth_enabled: bool
    deployment_mode: str = "demo"
    tenant_isolation: bool = False


def _client_ip(request: Request, container: AppContainer) -> str:
    if container.settings.trust_proxy_headers:
        first_hop = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if first_hop:
            return first_hop
    return request.client.host if request.client else "unknown"


def _enforce_limits(
    container: AppContainer,
    request: Request,
    actor: str,
    checks: list[tuple[str, str, Limit]],
) -> None:
    """Raise 429 (with Retry-After) if any (scope, key, limit) is already used up."""
    for scope, key, limit in checks:
        wait = container.rate_limiter.retry_after(scope, key, limit)
        if wait is None:
            continue
        container.audit.record(
            event_type="auth.rate_limited",
            actor=actor or "anonymous",
            resource=str(request.url.path),
            outcome=AuditOutcome.DENIED,
            detail=scope,
        )
        minutes = max(1, math.ceil(wait / 60))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many attempts. Try again in {minutes} min.",
            headers={"Retry-After": str(wait)},
        )


def _hit(container: AppContainer, checks: list[tuple[str, str, Limit]]) -> None:
    for scope, key, limit in checks:
        container.rate_limiter.hit(scope, key, limit)


@router.get("/status")
def auth_status(container: AppContainer = Depends(get_container)) -> dict[str, object]:
    return {
        "auth_enabled": container.auth.enabled,
        "deployment_mode": container.auth.deployment_mode,
        "tenant_isolation": container.auth.tenant_isolation,
        "methods": ["bearer_jwt", "x_api_key"] if container.auth.enabled else [],
        "encryption_at_rest": container.encryption.mode,
        "malware_scan_required": container.settings.malware_scan_required,
        "note": (
            "Demo mode: auth disabled by default (VETMIND_AUTH_ENABLED=0). "
            "Protected mode: VETMIND_DEPLOYMENT_MODE=protected requires auth + non-default JWT secret."
        ),
    }


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    request: Request,
    container: AppContainer = Depends(get_container),
) -> TokenResponse:
    users = container.auth.users or DEMO_USERS
    email = payload.email.strip().lower()
    limits = [
        ("login_email", email, LOGIN_PER_EMAIL),
        ("login_ip", _client_ip(request, container), LOGIN_PER_IP),
    ]
    _enforce_limits(container, request, email, limits)
    entry = users.get(email)
    if entry is None or not verify_password(payload.password, entry.password):
        _hit(container, limits)
        container.audit.record(
            event_type="auth.login",
            actor=email,
            resource="/api/v1/auth/login",
            outcome=AuditOutcome.DENIED,
            detail="invalid_credentials",
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")
    container.audit.record(
        event_type="auth.login",
        actor=email,
        resource="/api/v1/auth/login",
        outcome=AuditOutcome.SUCCESS,
        clinic_id=entry.clinic_id,
    )
    container.rate_limiter.reset("login_email", email)
    return _issue_token(container, email=email, entry=entry)


def _issue_token(
    container: AppContainer,
    *,
    email: str,
    entry: DemoUserRecord,
    refresh_token: str | None = None,
) -> TokenResponse:
    """Mint an access JWT. Starts a new refresh family unless ``refresh_token`` is given."""
    token = create_access_token(
        subject=email,
        role=entry.role,
        secret=container.auth.jwt_secret,
        ttl_seconds=container.auth.jwt_ttl_seconds,
        clinic_id=entry.clinic_id,
        token_version=entry.token_version,
    )
    if refresh_token is None:
        refresh_token = container.refresh_tokens.issue(email, token_version=entry.token_version)
    return TokenResponse(
        access_token=token,
        expires_in=container.auth.jwt_ttl_seconds,
        refresh_token=refresh_token,
        refresh_expires_in=container.refresh_tokens.ttl_seconds,
        role=entry.role,
        email=email,
        clinic_id=entry.clinic_id,
        auth_enabled=container.auth.enabled,
        deployment_mode=container.auth.deployment_mode,
        tenant_isolation=container.auth.tenant_isolation,
    )


_SESSION_EXPIRED = "Session expired. Please sign in again."


@router.post("/refresh", response_model=TokenResponse)
def refresh(payload: RefreshRequest, container: AppContainer = Depends(get_container)) -> TokenResponse:
    """Swap a refresh token for a new access token + a new (rotated) refresh token."""
    try:
        subject, entry, new_refresh = container.refresh_tokens.rotate(payload.refresh_token)
    except RefreshTokenError as exc:
        container.audit.record(
            event_type="auth.refresh",
            actor="anonymous",
            resource="/api/v1/auth/refresh",
            # Reuse of a rotated token is the interesting signal for theft.
            outcome=AuditOutcome.DENIED,
            detail=exc.reason,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_SESSION_EXPIRED) from exc
    container.audit.record(
        event_type="auth.refresh",
        actor=subject,
        resource="/api/v1/auth/refresh",
        outcome=AuditOutcome.SUCCESS,
        clinic_id=entry.clinic_id,
    )
    return _issue_token(container, email=subject, entry=entry, refresh_token=new_refresh)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(payload: RefreshRequest, container: AppContainer = Depends(get_container)) -> Response:
    """Revoke this sign-in's refresh tokens. Idempotent; always 204 so it leaks nothing.

    The current access token stays valid until it expires (``expires_in``, 15 min by default).
    """
    subject = container.refresh_tokens.revoke(payload.refresh_token)
    container.audit.record(
        event_type="auth.logout",
        actor=subject or "anonymous",
        resource="/api/v1/auth/logout",
        outcome=AuditOutcome.SUCCESS if subject else AuditOutcome.INFO,
        detail=None if subject else "unknown_refresh_token",
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    request: Request,
    container: AppContainer = Depends(get_container),
) -> RegisterResponse:
    """Self-service sign-up. Owners get a session at once; vets wait for admin activation."""
    email = payload.email.strip().lower()
    limits = [("register_ip", _client_ip(request, container), REGISTER_PER_IP)]
    _enforce_limits(container, request, email, limits)
    _hit(container, limits)

    def _audit(outcome: AuditOutcome, detail: str, clinic_id: str | None = None) -> None:
        container.audit.record(
            event_type="auth.register",
            actor=email,
            resource="/api/v1/auth/register",
            outcome=outcome,
            detail=detail,
            clinic_id=clinic_id,
        )

    if not container.settings.self_registration_enabled:
        _audit(AuditOutcome.DENIED, "self_registration_disabled")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Self-registration is disabled.")
    try:
        user = container.workflow.register_user(
            email=email,
            password=payload.password,
            role=payload.role,
            display_name=payload.display_name,
            owner_clinic_id=container.settings.self_registration_owner_clinic_id,
        )
    except HTTPException as exc:
        _audit(AuditOutcome.DENIED, f"rejected_{exc.status_code}")
        raise
    if not user.active:
        _audit(AuditOutcome.SUCCESS, "pending_approval")
        return RegisterResponse(email=user.email, role=user.role, status="pending_approval")
    _audit(AuditOutcome.SUCCESS, "active", clinic_id=user.clinic_id)
    entry = DemoUserRecord(user.password_hash or "", user.role, user.clinic_id, user.token_version)
    session = _issue_token(container, email=user.email, entry=entry)
    return RegisterResponse(email=user.email, role=user.role, status="active", session=session)


@router.get("/me", response_model=MeResponse)
def me(
    principal: AuthPrincipal = Depends(require_auth),
    container: AppContainer = Depends(get_container),
) -> MeResponse:
    return MeResponse(
        subject=principal.subject,
        role=principal.role,
        via=principal.via,
        clinic_id=principal.clinic_id,
        auth_enabled=container.auth.enabled,
        deployment_mode=container.auth.deployment_mode,
        tenant_isolation=container.auth.tenant_isolation,
    )


# --- password change / forgot / reset (issue #31 step 4) ---------------------

_RESET_LINK_INVALID = "This reset link is invalid or has expired. Request a new one."
_FORGOT_ACCEPTED = "If an account exists for this email, we've sent a link to reset the password."


@router.post("/password/change", response_model=TokenResponse)
def change_password(
    payload: PasswordChangeRequest,
    request: Request,
    principal: AuthPrincipal = Depends(require_auth),
    container: AppContainer = Depends(get_container),
) -> TokenResponse:
    """Change your own password. Other sessions end; this one gets a fresh token pair."""
    if principal.via != "jwt":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sign in with a user account first.")
    email = principal.subject
    limits = [("password_change_user", email, PASSWORD_CHANGE_PER_USER)]
    _enforce_limits(container, request, email, limits)
    entry = container.auth.users.get(email) if container.auth.users else None
    if entry is None or not verify_password(payload.current_password, entry.password):
        _hit(container, limits)
        container.audit.record(
            event_type="auth.password_change",
            actor=email,
            resource="/api/v1/auth/password/change",
            outcome=AuditOutcome.DENIED,
            detail="wrong_current_password",
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect.")
    user = container.workflow.set_password(email, payload.new_password)
    container.refresh_tokens.revoke_all_for(email)
    container.audit.record(
        event_type="auth.password_change",
        actor=email,
        resource="/api/v1/auth/password/change",
        outcome=AuditOutcome.SUCCESS,
        clinic_id=user.clinic_id,
    )
    return _issue_token(container, email=email, entry=container.auth.users[email])


@router.post("/password/forgot", status_code=status.HTTP_202_ACCEPTED)
def forgot_password(
    payload: PasswordForgotRequest,
    request: Request,
    background: BackgroundTasks,
    container: AppContainer = Depends(get_container),
) -> dict[str, str]:
    """Email a single-use reset link. Same answer, and same work before answering, whether
    or not the account exists: the lookup and the (possibly slow) email run after the
    response is sent, so response time does not reveal registered addresses."""
    email = payload.email.strip().lower()
    # Applied to every address alike, so a 429 says nothing about whether it is registered.
    limits = [
        ("forgot_email", email, FORGOT_PER_EMAIL),
        ("forgot_ip", _client_ip(request, container), FORGOT_PER_IP),
    ]
    _enforce_limits(container, request, email, limits)
    _hit(container, limits)
    background.add_task(_send_reset_link, container, email)
    return {"detail": _FORGOT_ACCEPTED}


def _send_reset_link(container: AppContainer, email: str) -> None:
    entry = container.auth.users.get(email) if container.auth.users else None
    if entry is not None:
        raw = container.password_resets.issue(email)
        link = f"{container.settings.public_base_url}/sifre-sifirla?token={raw}"
        minutes = container.password_resets.ttl_seconds // 60
        container.mailer.send(
            OutgoingMail(
                to=email,
                subject="VetMind şifre sıfırlama / password reset",
                body=(
                    "Merhaba,\n\n"
                    f"VetMind şifrenizi sıfırlamak için bu bağlantıyı {minutes} dakika içinde açın:\n"
                    f"{link}\n\n"
                    "Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz; şifreniz değişmez.\n\n"
                    f"To reset your VetMind password, open the link above within {minutes} minutes. "
                    "If you didn't ask for this, ignore this email.\n"
                ),
            )
        )
    container.audit.record(
        event_type="auth.password_forgot",
        actor=email,
        resource="/api/v1/auth/password/forgot",
        outcome=AuditOutcome.INFO,
        detail="link_sent" if entry is not None else "no_active_account",
    )


@router.post("/password/reset", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(
    payload: PasswordResetRequest,
    request: Request,
    container: AppContainer = Depends(get_container),
) -> Response:
    """Set a new password with an emailed token. Ends every existing session."""
    limits = [("reset_ip", _client_ip(request, container), RESET_PER_IP)]
    _enforce_limits(container, request, "anonymous", limits)
    weak = password_policy_error(payload.new_password)
    if weak:
        # Checked before the token is consumed, so a weak attempt does not burn the link.
        raise HTTPException(status_code=422, detail=weak)
    try:
        email = container.password_resets.consume(payload.token)
        user = container.workflow.set_password(email, payload.new_password)
    except (PasswordResetError, HTTPException) as exc:
        reason = exc.reason if isinstance(exc, PasswordResetError) else "user_inactive"
        _hit(container, limits)
        container.audit.record(
            event_type="auth.password_reset",
            actor="anonymous",
            resource="/api/v1/auth/password/reset",
            outcome=AuditOutcome.DENIED,
            detail=reason,
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_RESET_LINK_INVALID) from exc
    container.refresh_tokens.revoke_all_for(email)
    container.audit.record(
        event_type="auth.password_reset",
        actor=email,
        resource="/api/v1/auth/password/reset",
        outcome=AuditOutcome.SUCCESS,
        clinic_id=user.clinic_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
