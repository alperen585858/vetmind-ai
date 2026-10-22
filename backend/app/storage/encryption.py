"""Pluggable encryption-at-rest design (Phase 5).

VetMind does **not** encrypt quarantine blobs by default.
When encryption is required, integrate an established library (e.g. cryptography
Fernet / AES-GCM) behind ``BlobEncryptor`` with external key management.

Do not mark storage as encrypted unless a concrete encryptor is configured and tested.
Custom cryptography is prohibited.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class EncryptionStatus:
    mode: str  # "none" | "configured"
    algorithm: str | None
    key_source: str | None
    note: str


class BlobEncryptor(Protocol):
    """Authenticated encryption interface for quarantine bytes."""

    def encrypt(self, plaintext: bytes, *, aad: bytes | None = None) -> bytes: ...

    def decrypt(self, ciphertext: bytes, *, aad: bytes | None = None) -> bytes: ...


class NullEncryptor:
    """Passthrough — storage is NOT encrypted."""

    def encrypt(self, plaintext: bytes, *, aad: bytes | None = None) -> bytes:
        return plaintext

    def decrypt(self, ciphertext: bytes, *, aad: bytes | None = None) -> bytes:
        return ciphertext


def encryption_status(mode: str) -> EncryptionStatus:
    normalized = (mode or "none").strip().lower()
    if normalized in {"none", "off", "disabled"}:
        return EncryptionStatus(
            mode="none",
            algorithm=None,
            key_source=None,
            note="Quarantine bytes are stored in plaintext. Encryption-at-rest is not enabled.",
        )
    # Reserved for future Fernet/AES-GCM wiring — refuse to claim encryption without impl.
    return EncryptionStatus(
        mode="none",
        algorithm=None,
        key_source=None,
        note=(
            f"Requested encryption mode '{normalized}' is not implemented. "
            "Storage remains plaintext. Wire BlobEncryptor + KMS before claiming encryption."
        ),
    )
