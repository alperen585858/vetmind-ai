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
    token = create_access_token(
        subject=email,
        role=entry.role,
        secret=container.auth.jwt_secret,
        ttl_seconds=container.auth.jwt_ttl_seconds,
        clinic_id=entry.clinic_id,
    )
    container.audit.record(
        event_type="auth.login",
        actor=email,
        resource="/api/v1/auth/login",
        outcome=AuditOutcome.SUCCESS,
        clinic_id=entry.clinic_id,
    )
    return TokenResponse(
        access_token=token,
        role=entry.role,
        email=email,
        clinic_id=entry.clinic_id,
        auth_enabled=container.auth.enabled,
        deployment_mode=container.auth.deployment_mode,
        tenant_isolation=container.auth.tenant_isolation,
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
