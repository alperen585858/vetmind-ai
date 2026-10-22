"""Build LLMProvider instances from settings. No network I/O at construction."""

from __future__ import annotations

from app.llm.http_provider import HttpLLMProvider
from app.llm.interfaces import LLMConfigError, LLMProvider
from app.llm.mock_provider import MockLLMProvider
from app.llm.stub_provider import DeterministicStubLLMProvider
from app.settings import Settings


def build_llm_provider(settings: Settings) -> LLMProvider:
    """Select mock (default), stub, or generic HTTP provider from configuration."""
    kind = (settings.llm_provider or "mock").strip().lower()
    if kind in {"mock", "mock-llm"}:
        return MockLLMProvider()
    if kind in {"stub", "stub-llm", "deterministic"}:
        return DeterministicStubLLMProvider()
    if kind in {"http", "http-llm"}:
        endpoint = (settings.llm_endpoint or "").strip()
        if not endpoint:
            raise LLMConfigError(
                "llm_provider=http requires llm_endpoint (VETMIND_LLM_ENDPOINT)."
            )
        if not endpoint.startswith(("http://", "https://")):
            raise LLMConfigError("llm_endpoint must be an http(s) URL.")
        provider_id = (settings.llm_provider_id or "").strip()
        model_id = (settings.llm_model_id or "").strip()
        model_version = (settings.llm_model_version or "").strip()
        if not provider_id:
            raise LLMConfigError("llm_provider_id must be non-empty for http provider.")
        if not model_id:
            raise LLMConfigError("llm_model_id must be non-empty for http provider.")
        if not model_version:
            raise LLMConfigError("llm_model_version must be non-empty for http provider.")
        timeout = float(settings.llm_timeout_s)
        if timeout <= 0:
            raise LLMConfigError("llm_timeout_s must be > 0.")
        # Construct only — do not probe the endpoint at startup.
        return HttpLLMProvider(
            endpoint=endpoint,
            provider_id=provider_id,
            model_id=model_id,
            model_version=model_version,
            api_key=settings.llm_api_key,
            timeout_s=timeout,
        )
    raise LLMConfigError(
        f"Unknown llm_provider={settings.llm_provider!r}. Allowed: mock, stub, http."
    )
