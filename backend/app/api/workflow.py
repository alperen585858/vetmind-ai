"""Clinic stats and admin user management.

Pet-owner pets / imaging submissions endpoints were removed in the B2B transition:
veterinarians open cases directly (``POST /api/v1/cases``).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_container
from app.auth.deps import AuthPrincipal, require_auth, require_capability
from app.auth.rbac import CAP_ADMIN, CAP_CLINIC_MANAGE, CAP_USERS_ADMIN
from app.container import AppContainer
from app.security.audit import AuditOutcome
from app.schemas.workflow import (
    ClinicStaffStats,
    ManagedUserCreate,
    ManagedUserPublic,
    ManagedUserUpdate,
)

router = APIRouter(prefix="/api/v1", tags=["workflow"], dependencies=[Depends(require_auth)])


def _workflow(container: AppContainer = Depends(get_container)):
    return container.workflow


@router.get("/clinic/stats", response_model=ClinicStaffStats)
def clinic_stats(
    principal: AuthPrincipal = Depends(require_capability(CAP_CLINIC_MANAGE)),
    service=Depends(_workflow),
) -> ClinicStaffStats:
    return service.clinic_stats(principal=principal)


@router.get("/admin/users", response_model=list[ManagedUserPublic])
def list_users(
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_workflow),
) -> list[ManagedUserPublic]:
    if not (principal.can(CAP_USERS_ADMIN) or principal.can(CAP_CLINIC_MANAGE) or principal.can(CAP_ADMIN)):
        # clinic_owner can list staff via clinic:manage
        if not principal.can(CAP_CLINIC_MANAGE):
            raise HTTPException(status_code=403, detail="Not allowed.")
    return service.list_users(principal=principal)


@router.post("/admin/users", response_model=ManagedUserPublic, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: ManagedUserCreate,
    principal: AuthPrincipal = Depends(require_capability(CAP_ADMIN)),
    service=Depends(_workflow),
) -> ManagedUserPublic:
    return service.create_user(payload, principal=principal)


@router.patch("/admin/users/{email}", response_model=ManagedUserPublic)
def update_user(
    email: str,
    payload: ManagedUserUpdate,
    principal: AuthPrincipal = Depends(require_capability(CAP_ADMIN)),
    service=Depends(_workflow),
) -> ManagedUserPublic:
    return service.update_user(email, payload, principal=principal)


class MfaPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Roles that must use two-step sign-in. Demo accounts (*@demo.local) are always exempt.
    required_roles: list[str]
    # "admin" = saved from the UI; "env" = VETMIND_MFA_REQUIRED_ROLES; "default" = none.
    source: str = "default"
    available_roles: list[str] = Field(default_factory=list)


class MfaPolicyUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    required_roles: list[str] = Field(default_factory=list, max_length=8)


def _policy_out(container: AppContainer) -> MfaPolicy:
    from app.auth.mfa import POLICY_ROLES

    return MfaPolicy(
        required_roles=list(container.mfa.required_roles),
        source=container.mfa.policy_source,
        available_roles=list(POLICY_ROLES),
    )


@router.get("/admin/mfa-policy", response_model=MfaPolicy)
def get_mfa_policy(
    principal: AuthPrincipal = Depends(require_capability(CAP_ADMIN)),
    container: AppContainer = Depends(get_container),
) -> MfaPolicy:
    return _policy_out(container)


@router.put("/admin/mfa-policy", response_model=MfaPolicy)
def update_mfa_policy(
    payload: MfaPolicyUpdate,
    principal: AuthPrincipal = Depends(require_capability(CAP_ADMIN)),
    container: AppContainer = Depends(get_container),
) -> MfaPolicy:
    """Issue #107: admin chooses which roles must use 2FA (demo accounts stay exempt)."""
    if principal.role not in {"admin", "demo", "service"} and principal.via != "disabled":
        raise HTTPException(status_code=403, detail="Admin only.")
    before = list(container.mfa.required_roles)
    after = list(container.mfa.set_required_roles(payload.required_roles, actor=principal.subject))
    container.audit.record(
        event_type="admin.mfa_policy_update",
        actor=principal.subject,
        resource="/api/v1/admin/mfa-policy",
        outcome=AuditOutcome.SUCCESS,
        detail=f"{','.join(before) or '-'} -> {','.join(after) or '-'}",
    )
    return _policy_out(container)


@router.post("/admin/users/{email}/mfa-reset", response_model=ManagedUserPublic)
def reset_user_mfa(
    email: str,
    principal: AuthPrincipal = Depends(require_capability(CAP_ADMIN)),
    container: AppContainer = Depends(get_container),
) -> ManagedUserPublic:
    """Issue #107: the user lost their phone. Turns their 2FA off and ends their sessions;
    they set it up again after signing in with the password."""
    if principal.role not in {"admin", "demo", "service"} and principal.via != "disabled":
        raise HTTPException(status_code=403, detail="Admin only.")
    target = email.strip().lower()
    user = container.mfa.admin_reset(target)
    container.refresh_tokens.revoke_all_for(target)
    container.audit.record(
        event_type="admin.mfa_reset",
        actor=principal.subject,
        resource=f"/api/v1/admin/users/{target}/mfa-reset",
        outcome=AuditOutcome.SUCCESS,
        detail=f"for={target}",
    )
    return user.to_public()


class PasswordResetLink(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str
    link: str
    expires_in: int


@router.post("/admin/users/{email}/reset-link", response_model=PasswordResetLink)
def create_password_reset_link(
    email: str,
    principal: AuthPrincipal = Depends(require_capability(CAP_ADMIN)),
    container: AppContainer = Depends(get_container),
) -> PasswordResetLink:
    """Admin hands a user a single-use reset link (e.g. over the phone or chat).

    Same token rules as the emailed link: 30 min by default, one use, newer links void
    older ones. Nothing is emailed; the admin passes the link on.
    """
    if principal.role not in {"admin", "demo", "service"} and principal.via != "disabled":
        raise HTTPException(status_code=403, detail="Admin only.")
    target = email.strip().lower()
    if not container.auth.users or target not in container.auth.users:
        # Unknown or inactive: activate the account first.
        raise HTTPException(status_code=404, detail="No active account with this email.")
    raw = container.password_resets.issue(target)
    container.audit.record(
        event_type="admin.password_reset_link",
        actor=principal.subject,
        resource=f"/api/v1/admin/users/{target}/reset-link",
        outcome=AuditOutcome.SUCCESS,
        detail=f"for={target}",
    )
    return PasswordResetLink(
        email=target,
        link=f"{container.settings.public_base_url}/sifre-sifirla?token={raw}",
        expires_in=container.password_resets.ttl_seconds,
    )
