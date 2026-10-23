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

# HS256 demo tokens are issuer/audience-bound so stolen/forged payloads are harder to reuse.
JWT_ISSUER = "vetmind"
JWT_AUDIENCE = "vetmind-api"

# Roles that login may put in a JWT. Never issue/accept demo|service via Bearer JWT.
JWT_ISSUABLE_ROLES: frozenset[str] = frozenset({"vet", "expert", "owner", "admin"})
JWT_FORBIDDEN_ROLES: frozenset[str] = frozenset({"demo", "service"})


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
    if role in JWT_FORBIDDEN_ROLES or role not in JWT_ISSUABLE_ROLES:
        raise ValueError(f"Role '{role}' cannot be issued in a VetMind JWT.")
    header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    now = int(time.time())
    payload_obj: dict[str, Any] = {
        "sub": subject,
        "role": role,
        "iat": now,
        "exp": now + ttl_seconds,
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
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
    try:
        payload = json.loads(_b64url_decode(payload_b64))
    except (ValueError, json.JSONDecodeError) as exc:
        raise ValueError("Malformed token payload.") from exc
    if int(payload.get("exp", 0)) < int(time.time()):
        raise ValueError("Token expired.")
    if payload.get("iss") != JWT_ISSUER:
        raise ValueError("Invalid token issuer.")
    if payload.get("aud") != JWT_AUDIENCE:
        raise ValueError("Invalid token audience.")
    role = str(payload.get("role", ""))
    if role in JWT_FORBIDDEN_ROLES or role not in JWT_ISSUABLE_ROLES:
        raise ValueError(f"Role '{role}' is not allowed in Bearer JWT.")
    if not str(payload.get("sub", "")).strip():
        raise ValueError("Token subject missing.")
    return payload


def resolve_jwt_identity(
    payload: dict[str, Any],
    users: dict[str, DemoUserRecord] | None,
) -> tuple[str, str, str | None]:
    """Bind subject → role/clinic from the seed directory when known.

    Prevents privilege escalation via manipulated ``role`` / ``clinic_id`` claims
    for demo users. Unknown subjects are rejected (demo IdP has no open signup).
    """
    subject = str(payload.get("sub", "")).strip().lower()
    if not subject:
        raise ValueError("Token subject missing.")
    directory = users if users is not None else DEMO_USERS
    record = directory.get(subject)
    if record is None:
        raise ValueError("Unknown token subject.")
    if record.role not in JWT_ISSUABLE_ROLES or record.role in JWT_FORBIDDEN_ROLES:
        raise ValueError("Seed user role is not JWT-issuable.")
    return subject, record.role, record.clinic_id


def verify_api_key(provided: str | None, expected: str | None) -> bool:
    if not expected or not provided:
        return False
    return hmac.compare_digest(provided.strip(), expected.strip())
