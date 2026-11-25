"""Single-use email verification links (issue #41).

Same token rules as password reset (``password_reset.py``): the raw token only travels in
the emailed link, the store keeps its SHA-256, it expires after ``ttl_seconds``, works
once, and a new link for the same address voids the older ones. Rows live in their own
``email_verifications`` table so a verification link can never reset a password.
"""

from __future__ import annotations

from app.auth.password_reset import (
    InMemoryPasswordResetStore,
    PasswordResetError,
    PasswordResetService,
    PasswordResetStore,
    SqlPasswordResetStore,
)
from app.storage.sql import connect_from_settings

# Raised by ``consume`` with reason "missing" / "unknown" / "used" / "expired".
EmailVerificationError = PasswordResetError


class EmailVerificationService(PasswordResetService):
    """Issue/consume verification tokens; the subject is the lower-cased email."""


def build_email_verification_store(settings) -> PasswordResetStore:
    if settings.storage_backend == "memory":
        return InMemoryPasswordResetStore()
    return SqlPasswordResetStore(connect_from_settings(settings), table="email_verifications")
