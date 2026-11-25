"""Two-step sign-in with TOTP (issue #107).

Opt-in per user. Demo seed accounts (``*@demo.local`` in ``DEMO_USERS``) can never turn it
on or be forced to, so the team keeps signing in with ``demo1234`` alone.
"""

from __future__ import annotations

import secrets
import threading
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.auth import totp
from app.auth.mfa_crypto import MfaSecretBox, MfaSecretUnreadable
from app.auth.passwords import hash_password, verify_password
from app.auth.security import DEMO_USERS
from app.http_errors import api_error
from app.schemas.workflow import ManagedUser

BACKUP_CODE_COUNT = 10
_BACKUP_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"  # no 0/o/1/l/i look-alikes


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_backup_code() -> str:
    raw = "".join(secrets.choice(_BACKUP_ALPHABET) for _ in range(10))
    return f"{raw[:5]}-{raw[5:]}"


def normalize_backup_code(code: str) -> str:
    cleaned = "".join(ch for ch in (code or "").lower() if ch.isalnum())
    return f"{cleaned[:5]}-{cleaned[5:]}" if len(cleaned) == 10 else ""


@dataclass(frozen=True)
class MfaStatus:
    enabled: bool
    backup_codes_left: int
    required_for_role: bool
    demo_account: bool
    setup_pending: bool


