"""JSON schemas for LLM structured output, generated from the Pydantic models that
validate the answer, so the schema the model is given and the parser cannot drift apart.

Providers want a strict, self-contained schema: every property required, no extra
properties, no ``$ref``/``$defs``, and no Pydantic-only keys such as ``title`` or
``default`` (OpenAI strict mode rejects defaults). The parsing models themselves stay
lenient (defaults, ``extra="ignore"``) so a slightly-off answer is repaired, not dropped.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

_DROP_KEYS = {"title", "default"}


def _resolve(node: Any, defs: dict[str, Any]) -> Any:
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str):
            target = defs[ref.rsplit("/", 1)[-1]]
            merged = {**target, **{k: v for k, v in node.items() if k != "$ref"}}
            return _resolve(merged, defs)
        out: dict[str, Any] = {}
        for key, value in node.items():
            if key in _DROP_KEYS or key == "$defs":
                continue
            out[key] = _resolve(value, defs)
        if out.get("type") == "object" and "properties" in out:
            # Strict output: the model must always send every field and nothing else.
            out["additionalProperties"] = False
            out["required"] = list(out["properties"])
        return out
    if isinstance(node, list):
        return [_resolve(v, defs) for v in node]
    return node


def strict_llm_schema(model: type[BaseModel]) -> dict[str, Any]:
    """Self-contained strict JSON schema for ``model`` (refs inlined, all fields required)."""
    raw = model.model_json_schema(mode="serialization")
    return _resolve(raw, raw.get("$defs", {}))
