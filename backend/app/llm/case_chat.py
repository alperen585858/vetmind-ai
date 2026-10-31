"""Free-text Q&A over a case for radiologists (ChatGPT-style).

Uses the configured chat LLM when available; mock/stub return a deterministic
Turkish reply from findings/draft. Personal data is redacted before the model.
Not clinical advice — draft assistant only.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.http_policy import llm_http_policy
from app.llm.chat_providers import OLLAMA_DEFAULT_BASE_URL, OPENAI_DEFAULT_BASE_URL
from app.llm.interfaces import (
    LLMConfigError,
    LLMMalformedResponseError,
    LLMProviderError,
    LLMTimeoutError,
    LLMUnavailableError,
)
from app.llm.privacy import redact_personal_data
from app.schemas.case import AiChatTurn, CaseRecord
from app.settings import Settings

_SYSTEM_TR = """Sen VetMind AI vaka asistanısın. Veteriner radyologa yardımcı olursun.
Kurallar:
- Yalnızca verilen vaka bağlamını (öykü, bulgular, taslak rapor) kullan.
- Bulgu uydurma; emin değilsen belirsizliği söyle.
- Türkçe, kısa ve net cevap ver.
- Klinik karar / kesin tanı iddiası kurma; bu bir taslak yardımcıdır.
- Hasta/sahip kimliği yok; maskelenmiş metin görebilirsin."""


def _case_context_block(case: CaseRecord) -> str:
    redacted = redact_personal_data(
        case.clinical_history or "",
        known=[(case.patient_name, "[HASTA]"), (case.referring_clinic, "[KLİNİK]")],
    )
    lines = [
        f"Vaka: {case.case_id}",
        f"Tür: {case.species.value} · Irk: {case.breed or '—'} · Yaş: {case.patient_age_years or '—'}",
        f"Modalite: {case.modality.value} · Bölge: {case.anatomical_region.value}",
        f"Durum: {case.status.value}",
        f"Öykü (maskeli): {redacted.text or '—'}",
    ]
    findings = case.structured_findings
    if findings is None or not findings.findings:
        lines.append("Bulgular: (yok veya henüz üretilmedi)")
    else:
        lines.append("Bulgular:")
        for i, f in enumerate(findings.findings[:20], start=1):
            lines.append(
                f"  [F{i}] {f.finding_code}: {f.description} @ {f.anatomical_location} ({f.finding_status.value})"
            )
    draft = case.draft_report
    if draft is not None:
        lines.append("Mevcut taslak:")
        lines.append(f"  Teknik: {draft.technique.text}")
        lines.append(f"  Bulgular: {draft.findings.text}")
        lines.append(f"  Yorum: {draft.impression.text}")
        lines.append(f"  Öneriler: {draft.recommendations.text}")
    else:
        lines.append("Mevcut taslak: (yok)")
    return "\n".join(lines)


def _mock_reply(case: CaseRecord, question: str) -> str:
    n = len(case.structured_findings.findings) if case.structured_findings else 0
    has_draft = case.draft_report is not None
    return (
        f"(Sahte asistan — gerçek model için `npm run backend:dev:ai`)\n\n"
        f"Sorunuz: {question.strip()[:200]}\n\n"
        f"Bu vakada şu an {n} yapılandırılmış bulgu "
        f"{'ve bir taslak rapor' if has_draft else 'ama henüz taslak yok'} var. "
        f"Gerçek Ollama/OpenAI bağlantısında bu soruya vaka bağlamıyla yanıt verilir. "
        f"Klinik karar için uzman incelemesi zorunludur."
    )


def _openai_compatible_chat(
    *,
    base_url: str,
    model_id: str,
    api_key: str | None,
    timeout_s: float,
    temperature: float | None,
    max_tokens: int,
    messages: list[dict[str, str]],
) -> str:
    payload: dict[str, Any] = {
        "model": model_id,
        "messages": messages,
        "max_tokens": max(256, min(max_tokens, 2048)),
    }
    if temperature is not None:
        payload["temperature"] = temperature
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    policy = llm_http_policy(timeout_s)
    timeout = httpx.Timeout(policy.timeout_s, connect=min(5.0, policy.timeout_s))
    url = f"{base_url.rstrip('/')}/chat/completions"
    try:
        with httpx.Client(timeout=timeout) as client:
            res = client.post(url, json=payload, headers=headers)
    except httpx.TimeoutException as exc:
        raise LLMTimeoutError(f"LLM chat timed out after {policy.timeout_s}s.") from exc
    except httpx.HTTPError as exc:
        raise LLMUnavailableError(f"LLM chat unavailable: {type(exc).__name__}") from exc
    if res.status_code >= 400:
        raise LLMUnavailableError(f"LLM chat HTTP {res.status_code}")
    try:
        body = res.json()
        content = body["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise LLMMalformedResponseError("LLM chat returned unexpected JSON.") from exc
    if not isinstance(content, str) or not content.strip():
        raise LLMMalformedResponseError("LLM chat returned empty content.")
    return content.strip()


def answer_case_question(
    case: CaseRecord,
    question: str,
    history: list[AiChatTurn],
    settings: Settings,
) -> tuple[str, str]:
    """Return (reply_text, provider_label)."""
    kind = (settings.llm_provider or "mock").strip().lower()
    q = question.strip()
    if not q:
        raise LLMConfigError("Empty question.")

    if kind in {"mock", "mock-llm", "stub", "stub-llm", "deterministic", "http", "http-llm"}:
        return _mock_reply(case, q), kind

    context = _case_context_block(case)
    messages: list[dict[str, str]] = [
        {"role": "system", "content": _SYSTEM_TR},
        {
            "role": "user",
            "content": f"VAKA BAĞLAMI\n{context}\n\nAşağıda uzman soruları gelecek.",
        },
    ]
    # Keep last few turns for continuity (exclude the new question; caller appends after).
    for turn in history[-8:]:
        role = "user" if turn.role == "user" else "assistant"
        messages.append({"role": role, "content": turn.content})
    messages.append({"role": "user", "content": q})

    model_id = (settings.llm_model_id or "").strip()
    if not model_id or model_id == "generic-http-llm":
        raise LLMConfigError("VETMIND_LLM_MODEL_ID required for case chat.")

    endpoint = (settings.llm_endpoint or "").strip()
    if kind == "ollama":
        base = endpoint or OLLAMA_DEFAULT_BASE_URL
    elif kind in {"openai", "openai-compatible", "vllm", "openrouter", "groq", "lmstudio"}:
        base = endpoint or OPENAI_DEFAULT_BASE_URL
    elif kind in {"anthropic", "claude"}:
        # Keep path simple: ask user to use ollama/openai for chat for now.
        return (
            "Anthropic sohbet bu ekranda henüz yok. `VETMIND_LLM_PROVIDER=ollama` ile deneyin "
            "veya mock yanıt için `mock` kullanın.\n\n" + _mock_reply(case, q),
            kind,
        )
    else:
        return _mock_reply(case, q), kind

    reply = _openai_compatible_chat(
        base_url=base,
        model_id=model_id,
        api_key=settings.llm_api_key,
        timeout_s=float(settings.llm_timeout_s),
        temperature=settings.llm_temperature,
        max_tokens=int(settings.llm_max_tokens),
        messages=messages,
    )
    return reply, kind
