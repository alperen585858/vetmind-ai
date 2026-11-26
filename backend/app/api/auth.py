import math
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_container
from app.auth.deps import AuthPrincipal, require_auth
from app.auth.email_verification import EmailVerificationError
from app.auth.mailer import OutgoingMail
from app.auth.mfa_challenge import MfaChallengeError
from app.auth.password_reset import PasswordResetError
from app.auth.passwords import password_policy_detail
from app.auth.refresh_tokens import RefreshTokenError
from app.auth.security import DEMO_USERS, DemoUserRecord, create_access_token, verify_password
from app.container import AppContainer
from app.http_errors import api_error
from app.security.audit import AuditOutcome
from app.security.rate_limit import (
    FORGOT_PER_EMAIL,
    FORGOT_PER_IP,
    LOGIN_PER_EMAIL,
    LOGIN_PER_IP,
    MFA_CODE_PER_IP,
    MFA_CODE_PER_USER,
    PASSWORD_CHANGE_PER_USER,
    REGISTER_PER_IP,
    RESET_PER_IP,
    VERIFY_PER_IP,
    VERIFY_RESEND_PER_EMAIL,
    VERIFY_RESEND_PER_IP,
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
    # Issue #107: the role requires 2FA and it is not set up; this session may only set it up.
    mfa_setup_required: bool = False
    note: str = "Demo JWT. Not a production IdP."


class MfaChallengeResponse(BaseModel):
    """Password was right; the account has 2FA on, so a code is needed (POST /auth/mfa/verify)."""

    model_config = ConfigDict(extra="forbid")

    mfa_required: bool = True
    mfa_token: str
    expires_in: int
    email: str


class MfaVerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mfa_token: str = Field(min_length=10, max_length=600)
    # 6-digit authenticator code or a backup code (xxxxx-xxxxx).
    code: str = Field(min_length=6, max_length=20)


class RefreshRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refresh_token: str = Field(min_length=1, max_length=200)


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=120)
    # Length/strength is checked by the password policy so the error message is specific.
    password: str = Field(min_length=1, max_length=200)
    # B2B only: pet owners are not platform users. Vets wait for admin activation.
    role: Literal["vet"] = "vet"
    display_name: str | None = Field(default=None, max_length=80)


class RegisterResponse(BaseModel):
    """Identical for a new and an already registered address (issue #41), so the endpoint
    does not reveal which emails have accounts. The account is created after the response."""

    model_config = ConfigDict(extra="forbid")

    email: str
    status: Literal["verification_sent"] = "verification_sent"
    detail: str


class VerifyEmailRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=1, max_length=200)


class VerifyEmailResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str
    status: Literal["verified"] = "verified"
    # Self-registered vets still need an admin to activate them before they can sign in.
    pending_approval: bool


class VerifyEmailResendRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=120)


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
            detail=api_error(
                "rate_limited",
                f"Too many attempts. Try again in {minutes} min.",
                minutes=minutes,
            ),
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


@router.post("/login", response_model=TokenResponse | MfaChallengeResponse)
def login(
    payload: LoginRequest,
    request: Request,
    container: AppContainer = Depends(get_container),
) -> TokenResponse | MfaChallengeResponse:
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
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=api_error("invalid_credentials", "Invalid email or password."),
        )
    container.audit.record(
        event_type="auth.login",
        actor=email,
        resource="/api/v1/auth/login",
        outcome=AuditOutcome.SUCCESS,
        clinic_id=entry.clinic_id,
    )
    container.rate_limiter.reset("login_email", email)
    container.workflow.record_login(email, payload.password)
    entry = container.auth.users.get(email, entry)
    if container.mfa.is_enabled(email):
        # Issue #107: no tokens yet; the code step finishes the sign-in.
        container.audit.record(
            event_type="auth.mfa_challenge",
            actor=email,
            resource="/api/v1/auth/login",
            outcome=AuditOutcome.INFO,
            detail="code_requested",
        )
        return MfaChallengeResponse(
            mfa_token=container.mfa_challenges.issue(email, entry.token_version),
            expires_in=container.mfa_challenges.ttl_seconds,
            email=email,
        )
    return _issue_token(container, email=email, entry=entry)


