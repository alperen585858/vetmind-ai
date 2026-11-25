"""Time-based one-time passwords, RFC 6238 (issue #107).

SHA-1, 6 digits, 30-second steps: what Google / Microsoft Authenticator expect. Standard
library only (``hmac``); the same algorithm the authenticator app runs.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote, urlencode

DIGITS = 6
STEP_SECONDS = 30
# Accept the previous and next step too (phone clock a little off).
DRIFT_STEPS = 1
ISSUER = "VetMind"


def generate_secret() -> str:
    """160 random bits as base32 (what authenticator apps scan), no padding."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _key(secret_b32: str) -> bytes:
    cleaned = secret_b32.replace(" ", "").upper()
    return base64.b32decode(cleaned + "=" * (-len(cleaned) % 8))


def code_at(secret_b32: str, step: int) -> str:
    digest = hmac.new(_key(secret_b32), struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = (struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF) % (10**DIGITS)
    return f"{value:0{DIGITS}d}"


def current_step(now: float | None = None) -> int:
    return int((time.time() if now is None else now) // STEP_SECONDS)


def verify(secret_b32: str, code: str, *, now: float | None = None, last_used_step: int | None = None) -> int | None:
    """Return the matched step, or None. A step at or before ``last_used_step`` is refused,
    so one code cannot be replayed (even by a second request in the same 30 seconds)."""
    code = "".join(ch for ch in (code or "") if ch.isdigit())
    if len(code) != DIGITS:
        return None
    step = current_step(now)
    for candidate in range(step - DRIFT_STEPS, step + DRIFT_STEPS + 1):
        if last_used_step is not None and candidate <= last_used_step:
            continue
        if hmac.compare_digest(code_at(secret_b32, candidate), code):
            return candidate
    return None


def otpauth_uri(secret_b32: str, account: str) -> str:
    label = quote(f"{ISSUER}:{account}")
    query = urlencode({"secret": secret_b32, "issuer": ISSUER, "algorithm": "SHA1", "digits": DIGITS, "period": STEP_SECONDS})
    return f"otpauth://totp/{label}?{query}"
