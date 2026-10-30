"""Build LLMProvider instances from settings. No network I/O at construction."""

from __future__ import annotations

from app.llm.chat_providers import (
    OLLAMA_DEFAULT_BASE_URL,
    OPENAI_DEFAULT_BASE_URL,
    AnthropicProvider,
    OpenAICompatibleProvider,
)
from app.llm.http_provider import HttpLLMProvider
from app.llm.interfaces import LLMConfigError, LLMProvider
from app.llm.mock_provider import MockLLMProvider
from app.llm.stub_provider import DeterministicStubLLMProvider
from app.settings import Settings

# Settings defaults that mean "not configured" for the chat providers below.
_DEFAULT_PROVIDER_ID = "http-llm"
_DEFAULT_MODEL_ID = "generic-http-llm"
_DEFAULT_MODEL_VERSION = "0.1.0"

OPENAI_KINDS = {"openai", "openai-compatible", "vllm", "openrouter", "groq", "lmstudio"}
OLLAMA_KINDS = {"ollama"}
ANTHROPIC_KINDS = {"anthropic", "claude"}


def _build_chat_provider(kind: str, settings: Settings) -> LLMProvider:
    endpoint = (settings.llm_endpoint or "").strip()
    if endpoint and not endpoint.startswith(("http://", "https://")):
        raise LLMConfigError("llm_endpoint must be an http(s) URL.")
    model_id = (settings.llm_model_id or "").strip()
    model_id = "" if model_id == _DEFAULT_MODEL_ID else model_id
    provider_id = (settings.llm_provider_id or "").strip()
    provider_id = kind if provider_id in {"", _DEFAULT_PROVIDER_ID} else provider_id
    version = (settings.llm_model_version or "").strip()
    timeout = float(settings.llm_timeout_s)
    if timeout <= 0:
        raise LLMConfigError("llm_timeout_s must be > 0.")
    common = dict(
        api_key=settings.llm_api_key,
        provider_id=provider_id,
        model_version=None if version in {"", _DEFAULT_MODEL_VERSION} else version,
        timeout_s=timeout,
        language=settings.llm_report_language,
        temperature=settings.llm_temperature,
        max_tokens=settings.llm_max_tokens,
        prompt_version=settings.llm_prompt_version,
        verify=settings.llm_verify,
        verifier_model_id=settings.llm_verifier_model_id,
    )

    if kind in ANTHROPIC_KINDS:
        if not settings.llm_api_key:
            raise LLMConfigError("llm_provider=anthropic requires VETMIND_LLM_API_KEY.")
        extra = {"model_id": model_id} if model_id else {}
        if endpoint:
            extra["base_url"] = endpoint
        return AnthropicProvider(**common, **extra)

    if not model_id:
        raise LLMConfigError(
            f"llm_provider={kind} requires VETMIND_LLM_MODEL_ID (e.g. the model name on that server)."
        )
    if kind in OLLAMA_KINDS:
        base_url = endpoint or OLLAMA_DEFAULT_BASE_URL
    else:
        base_url = endpoint or OPENAI_DEFAULT_BASE_URL
        if base_url == OPENAI_DEFAULT_BASE_URL and not settings.llm_api_key:
            raise LLMConfigError("OpenAI API requires VETMIND_LLM_API_KEY.")
    return OpenAICompatibleProvider(
        **common, model_id=model_id, base_url=base_url, json_mode=settings.llm_json_mode
    )


def build_llm_provider(settings: Settings) -> LLMProvider:
    """Select mock (default), stub, generic HTTP, or a real chat LLM provider."""
    kind = (settings.llm_provider or "mock").strip().lower()
    if kind in OPENAI_KINDS | OLLAMA_KINDS | ANTHROPIC_KINDS:
        return _build_chat_provider(kind, settings)
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
        f"Unknown llm_provider={settings.llm_provider!r}. "
        "Allowed: mock, stub, http, openai, ollama, anthropic."
    )
