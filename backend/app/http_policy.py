"""Shared HTTP client policy for Vision/LLM adapters.

POSTs are never auto-retried (non-idempotent model calls).
Timeouts are explicit. No silent mock fallback lives here.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class HttpClientPolicy:
    timeout_s: float = 30.0
    # Safe retries only for idempotent GETs if callers use them later.
    get_max_retries: int = 0
    post_max_retries: int = 0  # always 0 for model inference POSTs
    note: str = (
        "Vision/LLM POST must not auto-retry. Timeouts surface as typed adapter/provider errors."
    )


def vision_http_policy(timeout_s: float) -> HttpClientPolicy:
    return HttpClientPolicy(timeout_s=max(1.0, float(timeout_s)), post_max_retries=0)


def llm_http_policy(timeout_s: float) -> HttpClientPolicy:
    return HttpClientPolicy(timeout_s=max(1.0, float(timeout_s)), post_max_retries=0)