def _issue_token(
    container: AppContainer,
    *,
    email: str,
    entry: DemoUserRecord,
    refresh_token: str | None = None,
) -> TokenResponse:
    """Mint an access JWT. Starts a new refresh family unless ``refresh_token`` is given."""
    setup_only = container.mfa.required_for(email, entry.role) and not container.mfa.is_enabled(email)
    token = create_access_token(
        subject=email,
        role=entry.role,
        secret=container.auth.jwt_secret,
        ttl_seconds=container.auth.jwt_ttl_seconds,
        clinic_id=entry.clinic_id,
        token_version=entry.token_version,
        mfa_setup_only=setup_only,
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
        mfa_setup_required=setup_only,
    )


_SESSION_EXPIRED = api_error("session_expired", "Session expired. Please sign in again.")


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


_REGISTER_ACCEPTED = (
    "Check your inbox: we've sent a link to verify your email. "
    "After that, an administrator activates your account."
)


@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_202_ACCEPTED)
def register(
    payload: RegisterRequest,
    request: Request,
    background: BackgroundTasks,
    container: AppContainer = Depends(get_container),
) -> RegisterResponse:
    """Self-service sign-up for veterinarians.

    Issue #41: the answer is the same whether or not the address is registered. Checks that
    do not depend on the address (format, password policy) run first; the lookup, account
    creation and email run after the response, so its timing does not leak either.
    """
    email = payload.email.strip().lower()
    limits = [("register_ip", _client_ip(request, container), REGISTER_PER_IP)]
    _enforce_limits(container, request, email, limits)
    _hit(container, limits)

    if not container.settings.self_registration_enabled:
        _audit_register(container, email, AuditOutcome.DENIED, "self_registration_disabled")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=api_error("self_registration_disabled", "Self-registration is disabled."),
        )
    try:
        email = container.workflow.validate_registration(
            email=email, password=payload.password, role=payload.role
        )
    except HTTPException as exc:
        _audit_register(container, email, AuditOutcome.DENIED, f"rejected_{exc.status_code}")
        raise
    background.add_task(
        _complete_registration, container, email, payload.password, payload.role, payload.display_name
    )
    return RegisterResponse(email=email, detail=_REGISTER_ACCEPTED)


def _audit_register(
    container: AppContainer, email: str, outcome: AuditOutcome, detail: str, clinic_id: str | None = None
) -> None:
    container.audit.record(
        event_type="auth.register",
        actor=email,
        resource="/api/v1/auth/register",
        outcome=outcome,
        detail=detail,
        clinic_id=clinic_id,
    )


def _complete_registration(
    container: AppContainer, email: str, password: str, role: str, display_name: str | None
) -> None:
    try:
        user = container.workflow.register_user(
            email=email,
            password=password,
            role=role,  # type: ignore[arg-type]
            display_name=display_name,
            owner_clinic_id=container.settings.self_registration_owner_clinic_id,
        )
    except HTTPException as exc:
        if exc.status_code != status.HTTP_409_CONFLICT:
            _audit_register(container, email, AuditOutcome.DENIED, f"rejected_{exc.status_code}")
            return
        # Already registered: tell the owner of the address. Password and sessions stay as they are.
        _send_account_exists(container, email)
        _audit_register(container, email, AuditOutcome.DENIED, "duplicate_email")
        return
    sent = _send_verification_link(container, user.email)
    _audit_register(container, email, AuditOutcome.SUCCESS, "verification_sent" if sent else "smtp_required")


def _mail_unavailable(container: AppContainer) -> bool:
    """Protected mode without SMTP: a live link could not be delivered safely, so none is made."""
    return not container.settings.smtp_host and container.settings.deployment_mode == "protected"


