"""Real LLM providers: OpenAI-compatible Chat Completions and Anthropic Messages.

"OpenAI-compatible" covers OpenAI itself plus self-hosted servers that speak the same
API (vLLM, Ollama, LM Studio) and gateways such as OpenRouter or Groq.

Both providers share one prompt (``app.llm.prompts``) and one output parser
(``app.llm.structured_output``), so drafts are comparable across vendors.
No network I/O at construction; POSTs are never retried (see ``app.http_policy``).
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from app.http_policy import llm_http_policy
from app.llm.interfaces import (
    LLMConfigError,
    LLMErrorKind,
    LLMMalformedResponseError,
    LLMProviderError,
    LLMRequest,
    LLMResponse,
    LLMTimeoutError,
    LLMUnavailableError,
)
from app.llm.prompts import (
    PROMPT_VERSION,
    PROMPT_VERSIONS,
    build_aliases,
    build_system_prompt,
    build_user_prompt,
    wants_differentials,
)
from app.llm.structured_output import build_draft_report, parse_report_payload, report_json_schema

OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1"
OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434/v1"
ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/v1"
ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-5-5"
ANTHROPIC_API_VERSION = "2023-06-01"

JSON_MODES = ("schema", "object", "none")
REPORT_TOOL_NAME = "submit_draft_report"


def _error_detail(res: httpx.Response) -> str:
    """Vendor error message without echoing request content or credentials."""
    try:
        body = res.json()
    except ValueError:
        return ""
    err = body.get("error") if isinstance(body, dict) else None
    msg = err.get("message") if isinstance(err, dict) else err
    return f": {str(msg)[:200]}" if msg else ""


class _ChatProviderBase:
    provider_id: str
    model_id: str
    model_version: str

    def __init__(
        self,
        *,
        model_id: str,
        base_url: str,
        api_key: str | None = None,
        provider_id: str,
        model_version: str | None = None,
        timeout_s: float = 60.0,
        language: str = "tr",
        temperature: float | None = 0.2,
        max_tokens: int = 2048,
        prompt_version: str = PROMPT_VERSION,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if prompt_version not in PROMPT_VERSIONS:
            raise LLMConfigError(f"Unknown prompt version {prompt_version!r}. Allowed: {', '.join(PROMPT_VERSIONS)}.")
        self.provider_id = provider_id
        self.model_id = model_id
        self.model_version = model_version or model_id
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout_s = timeout_s
        self._language = language
        self._temperature = temperature
        self._max_tokens = max_tokens
        self._prompt_version = prompt_version
        self._schema = report_json_schema(wants_differentials(prompt_version))
        self._transport = transport

    def generate(self, request: LLMRequest) -> LLMResponse:
        aliases = build_aliases(request.generation)
        system = build_system_prompt(self._language, self._prompt_version)
        user = build_user_prompt(request.generation, aliases, instructions=request.instructions)
        payload, raw_text = self._complete(system, user)
        wire = parse_report_payload(payload)
        if not wants_differentials(self._prompt_version):
            wire.differentials = []
        report = build_draft_report(
            wire,
            request,
            aliases,
            provider_id=self.provider_id,
            model_id=self.model_id,
            model_version=self.model_version,
            prompt_version=self._prompt_version,
            language=self._language,
        )
        return LLMResponse(
            provider_id=self.provider_id,
            model_id=self.model_id,
            model_version=self.model_version,
            report=report,
            raw_text=raw_text,
        )

    def _complete(self, system: str, user: str) -> tuple[str | dict[str, Any], str]:
        """Return (payload for the parser, raw text kept for audit)."""
        raise NotImplementedError

    def _post(self, url: str, payload: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
        policy = llm_http_policy(self._timeout_s)
        timeout = httpx.Timeout(policy.timeout_s, connect=min(5.0, policy.timeout_s))
        try:
            with httpx.Client(timeout=timeout, transport=self._transport) as client:
                res = client.post(url, json=payload, headers=headers)
        except httpx.TimeoutException as exc:
            raise LLMTimeoutError(f"LLM provider timed out after {policy.timeout_s}s.") from exc
        except httpx.HTTPError as exc:
            raise LLMUnavailableError(f"LLM provider unavailable: {type(exc).__name__}") from exc

        if res.status_code in (401, 403):
            raise LLMConfigError(
                f"LLM provider rejected the credentials (HTTP {res.status_code}). "
                "Check VETMIND_LLM_API_KEY."
            )
        if res.status_code == 429:
            raise LLMUnavailableError(f"LLM provider rate limit reached (HTTP 429){_error_detail(res)}.")
        if res.status_code >= 500:
            raise LLMUnavailableError(f"LLM provider returned HTTP {res.status_code}.")
        if res.status_code >= 400:
            raise LLMProviderError(
                f"LLM provider returned HTTP {res.status_code}{_error_detail(res)}",
                kind=LLMErrorKind.UNAVAILABLE,
            )
        try:
            body = res.json()
        except ValueError as exc:
            raise LLMMalformedResponseError("LLM provider response is not JSON.") from exc
        if not isinstance(body, dict):
            raise LLMMalformedResponseError("LLM provider response JSON must be an object.")
        return body


class OpenAICompatibleProvider(_ChatProviderBase):
    """POST {base_url}/chat/completions with JSON output enforcement."""

    def __init__(self, *, json_mode: str = "schema", **kwargs: Any) -> None:
        kwargs.setdefault("provider_id", "openai-compatible")
        kwargs.setdefault("base_url", OPENAI_DEFAULT_BASE_URL)
        super().__init__(**kwargs)
        if json_mode not in JSON_MODES:
            raise LLMConfigError(f"llm_json_mode must be one of {', '.join(JSON_MODES)}.")
        self._json_mode = json_mode

    def _complete(self, system: str, user: str) -> tuple[str | dict[str, Any], str]:
        payload: dict[str, Any] = {
            "model": self.model_id,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "max_tokens": self._max_tokens,
        }
        if self._temperature is not None:
            payload["temperature"] = self._temperature
        if self._json_mode == "schema":
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "vetmind_draft_report", "strict": True, "schema": self._schema},
            }
        elif self._json_mode == "object":
            payload["response_format"] = {"type": "json_object"}

        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        body = self._post(f"{self._base_url}/chat/completions", payload, headers)

        try:
            choice = body["choices"][0]
            content = choice["message"].get("content")
        except (KeyError, IndexError, TypeError, AttributeError) as exc:
            raise LLMMalformedResponseError("Chat completion has no choices[0].message.") from exc
        if choice.get("finish_reason") == "length":
            raise LLMMalformedResponseError(
                "LLM output was cut off (finish_reason=length). Increase VETMIND_LLM_MAX_TOKENS."
            )
        if not isinstance(content, str) or not content.strip():
            raise LLMMalformedResponseError("Chat completion returned empty content (refusal?).")
        return content, content


class AnthropicProvider(_ChatProviderBase):
    """POST {base_url}/messages, forcing a tool call so the output is schema-shaped."""

    def __init__(self, **kwargs: Any) -> None:
        kwargs.setdefault("provider_id", "anthropic")
        kwargs.setdefault("base_url", ANTHROPIC_DEFAULT_BASE_URL)
        kwargs.setdefault("model_id", ANTHROPIC_DEFAULT_MODEL)
        super().__init__(**kwargs)

    def _complete(self, system: str, user: str) -> tuple[str | dict[str, Any], str]:
        payload: dict[str, Any] = {
            "model": self.model_id,
            "max_tokens": self._max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
            "tools": [
                {
                    "name": REPORT_TOOL_NAME,
                    "description": "Submit the structured veterinary imaging draft report.",
                    "input_schema": self._schema,
                }
            ],
            "tool_choice": {"type": "tool", "name": REPORT_TOOL_NAME},
        }
        if self._temperature is not None:
            payload["temperature"] = self._temperature
        headers = {
            "Content-Type": "application/json",
            "anthropic-version": ANTHROPIC_API_VERSION,
        }
        if self._api_key:
            headers["x-api-key"] = self._api_key
        body = self._post(f"{self._base_url}/messages", payload, headers)

        if body.get("stop_reason") == "max_tokens":
            raise LLMMalformedResponseError(
                "LLM output was cut off (stop_reason=max_tokens). Increase VETMIND_LLM_MAX_TOKENS."
            )
        blocks = body.get("content")
        if not isinstance(blocks, list):
            raise LLMMalformedResponseError("Anthropic response has no content blocks.")
        for block in blocks:
            if isinstance(block, dict) and block.get("type") == "tool_use" and block.get("name") == REPORT_TOOL_NAME:
                tool_input = block.get("input")
                if not isinstance(tool_input, dict):
                    break
                return tool_input, json.dumps(tool_input, ensure_ascii=False)
        # Some gateways ignore tool_choice; fall back to parsing a text block.
        text = "".join(
            b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "text"
        )
        if text.strip():
            return text, text
        raise LLMMalformedResponseError("Anthropic response contains no report tool call.")
