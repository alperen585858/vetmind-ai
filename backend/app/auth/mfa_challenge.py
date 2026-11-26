"""Short-lived ticket between the password step and the code step (issue #107).

Format ``mfa.<payload>.<sig>``: it is deliberately *not* a JWT, so the bearer check rejects
it and the ticket alone opens no API. Valid 5 minutes, single use (remembered per process),
and void when the password changes (token_version).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import threading
import time

TTL_SECONDS = 5 * 60
_PREFIX = "mfa"


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


class MfaChallengeError(ValueError):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class MfaChallenges:
    def __init__(self, secret: str, *, ttl_seconds: int = TTL_SECONDS, clock=time.time) -> None:
        # Separate key from the JWT key (same secret, different purpose label).
        self._key = hashlib.sha256(f"vetmind-mfa-challenge|{secret}".encode()).digest()
        self._ttl = ttl_seconds
        self._clock = clock
        self._used: dict[str, float] = {}
        self._lock = threading.Lock()

    @property
    def ttl_seconds(self) -> int:
        return self._ttl

    def issue(self, subject: str, token_version: int) -> str:
        payload = _b64(
            json.dumps(
                {"sub": subject, "tv": token_version, "exp": int(self._clock()) + self._ttl, "jti": secrets.token_hex(12)},
                separators=(",", ":"),
            ).encode()
        )
        sig = _b64(hmac.new(self._key, f"{_PREFIX}.{payload}".encode(), hashlib.sha256).digest())
        return f"{_PREFIX}.{payload}.{sig}"

    def peek(self, ticket: str) -> dict:
        """Validate without consuming (a wrong code keeps the ticket usable until it expires)."""
        try:
            prefix, payload, sig = ticket.split(".")
        except ValueError as exc:
            raise MfaChallengeError("malformed") from exc
        expected = _b64(hmac.new(self._key, f"{prefix}.{payload}".encode(), hashlib.sha256).digest())
        if prefix != _PREFIX or not hmac.compare_digest(expected, sig):
            raise MfaChallengeError("bad_signature")
        data = json.loads(_unb64(payload))
        if int(data.get("exp", 0)) < int(self._clock()):
            raise MfaChallengeError("expired")
        with self._lock:
            if data.get("jti") in self._used:
                raise MfaChallengeError("used")
        return data

    def consume(self, ticket: str) -> dict:
        data = self.peek(ticket)
        now = self._clock()
        with self._lock:
            if data["jti"] in self._used:
                raise MfaChallengeError("used")
            self._used[data["jti"]] = now + self._ttl
            for jti, until in list(self._used.items()):
                if until < now:
                    del self._used[jti]
        return data