def _send_verification_link(container: AppContainer, email: str) -> bool:
    if _mail_unavailable(container):
        return False
    raw = container.email_verifications.issue(email)
    link = f"{container.settings.public_base_url}/eposta-dogrula?token={raw}"
    hours = max(1, container.email_verifications.ttl_seconds // 3600)
    container.mailer.send(
        OutgoingMail(
            to=email,
            subject="VetMind e-posta doğrulama / verify your email",
            body=(
                "Merhaba,\n\n"
                f"VetMind hesabınızı tamamlamak için e-posta adresinizi {hours} saat içinde doğrulayın:\n"
                f"{link}\n\n"
                "Doğrulamadan sonra bir yönetici hesabınızı etkinleştirecek.\n"
                "Bu kaydı siz yapmadıysanız bu e-postayı yok sayabilirsiniz.\n\n"
                f"Open the link above within {hours} hours to verify your VetMind email. "
                "An administrator activates your account afterwards. "
                "If you didn't sign up, ignore this email.\n"
            ),
        )
    )
    return True


def _send_account_exists(container: AppContainer, email: str) -> None:
    base = container.settings.public_base_url
    container.mailer.send(
        OutgoingMail(
            to=email,
            subject="VetMind: bu e-postayla zaten bir hesabınız var / you already have an account",
            body=(
                "Merhaba,\n\n"
                "Bu e-posta adresiyle yeni bir VetMind kaydı denendi, ama zaten bir hesabınız var. "
                "Şifreniz değişmedi.\n"
                f"Giriş yapın: {base}/giris\n"
                f"Şifrenizi unuttuysanız: {base}/sifremi-unuttum\n\n"
                "Bu denemeyi siz yapmadıysanız bu e-postayı yok sayabilirsiniz.\n\n"
                "Someone tried to sign up for VetMind with this address, but you already have an account. "
                "Your password has not changed. Sign in or reset your password with the links above.\n"
            ),
        )
    )


# --- email verification (issue #41) -------------------------------------------

_VERIFY_LINK_INVALID = api_error(
    "verify_link_invalid",
    "This verification link is invalid or has expired. Request a new one.",
)
_RESEND_ACCEPTED = "If this email has an unverified account, we've sent a new verification link."


@router.post("/verify-email", response_model=VerifyEmailResponse)
def verify_email(
    payload: VerifyEmailRequest,
    request: Request,
    container: AppContainer = Depends(get_container),
) -> VerifyEmailResponse:
    """Mark the address verified with the emailed single-use token."""
    limits = [("verify_ip", _client_ip(request, container), VERIFY_PER_IP)]
    _enforce_limits(container, request, "anonymous", limits)
    user = None
    reason = "user_missing"
    try:
        email = container.email_verifications.consume(payload.token)
        user = container.workflow.mark_email_verified(email)
    except EmailVerificationError as exc:
        reason = exc.reason
    if user is None:
        _hit(container, limits)
        container.audit.record(
            event_type="auth.verify_email",
            actor="anonymous",
            resource="/api/v1/auth/verify-email",
            outcome=AuditOutcome.DENIED,
            detail=reason,
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_VERIFY_LINK_INVALID)
    container.audit.record(
        event_type="auth.verify_email",
        actor=user.email,
        resource="/api/v1/auth/verify-email",
        outcome=AuditOutcome.SUCCESS,
        clinic_id=user.clinic_id,
    )
    return VerifyEmailResponse(email=user.email, pending_approval=not user.active)


@router.post("/verify-email/resend", status_code=status.HTTP_202_ACCEPTED)
def resend_verification(
    payload: VerifyEmailResendRequest,
    request: Request,
    background: BackgroundTasks,
    container: AppContainer = Depends(get_container),
) -> dict[str, str]:
    """Send a fresh verification link. Unverified vets cannot sign in yet (they wait for an
    admin), so this takes the email. Same answer and same work for every address."""
    email = payload.email.strip().lower()
    limits = [
        ("verify_resend_email", email, VERIFY_RESEND_PER_EMAIL),
        ("verify_resend_ip", _client_ip(request, container), VERIFY_RESEND_PER_IP),
    ]
    _enforce_limits(container, request, email, limits)
    _hit(container, limits)
    background.add_task(_resend_verification_link, container, email)
    return {"detail": _RESEND_ACCEPTED}


def _resend_verification_link(container: AppContainer, email: str) -> None:
    user = container.workflow_store.get_user(email)
    detail = "no_unverified_account"
    if user is not None and not user.email_verified:
        detail = "link_sent" if _send_verification_link(container, email) else "smtp_required"
    container.audit.record(
        event_type="auth.verify_email_resend",
        actor=email,
        resource="/api/v1/auth/verify-email/resend",
        outcome=AuditOutcome.INFO,
        detail=detail,
    )


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

_RESET_LINK_INVALID = api_error(
    "reset_link_invalid",
    "This reset link is invalid or has expired. Request a new one.",
)
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
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=api_error("sign_in_required", "Sign in with a user account first."),
        )
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
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=api_error("wrong_current_password", "Current password is incorrect."),
        )
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
    detail = "no_active_account"
    if entry is not None:
        # Protected / auth-on without SMTP: never mint a live reset token (nothing safe to deliver).
        if not container.settings.smtp_host and container.settings.deployment_mode == "protected":
            detail = "smtp_required"
        else:
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
            detail = "link_sent"
    container.audit.record(
        event_type="auth.password_forgot",
        actor=email,
        resource="/api/v1/auth/password/forgot",
        outcome=AuditOutcome.INFO,
        detail=detail,
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
    weak = password_policy_detail(payload.new_password)
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


# --- two-step sign-in setup (issue #107) -------------------------------------------------


class MfaStatusResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool
    backup_codes_left: int
    required_for_role: bool
    demo_account: bool
    setup_pending: bool
    required_roles: list[str]


class MfaSetupResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Shown once for manual entry; the QR code encodes ``otpauth_uri``.
    secret: str
    otpauth_uri: str


class MfaCodeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=6, max_length=20)


class MfaPasswordCodeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    password: str = Field(min_length=1, max_length=200)
    code: str = Field(min_length=6, max_length=20)


class MfaBackupCodesResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    backup_codes: list[str]
    # Fresh token pair: turning 2FA on/off ends every other session, not this one.
    session: TokenResponse | None = None


def _jwt_user(principal: AuthPrincipal) -> str:
    if principal.via != "jwt":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=api_error("sign_in_required", "Sign in with a user account first."),
        )
    return principal.subject


def _mfa_audit(container: AppContainer, actor: str, event: str, outcome: AuditOutcome, detail: str | None = None) -> None:
    container.audit.record(event_type=event, actor=actor, resource="/api/v1/auth/mfa", outcome=outcome, detail=detail)


def _mfa_code_limits(request: Request, container: AppContainer, email: str) -> list[tuple[str, str, Limit]]:
    return [
        ("mfa_code_user", email, MFA_CODE_PER_USER),
        ("mfa_code_ip", _client_ip(request, container), MFA_CODE_PER_IP),
    ]


def _with_code_limits(request: Request, container: AppContainer, email: str, event: str, action):
    """Run ``action``; a wrong code counts against the limiter and is audited."""
    limits = _mfa_code_limits(request, container, email)
    _enforce_limits(container, request, email, limits)
    try:
        return action()
    except HTTPException as exc:
        if isinstance(exc.detail, dict) and exc.detail.get("code") == "mfa_invalid_code":
            _hit(container, limits)
            _mfa_audit(container, email, event, AuditOutcome.DENIED, "invalid_code")
        raise


def _fresh_session(container: AppContainer, email: str) -> TokenResponse:
    container.refresh_tokens.revoke_all_for(email)
    return _issue_token(container, email=email, entry=container.auth.users[email])


@router.get("/mfa/status", response_model=MfaStatusResponse)
def mfa_status(
    principal: AuthPrincipal = Depends(require_auth),
    container: AppContainer = Depends(get_container),
) -> MfaStatusResponse:
    st = container.mfa.status(principal.subject, principal.role)
    return MfaStatusResponse(**st.__dict__, required_roles=list(container.mfa.required_roles))


@router.post("/mfa/setup", response_model=MfaSetupResponse)
def mfa_setup(
    principal: AuthPrincipal = Depends(require_auth),
    container: AppContainer = Depends(get_container),
) -> MfaSetupResponse:
    email = _jwt_user(principal)
    secret, uri = container.mfa.begin_setup(email)
    _mfa_audit(container, email, "auth.mfa_setup_started", AuditOutcome.INFO)
    return MfaSetupResponse(secret=secret, otpauth_uri=uri)


@router.post("/mfa/enable", response_model=MfaBackupCodesResponse)
def mfa_enable(
    payload: MfaCodeRequest,
    request: Request,
    principal: AuthPrincipal = Depends(require_auth),
    container: AppContainer = Depends(get_container),
) -> MfaBackupCodesResponse:
    email = _jwt_user(principal)
    codes = _with_code_limits(request, container, email, "auth.mfa_enabled", lambda: container.mfa.enable(email, payload.code))
    _mfa_audit(container, email, "auth.mfa_enabled", AuditOutcome.SUCCESS)
    return MfaBackupCodesResponse(backup_codes=codes, session=_fresh_session(container, email))


