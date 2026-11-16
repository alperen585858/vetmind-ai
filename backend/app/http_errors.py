"""Stable API error payloads for client i18n.

FastAPI ``HTTPException.detail`` may be a string (legacy) or a dict:

    {"code": "invalid_credentials", "message": "Invalid email or password.", ...}

The frontend maps ``code`` to locale strings and keeps ``message`` as technical detail.
"""

from __future__ import annotations

from typing import Any


def api_error(code: str, message: str, **extra: Any) -> dict[str, Any]:
    """Build a structured error detail for ``HTTPException``."""
    payload: dict[str, Any] = {"code": code, "message": message}
    for key, value in extra.items():
        if value is not None:
            payload[key] = value
    return payload
