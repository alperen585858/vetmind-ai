"""Redact patient-identifying patterns from logs and error surfaces."""

from __future__ import annotations

import re

# Conservative patterns — avoid logging obvious PHI-adjacent fields.
_PATIENT_KEY = re.compile(
    r"(patient[_ ]?name|patient[_ ]?id|owner[_ ]?name)\s*[:=]\s*['\"]?[^'\"\s,]+",
    re.IGNORECASE,
)
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_BEARER = re.compile(r"(Bearer\s+)[A-Za-z0-9\-._~+/]+=*", re.IGNORECASE)
_API_KEY = re.compile(r"(api[_-]?key\s*[:=]\s*)\S+", re.IGNORECASE)


def redact_text(value: str | None) -> str:
    if not value:
        return ""
    text = str(value)
    text = _BEARER.sub(r"\1[REDACTED]", text)
    text = _API_KEY.sub(r"\1[REDACTED]", text)
    text = _EMAIL.sub("[REDACTED_EMAIL]", text)
    text = _PATIENT_KEY.sub(r"\1=[REDACTED]", text)
    return text


def safe_error_detail(detail: object, *, expose_detail: bool) -> object:
    """In protected mode, avoid echoing raw internals to clients."""
    if expose_detail:
        return detail
    if isinstance(detail, dict):
        return {"message": "Request could not be completed.", "code": "request_failed"}
    return "Request could not be completed."