class MfaService:
    def __init__(self, workflow_store, workflow, *, box: MfaSecretBox, required_roles: tuple[str, ...]) -> None:
        self._store = workflow_store
        self._workflow = workflow
        self._box = box
        self._required = frozenset(required_roles)
        self._lock = threading.RLock()

    # --- helpers ------------------------------------------------------------------------

    @staticmethod
    def is_demo(email: str) -> bool:
        return email.strip().lower() in DEMO_USERS

    def required_for(self, email: str, role: str) -> bool:
        return role in self._required and not self.is_demo(email)

    @property
    def required_roles(self) -> tuple[str, ...]:
        return tuple(sorted(self._required))

    def _user(self, email: str) -> ManagedUser:
        user = self._store.get_user(email.strip().lower())
        if user is None or not user.active:
            raise HTTPException(status_code=404, detail=api_error("user_not_found", "User not found."))
        return user

    def _guard_demo(self, email: str) -> None:
        if self.is_demo(email):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=api_error("mfa_demo_account", "Two-step sign-in is not available on demo accounts."),
            )

    def _save(self, user: ManagedUser, *, bump_tokens: bool) -> ManagedUser:
        update: dict[str, object] = {"updated_at": _now()}
        if bump_tokens:
            update["token_version"] = user.token_version + 1
        saved = user.model_copy(update=update)
        self._store.save_user(saved)
        self._workflow.sync_auth_directory()
        return saved

    def _check_code(self, user: ManagedUser, code: str, *, sealed: str | None) -> int | None:
        if not sealed:
            return None
        try:
            secret = self._box.open(sealed)
        except MfaSecretUnreadable:
            return None
        return totp.verify(secret, code, last_used_step=user.mfa_last_step)

    @staticmethod
    def _bad_code() -> HTTPException:
        return HTTPException(status_code=400, detail=api_error("mfa_invalid_code", "The code is not valid. Try the current one."))

    # --- status / setup -----------------------------------------------------------------

    def status(self, email: str, role: str) -> MfaStatus:
        user = self._store.get_user(email.strip().lower())
        return MfaStatus(
            enabled=bool(user and user.mfa_enabled),
            backup_codes_left=len(user.mfa_backup_hashes) if user else 0,
            required_for_role=self.required_for(email, role),
            demo_account=self.is_demo(email),
            setup_pending=bool(user and user.mfa_pending_sealed and not user.mfa_enabled),
        )

    def begin_setup(self, email: str) -> tuple[str, str]:
        """New secret, stored as *pending* until a code proves the app has it."""
        self._guard_demo(email)
        with self._lock:
            user = self._user(email)
            if user.mfa_enabled:
                raise HTTPException(status_code=409, detail=api_error("mfa_already_enabled", "Two-step sign-in is already on."))
            secret = totp.generate_secret()
            self._save(user.model_copy(update={"mfa_pending_sealed": self._box.seal(secret)}), bump_tokens=False)
        return secret, totp.otpauth_uri(secret, user.email)

    def enable(self, email: str, code: str) -> list[str]:
        """Confirm setup with a code. Returns the backup codes (shown once). Ends other sessions."""
        self._guard_demo(email)
        with self._lock:
            user = self._user(email)
            if user.mfa_enabled:
                raise HTTPException(status_code=409, detail=api_error("mfa_already_enabled", "Two-step sign-in is already on."))
            step = self._check_code(user, code, sealed=user.mfa_pending_sealed)
            if step is None:
                raise self._bad_code()
            codes = [_new_backup_code() for _ in range(BACKUP_CODE_COUNT)]
            self._save(
                user.model_copy(
                    update={
                        "mfa_enabled": True,
                        "mfa_secret_sealed": user.mfa_pending_sealed,
                        "mfa_pending_sealed": None,
                        "mfa_enabled_at": _now(),
                        "mfa_last_step": step,
                        "mfa_backup_hashes": [hash_password(c) for c in codes],
                    }
                ),
                bump_tokens=True,
            )
        return codes

    def _require_enabled_and_code(self, user: ManagedUser, code: str) -> int:
        if not user.mfa_enabled:
            raise HTTPException(status_code=409, detail=api_error("mfa_not_enabled", "Two-step sign-in is off."))
        step = self._check_code(user, code, sealed=user.mfa_secret_sealed)
        if step is None:
            raise self._bad_code()
        return step

    def disable(self, email: str, code: str) -> None:
        with self._lock:
            user = self._user(email)
            self._require_enabled_and_code(user, code)
            self._save(self._cleared(user), bump_tokens=True)

    def regenerate_backup_codes(self, email: str, code: str) -> list[str]:
        with self._lock:
            user = self._user(email)
            step = self._require_enabled_and_code(user, code)
            codes = [_new_backup_code() for _ in range(BACKUP_CODE_COUNT)]
            self._save(
                user.model_copy(update={"mfa_last_step": step, "mfa_backup_hashes": [hash_password(c) for c in codes]}),
                bump_tokens=False,
            )
        return codes

    @staticmethod
    def _cleared(user: ManagedUser) -> ManagedUser:
        return user.model_copy(
            update={
                "mfa_enabled": False,
                "mfa_secret_sealed": None,
                "mfa_pending_sealed": None,
                "mfa_enabled_at": None,
                "mfa_last_step": None,
                "mfa_backup_hashes": [],
            }
        )

    def admin_reset(self, email: str) -> ManagedUser:
        """Lost phone: turn 2FA off for the user and end their sessions."""
        with self._lock:
            user = self._store.get_user(email.strip().lower())
            if user is None:
                raise HTTPException(status_code=404, detail=api_error("user_not_found", "User not found."))
            return self._save(self._cleared(user), bump_tokens=True)

    # --- sign-in --------------------------------------------------------------------------

    def is_enabled(self, email: str) -> bool:
        if self.is_demo(email):
            return False
        user = self._store.get_user(email.strip().lower())
        return bool(user and user.mfa_enabled)

    def verify_sign_in(self, email: str, code: str) -> str | None:
        """Second step. Returns "totp" / "backup" on success, None otherwise.

        A TOTP code works once (its step is remembered); a backup code is removed when used.
        """
        with self._lock:
            user = self._store.get_user(email.strip().lower())
            if user is None or not user.mfa_enabled:
                return None
            step = self._check_code(user, code, sealed=user.mfa_secret_sealed)
            if step is not None:
                self._store.save_user(user.model_copy(update={"mfa_last_step": step, "updated_at": _now()}))
                return "totp"
            backup = normalize_backup_code(code)
            if not backup:
                return None
            for i, hashed in enumerate(user.mfa_backup_hashes):
                if verify_password(backup, hashed):
                    remaining = user.mfa_backup_hashes[:i] + user.mfa_backup_hashes[i + 1 :]
                    self._store.save_user(user.model_copy(update={"mfa_backup_hashes": remaining, "updated_at": _now()}))
                    return "backup"
            return None
