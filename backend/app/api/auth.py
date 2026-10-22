from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_container
from app.auth.deps import AuthPrincipal, require_auth
from app.auth.security import DEMO_USERS, create_access_token
from app.container import AppContainer

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
    auth_enabled: bool
    note: str = "Demo JWT. Not a production IdP."


class MeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject: str
    role: str
    via: str
    auth_enabled: bool


@router.get("/status")
def auth_status(container: AppContainer = Depends(get_container)) -> dict[str, object]:
    return {
        "auth_enabled": container.auth.enabled,
        "methods": ["bearer_jwt", "x_api_key"] if container.auth.enabled else [],
        "note": "Auth disabled by default (VETMIND_AUTH_ENABLED=0). Demo localStorage UI still works.",
    }


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, container: AppContainer = Depends(get_container)) -> TokenResponse:
    users = container.auth.users or DEMO_USERS
    entry = users.get(payload.email.strip().lower())
    if entry is None or entry[0] != payload.password:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")
    role = entry[1]
    token = create_access_token(
        subject=payload.email.strip().lower(),
        role=role,
        secret=container.auth.jwt_secret,
        ttl_seconds=container.auth.jwt_ttl_seconds,
    )
    return TokenResponse(
        access_token=token,
        role=role,
        email=payload.email.strip().lower(),
        auth_enabled=container.auth.enabled,
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
        auth_enabled=container.auth.enabled,
    )
