"""Lightweight auth helpers — HS256 JWT + static API key.

Not a full identity provider. Demo users are hardcoded when auth is enabled.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Any


DEFAULT_JWT_SECRET = "vetmind-demo-secret-change-me"


@dataclass(frozen=True)
class DemoUserRecord:
    password: str
    role: str
    clinic_id: str | None = None


@dataclass(frozen=True)
class AuthSettings:
    enabled: bool
    api_key: str | None
    jwt_secret: str
    jwt_ttl_seconds: int = 60 * 60 * 12
    users: dict[str, DemoUserRecord] | None = None
    tenant_isolation: bool = False
    deployment_mode: str = "demo"  # demo | protected


# Seed users for local / CI demos. Passwords are demo-only; not a production IdP.
DEMO_USERS: dict[str, DemoUserRecord] = {
    "vet@demo.local": DemoUserRecord("demo1234", "vet", "clinic-demo-a"),
    "vet-b@demo.local": DemoUserRecord("demo1234", "vet", "clinic-demo-b"),
    "expert@demo.local": DemoUserRecord("demo1234", "expert", "clinic-demo-a"),
    "expert-b@demo.local": DemoUserRecord("demo1234", "expert", "clinic-demo-b"),
    "admin@demo.local": DemoUserRecord("demo1234", "admin", None),
    "owner@demo.local": DemoUserRecord("demo1234", "owner", "clinic-demo-a"),
}


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def verify_password(provided: str, expected: str) -> bool:
    """Constant-time string compare for demo plaintext passwords."""
    return hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8"))


def create_access_token(
    *,
    subject: str,
    role: str,
    secret: str,
    ttl_seconds: int,
    clinic_id: str | None = None,
) -> str:
    header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    now = int(time.time())
    payload_obj: dict[str, Any] = {
        "sub": subject,
        "role": role,
        "iat": now,
        "exp": now + ttl_seconds,
    }
    if clinic_id:
        payload_obj["clinic_id"] = clinic_id
    payload = _b64url(json.dumps(payload_obj, separators=(",", ":")).encode())
    signing_input = f"{header}.{payload}".encode()
    sig = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
    return f"{header}.{payload}.{_b64url(sig)}"


def decode_token(token: str, secret: str) -> dict[str, Any]:
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
    except ValueError as exc:
        raise ValueError("Malformed token.") from exc
    try:
        header = json.loads(_b64url_decode(header_b64))
    except (ValueError, json.JSONDecodeError) as exc:
        raise ValueError("Malformed token header.") from exc
    if header.get("alg") != "HS256":
        raise ValueError("Unsupported token algorithm.")
    signing_input = f"{header_b64}.{payload_b64}".encode()
    expected = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, _b64url_decode(sig_b64)):
        raise ValueError("Invalid token signature.")
    payload = json.loads(_b64url_decode(payload_b64))
    if int(payload.get("exp", 0)) < int(time.time()):
        raise ValueError("Token expired.")
    return payload


def verify_api_key(provided: str | None, expected: str | None) -> bool:
    if not expected or not provided:
        return False
    return hmac.compare_digest(provided.strip(), expected.strip())
