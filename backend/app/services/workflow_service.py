"""Managed users, the login directory and clinic staff stats."""

from __future__ import annotations

import re
import threading
from datetime import datetime, timezone
from typing import Literal

from fastapi import HTTPException, status

from app.auth.passwords import (
    hash_password,
    is_password_hash,
    needs_rehash,
    password_policy_detail,
)
from app.auth.principal import AuthPrincipal
from app.auth.security import DEMO_USERS, DemoUserRecord, demo_password_hash
from app.http_errors import api_error
from app.schemas.workflow import (
    ClinicStaffStats,
    ManagedUser,
    ManagedUserCreate,
    ManagedUserPublic,
    ManagedUserUpdate,
)
from app.services.case_service import CaseService
from app.services.dicom_service import DicomService
from app.services.notification_service import NotificationService
from app.services.workflow_store import WorkflowStore


def _now() -> datetime:
    return datetime.now(timezone.utc)


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Roles anyone may sign up for. Vets start inactive (admin assigns a clinic and activates):
# an active vet account sees its clinic's cases, so it must not be self-service.
SelfRegisterRole = Literal["vet"]
# Roles an admin may assign. ``owner`` is kept in ManagedRole only so legacy rows still load.
ASSIGNABLE_ROLES = frozenset({"vet", "expert", "clinic_owner", "admin"})

# Clinic-scoped staff roles. Several access checks skip the clinic comparison when the
# principal has no clinic_id, so an *active* account in one of these roles must have one.
CLINIC_REQUIRED_ROLES = frozenset({"vet", "expert", "clinic_owner"})


def _assert_user_state_allowed(user: ManagedUser) -> None:
    if user.active and user.role not in ASSIGNABLE_ROLES:
        raise HTTPException(
            status_code=422,
            detail=api_error("role_not_supported", "Pet-owner accounts are no longer supported."),
        )
    if user.active and not user.email_verified:
        raise HTTPException(
            status_code=409,
            detail=api_error(
                "email_not_verified",
                "This user has not verified their email yet. Mark it verified to activate anyway.",
            ),
        )
    if user.active and user.role in CLINIC_REQUIRED_ROLES and not (user.clinic_id or "").strip():
        raise HTTPException(
            status_code=422,
            detail=f"Assign a clinic before activating a '{user.role}' account.",
        )


def _assert_password_allowed(password: str) -> None:
    weak = password_policy_detail(password)
    if weak:
        raise HTTPException(status_code=422, detail=weak)


