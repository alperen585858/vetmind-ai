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


# Generic codes for errors raised with a plain-text detail (#85). Specific codes come
# from ``api_error``; the frontend translates both.
STATUS_CODES: dict[int, str] = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    410: "gone",
    413: "payload_too_large",
    415: "unsupported_media_type",
    422: "unprocessable",
    429: "rate_limited",
    500: "server",
    502: "upstream_error",
    503: "unavailable",
    504: "upstream_timeout",
}


def normalize_detail(status_code: int, detail: Any) -> dict[str, Any]:
    """Every error body becomes ``{"code": ..., "message": ..., ...extra}``."""
    if isinstance(detail, dict):
        payload = dict(detail)
        payload.setdefault("code", STATUS_CODES.get(status_code, "error"))
        if "message" not in payload:
            payload["message"] = str(detail.get("detail") or STATUS_CODES.get(status_code, "Error"))
        return payload
    message = str(detail) if detail is not None else ""
    return {"code": STATUS_CODES.get(status_code, "error"), "message": message}


def validation_detail(errors: list[dict[str, Any]]) -> dict[str, Any]:
    """FastAPI 422 list → one ``validation_error`` payload with the offending fields."""
    fields = []
    messages = []
    for err in errors:
        loc = [str(p) for p in err.get("loc", ()) if p not in {"body", "query", "path"}]
        msg = str(err.get("msg", ""))
        fields.append({"field": ".".join(loc), "message": msg, "type": err.get("type")})
        messages.append(f"{'.'.join(loc)}: {msg}" if loc else msg)
    return {
        "code": "validation_error",
        "message": "; ".join(messages) or "Request validation failed.",
        "count": len(fields),
        "fields": fields,
    }