@router.post("/mfa/disable", response_model=TokenResponse)
def mfa_disable(
    payload: MfaPasswordCodeRequest,
    request: Request,
    principal: AuthPrincipal = Depends(require_auth),
    container: AppContainer = Depends(get_container),
) -> TokenResponse:
    email = _jwt_user(principal)
    entry = container.auth.users.get(email) if container.auth.users else None
    if entry is None or not verify_password(payload.password, entry.password):
        limits = [("password_change_user", email, PASSWORD_CHANGE_PER_USER)]
        _enforce_limits(container, request, email, limits)
        _hit(container, limits)
        _mfa_audit(container, email, "auth.mfa_disabled", AuditOutcome.DENIED, "wrong_password")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=api_error("wrong_current_password", "Current password is incorrect."),
        )
    _with_code_limits(request, container, email, "auth.mfa_disabled", lambda: container.mfa.disable(email, payload.code))
    _mfa_audit(container, email, "auth.mfa_disabled", AuditOutcome.SUCCESS)
    return _fresh_session(container, email)


@router.post("/mfa/backup-codes", response_model=MfaBackupCodesResponse)
def mfa_backup_codes(
    payload: MfaPasswordCodeRequest,
    request: Request,
    principal: AuthPrincipal = Depends(require_auth),
    container: AppContainer = Depends(get_container),
) -> MfaBackupCodesResponse:
    email = _jwt_user(principal)
    entry = container.auth.users.get(email) if container.auth.users else None
    if entry is None or not verify_password(payload.password, entry.password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=api_error("wrong_current_password", "Current password is incorrect."),
        )
    codes = _with_code_limits(
        request, container, email, "auth.mfa_backup_regenerated", lambda: container.mfa.regenerate_backup_codes(email, payload.code)
    )
    _mfa_audit(container, email, "auth.mfa_backup_regenerated", AuditOutcome.SUCCESS)
    return MfaBackupCodesResponse(backup_codes=codes)


_MFA_SIGN_IN_FAILED = api_error("mfa_invalid_code", "The code is not valid. Try the current one.")
_MFA_TICKET_INVALID = api_error("mfa_ticket_invalid", "The sign-in step expired. Enter your password again.")


@router.post("/mfa/verify", response_model=TokenResponse)
def mfa_verify(
    payload: MfaVerifyRequest,
    request: Request,
    container: AppContainer = Depends(get_container),
) -> TokenResponse:
    """Second sign-in step: the ticket from /login plus an authenticator or backup code."""
    try:
        ticket = container.mfa_challenges.peek(payload.mfa_token)
    except MfaChallengeError as exc:
        _mfa_audit(container, "anonymous", "auth.mfa_challenge", AuditOutcome.DENIED, f"ticket_{exc.reason}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_MFA_TICKET_INVALID) from exc
    email = str(ticket["sub"])
    limits = _mfa_code_limits(request, container, email)
    _enforce_limits(container, request, email, limits)
    entry = container.auth.users.get(email) if container.auth.users else None
    if entry is None or int(ticket.get("tv", -1)) != entry.token_version:
        # Password changed (or account disabled) after the first step.
        _mfa_audit(container, email, "auth.mfa_challenge", AuditOutcome.DENIED, "ticket_revoked")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_MFA_TICKET_INVALID)
    method = container.mfa.verify_sign_in(email, payload.code)
    if method is None:
        _hit(container, limits)
        _mfa_audit(container, email, "auth.mfa_failed", AuditOutcome.DENIED, "invalid_code")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_MFA_SIGN_IN_FAILED)
    try:
        container.mfa_challenges.consume(payload.mfa_token)
    except MfaChallengeError as exc:  # raced with another request using the same ticket
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_MFA_TICKET_INVALID) from exc
    container.rate_limiter.reset("mfa_code_user", email)
    event = "auth.mfa_backup_used" if method == "backup" else "auth.mfa_challenge"
    _mfa_audit(container, email, event, AuditOutcome.SUCCESS, method)
    container.audit.record(
        event_type="auth.login",
        actor=email,
        resource="/api/v1/auth/mfa/verify",
        outcome=AuditOutcome.SUCCESS,
        detail="mfa",
        clinic_id=entry.clinic_id,
    )
    return _issue_token(container, email=email, entry=entry)
