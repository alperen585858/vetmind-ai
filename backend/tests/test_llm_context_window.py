"""#129: a prompt that does not fit the model's context window is never cut silently."""

from __future__ import annotations

import logging
from dataclasses import replace

import httpx
import pytest

from app.llm.chat_providers import OpenAICompatibleProvider, estimate_prompt_tokens
from app.llm.factory import build_llm_provider
from app.settings import load_settings

SCHEMA = {"type": "object", "properties": {}, "additionalProperties": True}


def _provider(prompt_tokens: int | None, context_tokens: int = 4096) -> OpenAICompatibleProvider:
    def handler(_req: httpx.Request) -> httpx.Response:
        body: dict = {"choices": [{"message": {"role": "assistant", "content": "{}"}, "finish_reason": "stop"}]}
        if prompt_tokens is not None:
            body["usage"] = {"prompt_tokens": prompt_tokens, "completion_tokens": 5}
        return httpx.Response(200, json=body)

    return OpenAICompatibleProvider(
        model_id="qwen", base_url="http://ollama.test/v1", max_tokens=1024,
        context_tokens=context_tokens, transport=httpx.MockTransport(handler),
    )


def test_prompt_that_fits_gives_no_warning(caplog: pytest.LogCaptureFixture) -> None:
    p = _provider(prompt_tokens=400)
    with caplog.at_level(logging.WARNING):
        p._complete("system " * 100, "user " * 150, SCHEMA)
    assert p.last_context_warning is None
    assert "context" not in caplog.text


def test_too_long_prompt_is_logged(caplog: pytest.LogCaptureFixture) -> None:
    p = _provider(prompt_tokens=None)
    with caplog.at_level(logging.WARNING):
        p._complete("S" * 3000, "U" * 30_000, SCHEMA)  # ~11 000 tokens > 4096
    assert p.last_context_warning == "too_long"
    assert "OLLAMA_CONTEXT_LENGTH" in caplog.text


def test_server_side_truncation_is_detected(caplog: pytest.LogCaptureFixture) -> None:
    system, user = "S" * 2000, "U" * 6000
    assert estimate_prompt_tokens(system, user) > 2500
    p = _provider(prompt_tokens=900, context_tokens=32_000)  # server read far less than sent
    with caplog.at_level(logging.WARNING):
        p._complete(system, user, SCHEMA)
    assert p.last_context_warning == "truncated"
    assert "truncated" in caplog.text


def test_no_check_without_a_context_size() -> None:
    p = _provider(prompt_tokens=10, context_tokens=0)
    p._complete("S" * 3000, "U" * 30_000, SCHEMA)
    assert p.last_context_warning is None


def test_factory_uses_ollama_default_and_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    base = replace(load_settings(), llm_provider="ollama", llm_model_id="qwen2.5:7b")
    assert build_llm_provider(base)._context_tokens == 4096
    assert build_llm_provider(replace(base, llm_context_tokens=16384))._context_tokens == 16384
    monkeypatch.setenv("VETMIND_LLM_CONTEXT_TOKENS", "8192")
    assert load_settings().llm_context_tokens == 8192
