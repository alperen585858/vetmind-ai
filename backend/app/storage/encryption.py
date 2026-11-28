"""Encryption at rest for quarantined files (#126).

``VETMIND_ENCRYPTION_AT_REST=aes-gcm`` + ``VETMIND_BLOB_KEY`` (32 random bytes, url-safe
base64: ``python -c "import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())"``)
makes every file written to quarantine AES-256-GCM encrypted (``cryptography``, no custom crypto).

File format: ``VMENC1`` + 12-byte nonce + ciphertext-with-tag. Files without the marker are
read as plaintext, so quarantines written before encryption was turned on keep working
(``scripts/encrypt_quarantine.py`` encrypts them in place). A file that is encrypted but no key
is configured raises instead of returning ciphertext.

Key management is an env var / secret file; rotating it means re-encrypting (decrypt with the
old key, encrypt with the new one). There is no KMS integration.
"""

from __future__ import annotations

import base64
import binascii
import os
from dataclasses import dataclass
from typing import Protocol

MAGIC = b"VMENC1"
_NONCE_BYTES = 12
# Binds ciphertext to this application's quarantine (not to a path, so files can be moved).
_AAD = b"vetmind-quarantine-v1"
ENABLED_MODES = {"aes-gcm", "aes-256-gcm"}
OFF_MODES = {"none", "off", "disabled", ""}


@dataclass(frozen=True)
class EncryptionStatus:
    mode: str  # "none" | "aes-256-gcm"
    algorithm: str | None
    key_source: str | None
    note: str


class BlobEncryptor(Protocol):
    """Authenticated encryption interface for quarantine bytes."""

    def encrypt(self, plaintext: bytes, *, aad: bytes | None = None) -> bytes: ...

    def decrypt(self, ciphertext: bytes, *, aad: bytes | None = None) -> bytes: ...


class NullEncryptor:
    """Passthrough — storage is NOT encrypted. Still refuses to hand out encrypted files."""

    def encrypt(self, plaintext: bytes, *, aad: bytes | None = None) -> bytes:
        return plaintext

    def decrypt(self, ciphertext: bytes, *, aad: bytes | None = None) -> bytes:
        if is_encrypted(ciphertext):
            raise RuntimeError(
                "Quarantine file is encrypted but VETMIND_BLOB_KEY / VETMIND_ENCRYPTION_AT_REST "
                "are not set."
            )
        return ciphertext


class AesGcmEncryptor:
    """AES-256-GCM via ``cryptography``; random 96-bit nonce per file."""

    def __init__(self, key: bytes) -> None:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        if len(key) != 32:
            raise ValueError("VETMIND_BLOB_KEY must decode to exactly 32 bytes (AES-256).")
        self._aead = AESGCM(key)

    def encrypt(self, plaintext: bytes, *, aad: bytes | None = None) -> bytes:
        nonce = os.urandom(_NONCE_BYTES)
        return MAGIC + nonce + self._aead.encrypt(nonce, plaintext, aad or _AAD)

    def decrypt(self, ciphertext: bytes, *, aad: bytes | None = None) -> bytes:
        if not is_encrypted(ciphertext):
            return ciphertext  # written before encryption was turned on
        from cryptography.exceptions import InvalidTag

        start = len(MAGIC)
        nonce = ciphertext[start : start + _NONCE_BYTES]
        try:
            return self._aead.decrypt(nonce, ciphertext[start + _NONCE_BYTES :], aad or _AAD)
        except InvalidTag as exc:
            raise ValueError("Quarantine file failed authentication (wrong key or tampered).") from exc


def is_encrypted(data: bytes) -> bool:
    return data[: len(MAGIC)] == MAGIC


def decode_key(raw: str) -> bytes:
    text = (raw or "").strip()
    try:
        key = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except (binascii.Error, ValueError) as exc:
        raise ValueError("VETMIND_BLOB_KEY is not valid base64.") from exc
    if len(key) != 32:
        raise ValueError("VETMIND_BLOB_KEY must decode to exactly 32 bytes (AES-256).")
    return key


def blob_encryptor_from_env() -> BlobEncryptor:
    """The encryptor every QuarantineStore / reader uses, from the environment."""
    mode = (os.environ.get("VETMIND_ENCRYPTION_AT_REST") or "none").strip().lower()
    if mode in ENABLED_MODES:
        return AesGcmEncryptor(decode_key(os.environ.get("VETMIND_BLOB_KEY", "")))
    return NullEncryptor()


def open_blob(data: bytes) -> bytes:
    """Plaintext of bytes read straight from a quarantine file (decrypts when needed)."""
    return blob_encryptor_from_env().decrypt(data) if is_encrypted(data) else data


def encryption_status(mode: str) -> EncryptionStatus:
    normalized = (mode or "none").strip().lower()
    if normalized in ENABLED_MODES:
        return EncryptionStatus(
            mode="aes-256-gcm",
            algorithm="AES-256-GCM",
            key_source="env:VETMIND_BLOB_KEY",
            note="Quarantine files are encrypted on disk (AES-256-GCM, cryptography library).",
        )
    return EncryptionStatus(
        mode="none",
        algorithm=None,
        key_source=None,
        note="Quarantine bytes are stored in plaintext. Set VETMIND_ENCRYPTION_AT_REST=aes-gcm "
        "and VETMIND_BLOB_KEY to encrypt them.",
    )
