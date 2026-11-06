"""Disk cache for VLM batch JSON responses — keyed by case + SOP/frame set + model.

Prevents cross-patient reuse (case_id in key). Does not cache PNG pixels.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Sequence


def batch_cache_key(
    *,
    case_id: str,
    chat_model_id: str,
    frame_keys: Sequence[str],
) -> str:
    raw = "|".join([case_id, chat_model_id, *sorted(frame_keys)])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class VlmBatchResultCache:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        return self.root / f"{key}.json"

    def get(self, key: str) -> dict[str, Any] | None:
        path = self._path(key)
        if not path.is_file():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        return data if isinstance(data, dict) else None

    def put(self, key: str, payload: dict[str, Any]) -> None:
        path = self._path(key)
        tmp = path.with_suffix(".tmp")
        try:
            tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            tmp.replace(path)
        except OSError:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
