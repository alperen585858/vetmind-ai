"""Encrypt TOTP secrets at rest (issue #107) with Fernet (AES-128-CBC + HMAC-SHA256).

Key: ``VETMIND_MFA_ENCRYPTION_KEY`` (a Fernet key) when set. Otherwise a key is derived
from the JWT secret with HKDF, so a stolen database alone does not reveal the secrets.
Rotating the JWT secret without setting the dedicated key makes stored secrets unreadable
(users then set 2FA up again); production should set ``VETMIND_MFA_ENCRYPTION_KEY``.
"""

from __future__ import annotations

import base64

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


class MfaSecretUnreadable(Exception):
    """Stored secret cannot be decrypted with the current key."""


def _derive(jwt_secret: str) -> bytes:
    raw = HKDF(algorithm=hashes.SHA256(), length=32, salt=b"vetmind-mfa-v1", info=b"totp-secret").derive(
        jwt_secret.encode("utf-8")
    )
    return base64.urlsafe_b64encode(raw)


class MfaSecretBox:
    def __init__(self, *, dedicated_key: str | None, jwt_secret: str) -> None:
        key = dedicated_key.encode("ascii") if dedicated_key else _derive(jwt_secret)
        self._fernet = Fernet(key)
        self.key_source = "VETMIND_MFA_ENCRYPTION_KEY" if dedicated_key else "derived-from-jwt-secret"

    def seal(self, secret_b32: str) -> str:
        return self._fernet.encrypt(secret_b32.encode("ascii")).decode("ascii")

    def open(self, sealed: str) -> str:
        try:
            return self._fernet.decrypt(sealed.encode("ascii")).decode("ascii")
        except (InvalidToken, ValueError) as exc:
            raise MfaSecretUnreadable() from exc