class WorkflowService:
    def __init__(
        self,
        store: WorkflowStore,
        cases: CaseService,
        *,
        dicom: DicomService | None = None,
        notifications: NotificationService | None = None,
        tenant_isolation: bool = False,
        auth_users: dict[str, DemoUserRecord] | None = None,
        demo_accounts: bool = True,
    ) -> None:
        # False (protected mode by default): the shared-password *@demo.local seed accounts
        # are never seeded, never put in the login directory and never recreated.
        self._demo_accounts = demo_accounts
        self._store = store
        self._cases = cases
        self._dicom = dicom
        self._notifications = notifications
        self._tenant_isolation = tenant_isolation
        self._auth_users = (
            auth_users if auth_users is not None else (dict(DEMO_USERS) if demo_accounts else {})
        )
        self._user_write_lock = threading.Lock()
        self._seed_managed_from_demo()
        self._migrate_plaintext_passwords()

    def _seed_managed_from_demo(self) -> None:
        if not self._demo_accounts or self._store.list_users():
            return
        for email, rec in DEMO_USERS.items():
            self._store.save_user(
                ManagedUser(
                    email=email,
                    role=rec.role,  # type: ignore[arg-type]
                    clinic_id=rec.clinic_id,
                    display_name=email.split("@")[0],
                    active=True,
                    password_hash=demo_password_hash(email),
                    created_at=_now(),
                )
            )

    def _migrate_plaintext_passwords(self) -> int:
        """Hash any plaintext password left by rows written before hashing existed."""
        migrated = 0
        for u in self._store.list_users():
            if u.password is None:
                continue
            new_hash = u.password_hash
            if not is_password_hash(new_hash):
                new_hash = (
                    u.password if is_password_hash(u.password) else hash_password(u.password)
                )
            self._store.save_user(u.model_copy(update={"password": None, "password_hash": new_hash}))
            migrated += 1
        return migrated

    @staticmethod
    def _directory_hash(user: ManagedUser) -> str | None:
        if is_password_hash(user.password_hash):
            return user.password_hash
        # Seed rows that were saved without a credential fall back to the demo password.
        return demo_password_hash(user.email)

    def sync_auth_directory(self) -> dict[str, DemoUserRecord]:
        """Rebuild the login directory (hashed credentials only) from stored users."""
        directory: dict[str, DemoUserRecord] = {}
        stored_emails: set[str] = set()
        for u in self._store.list_users():
            email = u.email.lower()
            stored_emails.add(email)
            if not u.active or u.role not in ASSIGNABLE_ROLES:
                continue
            if not self._demo_accounts and email in DEMO_USERS:
                # Seed row left by an earlier demo-mode run on the same database.
                continue
            pwd_hash = self._directory_hash(u)
            if not pwd_hash:
                continue
            directory[email] = DemoUserRecord(pwd_hash, u.role, u.clinic_id, u.token_version)
        # Seed users that were never stored. A stored (e.g. deactivated) seed user is
        # not re-added, so deactivating a demo account really blocks its login.
        for email, rec in DEMO_USERS.items() if self._demo_accounts else ():
            if email not in stored_emails:
                directory[email] = DemoUserRecord(
                    demo_password_hash(email) or "", rec.role, rec.clinic_id
                )
        self._auth_users.clear()
        self._auth_users.update(directory)
        return self._auth_users

    def _notify_one(
        self,
        *,
        recipient: str | None,
        kind: str,
        title: str,
        body: str,
        link_path: str,
        dedupe_key: str,
        case_id: str | None = None,
        submission_id: str | None = None,
        clinic_id: str | None = None,
    ) -> None:
        if self._notifications is None or not recipient:
            return
        self._notifications.notify(
            recipient_subject=recipient,
            kind=kind,  # type: ignore[arg-type]
            title=title,
            body=body,
            link_path=link_path,
            dedupe_key=dedupe_key,
            case_id=case_id,
            submission_id=submission_id,
            clinic_id=clinic_id,
        )

    def _notify_clinic_vets(
        self,
        *,
        clinic_id: str | None,
        kind: str,
        title: str,
        body: str,
        link_path: str,
        dedupe_key: str,
        submission_id: str | None = None,
    ) -> None:
        if self._notifications is None:
            return
        recipients: set[str] = set()
        if self._auth_users:
            for email, rec in self._auth_users.items():
                if rec.role in {"vet", "clinic_owner", "admin"} and (
                    not clinic_id or not rec.clinic_id or rec.clinic_id == clinic_id
                ):
                    recipients.add(email)
        for u in self._store.list_users():
            if u.active and u.role in {"vet", "clinic_owner", "admin"} and (
                not clinic_id or not u.clinic_id or u.clinic_id == clinic_id
            ):
                recipients.add(u.email)
        if not recipients:
            recipients.add("vet@demo.local")
        for email in recipients:
            self._notifications.notify(
                recipient_subject=email,
                kind=kind,  # type: ignore[arg-type]
                title=title,
                body=body,
                link_path=link_path,
                dedupe_key=f"{dedupe_key}:{email}",
                submission_id=submission_id,
                clinic_id=clinic_id,
            )

    # --- Admin users / clinic ---

    def list_users(self, *, principal: AuthPrincipal) -> list[ManagedUserPublic]:
        if principal.role not in {"admin", "clinic_owner", "demo", "service"} and principal.via != "disabled":
            raise HTTPException(status_code=403, detail="Not allowed.")
        users = self._store.list_users()
        if principal.role == "clinic_owner" and principal.via == "jwt":
            users = [u for u in users if u.clinic_id == principal.clinic_id]
        # Never expose passwords or hashes
        return [u.to_public() for u in users]

    def create_user(self, payload: ManagedUserCreate, *, principal: AuthPrincipal) -> ManagedUserPublic:
        if principal.role not in {"admin", "demo", "service"} and principal.via != "disabled":
            raise HTTPException(status_code=403, detail="Admin only.")
        email = payload.email.strip().lower()
        if not self._demo_accounts and email in DEMO_USERS:
            raise HTTPException(
                status_code=422,
                detail=api_error("demo_email_reserved", "Demo account addresses are disabled in this deployment."),
            )
        _assert_password_allowed(payload.password)
        # An existing (or seed) email is overwritten via the managed store. Bump the
        # token version past the old record so its sessions cannot come back.
        previous = self._store.get_user(email)
        user = ManagedUser(
            token_version=(previous.token_version + 1) if previous else 0,
            email=email,
            role=payload.role,
            clinic_id=(payload.clinic_id or "").strip() or None,
            display_name=payload.display_name or email.split("@")[0],
            active=True,
            password_hash=hash_password(payload.password),
            created_at=_now(),
        )
        _assert_user_state_allowed(user)
        self._store.save_user(user)
        self.sync_auth_directory()
        return user.to_public()

    @staticmethod
    def validate_registration(*, email: str, password: str, role: str) -> str:
        """Checks that do not depend on whether the address is registered (issue #41).

        The API runs them before answering; the lookup itself happens after the response.
        Returns the normalized email.
        """
        email = email.strip().lower()
        if not _EMAIL_RE.match(email):
            raise HTTPException(
                status_code=422,
                detail=api_error("invalid_email", "Enter a valid email address."),
            )
        if role != "vet":
            raise HTTPException(
                status_code=422,
                detail=api_error("role_not_self_registerable", "This role cannot be self-registered."),
            )
        _assert_password_allowed(password)
        return email

    def register_user(
        self,
        *,
        email: str,
        password: str,
        role: SelfRegisterRole,
        display_name: str | None = None,
        owner_clinic_id: str | None = None,
    ) -> ManagedUser:
        """Public sign-up for vets. Accounts wait for admin activation (B2B only)."""
        email = self.validate_registration(email=email, password=password, role=role)
        name = (display_name or "").strip() or email.split("@")[0]
        user = ManagedUser(
            email=email,
            role=role,
            # Never let the client pick a clinic: an active clinic member sees its cases.
            clinic_id=None,
            display_name=name[:80],
            active=False,
            email_verified=False,
            password_hash=hash_password(password),
            created_at=_now(),
        )
        with self._user_write_lock:
            if self._store.get_user(email) is not None or email in DEMO_USERS:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=api_error("email_exists", "An account with this email already exists."),
                )
            self._store.save_user(user)
            self.sync_auth_directory()
        return user

    def mark_email_verified(self, email: str) -> ManagedUser | None:
        """Issue #41: the emailed link was opened. Returns None if the user is gone."""
        email = email.strip().lower()
        with self._user_write_lock:
            existing = self._store.get_user(email)
            if existing is None:
                return None
            if existing.email_verified:
                return existing
            user = existing.model_copy(
                update={"email_verified": True, "email_verified_at": _now(), "updated_at": _now()}
            )
            self._store.save_user(user)
        return user

    def record_login(self, email: str, password: str) -> None:
        """After a successful login: stamp last_login_at and upgrade an outdated hash.

        The rehash keeps token_version, so it never signs anyone out.
        """
        email = email.strip().lower()
        with self._user_write_lock:
            existing = self._store.get_user(email)
            if existing is None:
                return
            update: dict[str, object] = {"last_login_at": _now()}
            if needs_rehash(existing.password_hash):
                update["password_hash"] = hash_password(password)
                update["password"] = None
            self._store.save_user(existing.model_copy(update=update))
            if "password_hash" in update:
                self.sync_auth_directory()

    def set_password(self, email: str, new_password: str) -> ManagedUser:
        """Self-service password change/reset. Bumps token_version (signs out all sessions)."""
        email = email.strip().lower()
        _assert_password_allowed(new_password)
        with self._user_write_lock:
            existing = self._store.get_user(email)
            if existing is None and self._demo_accounts and email in DEMO_USERS:
                rec = DEMO_USERS[email]
                existing = ManagedUser(
                    email=email,
                    role=rec.role,  # type: ignore[arg-type]
                    clinic_id=rec.clinic_id,
                    display_name=email.split("@")[0],
                    password_hash=demo_password_hash(email),
                )
            if existing is None or not existing.active:
                raise HTTPException(status_code=404, detail="User not found.")
            user = existing.model_copy(
                update={
                    "password": None,
                    "password_hash": hash_password(new_password),
                    "token_version": existing.token_version + 1,
                    "updated_at": _now(),
                }
            )
            self._store.save_user(user)
            self.sync_auth_directory()
        return user

    def update_user(self, email: str, payload: ManagedUserUpdate, *, principal: AuthPrincipal) -> ManagedUserPublic:
        if principal.role not in {"admin", "demo", "service"} and principal.via != "disabled":
            raise HTTPException(status_code=403, detail="Admin only.")
        existing = self._store.get_user(email.lower())
        if not self._demo_accounts and email.lower() in DEMO_USERS:
            raise HTTPException(status_code=404, detail="User not found.")
        if existing is None and email.lower() in DEMO_USERS:
            rec = DEMO_USERS[email.lower()]
            existing = ManagedUser(
                email=email.lower(),
                role=rec.role,  # type: ignore[arg-type]
                clinic_id=rec.clinic_id,
                password_hash=demo_password_hash(email),
                display_name=email.split("@")[0],
            )
        if existing is None:
            raise HTTPException(status_code=404, detail="User not found.")
        data = payload.model_dump(exclude_unset=True)
        new_password = data.pop("password", None)
        if new_password:
            _assert_password_allowed(new_password)
            data["password_hash"] = hash_password(new_password)
            # Sign out every existing session of this user.
            data["token_version"] = existing.token_version + 1
        if "clinic_id" in data:
            data["clinic_id"] = (data["clinic_id"] or "").strip() or None
        if data.pop("email_verified", None) and not existing.email_verified:
            data["email_verified"] = True
            data["email_verified_at"] = _now()
        data["updated_at"] = _now()
        user = existing.model_copy(update=data)
        _assert_user_state_allowed(user)
        self._store.save_user(user)
        self.sync_auth_directory()
        return user.to_public()

    def clinic_stats(self, *, principal: AuthPrincipal) -> ClinicStaffStats:
        if principal.role not in {"clinic_owner", "vet", "admin", "demo", "service"} and principal.via != "disabled":
            raise HTTPException(status_code=403, detail="Not allowed.")
        clinic = principal.clinic_id or "clinic-demo-a"
        cases = self._cases.list_cases(principal=principal)
        pending = [
            s
            for s in self._store.list_submissions()
            if s.status in {"pending_verification", "needs_info"}
            and (
                principal.via == "disabled"
                or principal.role == "admin"
                or not self._tenant_isolation
                or (s.clinic_id and s.clinic_id == principal.clinic_id)
            )
        ]
        staff = self.list_users(principal=principal)
        return ClinicStaffStats(
            clinic_id=clinic,
            case_count=len(cases),
            awaiting_review=sum(1 for c in cases if str(c.status.value if hasattr(c.status, "value") else c.status) == "awaiting_review"),
            approved=sum(1 for c in cases if str(c.status.value if hasattr(c.status, "value") else c.status) == "approved"),
            pending_submissions=len(pending),
            staff=staff,
        )
