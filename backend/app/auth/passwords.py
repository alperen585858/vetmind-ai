"""Password hashing for stored user credentials (stdlib scrypt, no extra dependency).

Stored format::

    scrypt$<n>$<r>$<p>$<salt_b64>$<hash_b64>

scrypt is a memory-hard KDF (RFC 7914). Parameters follow the common interactive-login
baseline (n=2**14, r=8, p=1 → ~16 MiB, tens of milliseconds per hash).

Plaintext passwords are never persisted. ``verify_password`` still accepts a non-hash
``stored`` value so the public demo seed (``DEMO_USERS`` in ``security.py``) keeps working
before it is hashed; that comparison is constant-time.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

SCHEME = "scrypt"
_N = 2**14
_R = 8
_P = 1
_SALT_BYTES = 16
_KEY_BYTES = 32
# 128 * r * n bytes are needed; leave headroom over the 16 MiB working set.
_MAXMEM = 64 * 1024 * 1024


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _unb64(data: str) -> bytes:
    return base64.b64decode(data.encode("ascii"), validate=True)


def _derive(password: str, salt: bytes, n: int, r: int, p: int, dklen: int) -> bytes:
    return hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=n, r=r, p=p, maxmem=_MAXMEM, dklen=dklen
    )


def hash_password(password: str) -> str:
    """Return a salted scrypt hash string for ``password``."""
    if not isinstance(password, str) or not password:
        raise ValueError("Password must be a non-empty string.")
    salt = secrets.token_bytes(_SALT_BYTES)
    key = _derive(password, salt, _N, _R, _P, _KEY_BYTES)
    return f"{SCHEME}${_N}${_R}${_P}${_b64(salt)}${_b64(key)}"


def is_password_hash(value: str | None) -> bool:
    """True when ``value`` looks like a hash produced by :func:`hash_password`."""
    if not value or not value.startswith(f"{SCHEME}$"):
        return False
    return len(value.split("$")) == 6


def verify_password(provided: str, stored: str | None) -> bool:
    """Check ``provided`` against a stored hash (or the legacy demo plaintext seed)."""
    if not stored or not isinstance(provided, str):
        return False
    if not is_password_hash(stored):
        return hmac.compare_digest(provided.encode("utf-8"), stored.encode("utf-8"))
    try:
        _, n, r, p, salt_b64, key_b64 = stored.split("$")
        salt = _unb64(salt_b64)
        expected = _unb64(key_b64)
        actual = _derive(provided, salt, int(n), int(r), int(p), len(expected))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def needs_rehash(stored: str | None) -> bool:
    """True when ``stored`` is plaintext or uses weaker parameters than today's default."""
    if not is_password_hash(stored):
        return True
    _, n, r, p, _salt, _key = (stored or "").split("$")
    try:
        return (int(n), int(r), int(p)) != (_N, _R, _P)
    except ValueError:
        return True
