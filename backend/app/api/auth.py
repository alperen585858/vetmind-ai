from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_container
from app.auth.deps import AuthPrincipal, require_auth
from app.auth.security import DEMO_USERS, create_access_token, verify_password
from app.container import AppContainer
from app.security.audit import AuditOutcome

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=1, max_length=120)


class TokenResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    access_token: str
    token_type: str = "bearer"
    role: str
    email: str
    clinic_id: str | None = None
    auth_enabled: bool
    deployment_mode: str = "demo"
    tenant_isolation: bool = False
    note: str = "Demo JWT. Not a production IdP."


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


class MeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject: str
    role: str
    via: str
    clinic_id: str | None = None
    auth_enabled: bool
    deployment_mode: str = "demo"
    tenant_isolation: bool = False


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
def login(payload: LoginRequest, container: AppContainer = Depends(get_container)) -> TokenResponse:
    users = container.auth.users or DEMO_USERS
    email = payload.email.strip().lower()
    entry = users.get(email)
    if entry is None or not verify_password(payload.password, entry.password):
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
    return _issue_token(container, email=email, role=entry.role, clinic_id=entry.clinic_id)


def _issue_token(container: AppContainer, *, email: str, role: str, clinic_id: str | None) -> TokenResponse:
    token = create_access_token(
        subject=email,
        role=role,
        secret=container.auth.jwt_secret,
        ttl_seconds=container.auth.jwt_ttl_seconds,
        clinic_id=clinic_id,
    )
    return TokenResponse(
        access_token=token,
        role=role,
        email=email,
        clinic_id=clinic_id,
        auth_enabled=container.auth.enabled,
        deployment_mode=container.auth.deployment_mode,
        tenant_isolation=container.auth.tenant_isolation,
    )


@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, container: AppContainer = Depends(get_container)) -> RegisterResponse:
    """Self-service sign-up. Owners get a session at once; vets wait for admin activation."""
    email = payload.email.strip().lower()

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
    session = _issue_token(container, email=user.email, role=user.role, clinic_id=user.clinic_id)
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
