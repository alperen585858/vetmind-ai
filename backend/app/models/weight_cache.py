"""In-process weight cache for local Vision entrypoints.

Keyed by (model_id, version, device). Never imports torch at module import time.
Missing weights fail closed — callers must not invent clinical findings.
"""

from __future__ import annotations

import hashlib
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from app.models.errors import ModelUnavailableError


@dataclass(frozen=True)
class WeightCacheKey:
    model_id: str
    version: str
    device: str


@dataclass
class CachedWeights:
    key: WeightCacheKey
    weights_path: str
    digest_sha256: str
    payload: Any  # typically a torch module or state dict wrapper
    meta: dict[str, Any]


class WeightCache:
    """Thread-safe cache of loaded model payloads."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._entries: dict[WeightCacheKey, CachedWeights] = {}

    def get(self, key: WeightCacheKey) -> CachedWeights | None:
        with self._lock:
            return self._entries.get(key)

    def put(self, entry: CachedWeights) -> CachedWeights:
        with self._lock:
            self._entries[entry.key] = entry
            return entry

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def describe(self) -> list[dict[str, str]]:
        with self._lock:
            return [
                {
                    "model_id": e.key.model_id,
                    "version": e.key.version,
                    "device": e.key.device,
                    "digest_sha256": e.digest_sha256,
                    "weights_path": e.weights_path,
                }
                for e in self._entries.values()
            ]


_GLOBAL_CACHE = WeightCache()


def global_weight_cache() -> WeightCache:
    return _GLOBAL_CACHE


def file_sha256(path: Path, *, max_bytes: int | None = None) -> str:
    """SHA-256 of file contents (optional byte cap for huge checkpoints)."""
    h = hashlib.sha256()
    read = 0
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
            read += len(chunk)
            if max_bytes is not None and read >= max_bytes:
                break
    return h.hexdigest()


_DIGEST_MEMO: dict[tuple[str, int, int], str] = {}
_DIGEST_LOCK = threading.Lock()


def cached_file_sha256(path: Path) -> str:
    """file_sha256 memoised on (resolved path, size, mtime): checkpoints are large and
    readiness / every analyze used to re-hash the whole file."""
    st = path.stat()
    key = (str(path.resolve()), st.st_size, st.st_mtime_ns)
    with _DIGEST_LOCK:
        hit = _DIGEST_MEMO.get(key)
    if hit is not None:
        return hit
    digest = file_sha256(path)
    with _DIGEST_LOCK:
        _DIGEST_MEMO[key] = digest
    return digest


def require_weights_file(weights_path: str | None, *, model_id: str) -> Path:
    if not weights_path or not str(weights_path).strip():
        raise ModelUnavailableError(
            f"Weights path missing for {model_id!r}. No silent mock fallback."
        )
    path = Path(weights_path)
    if not path.is_file():
        raise ModelUnavailableError(
            f"Weights file not found for {model_id!r}: {path}. No silent mock fallback."
        )
    return path


def load_torch_checkpoint(
    weights_path: str | None,
    *,
    model_id: str,
    version: str,
    device: str = "cpu",
    cache: WeightCache | None = None,
    map_location: str | None = None,
    expected_sha256: str | None = None,
) -> CachedWeights:
    """Load a torch checkpoint into the cache. Lazy-imports torch.

    Loading is ``weights_only`` (no code execution from the file). Full pickle loading is
    allowed only for a checkpoint pinned by ``expected_sha256``; a pin mismatch refuses.
    """
    path = require_weights_file(weights_path, model_id=model_id)
    key = WeightCacheKey(model_id=model_id, version=version, device=device)
    store = cache or global_weight_cache()
    hit = store.get(key)
    digest = cached_file_sha256(path)
    pin = (expected_sha256 or "").strip().lower() or None
    if pin is not None and digest != pin:
        raise ModelUnavailableError(
            f"Checkpoint for {model_id!r} does not match the pinned SHA-256; refusing to load."
        )
    if hit is not None and hit.digest_sha256 == digest and hit.weights_path == str(path.resolve()):
        return hit

    try:
        import torch  # type: ignore[import-not-found]
    except Exception as exc:  # noqa: BLE001
        raise ModelUnavailableError(
            f"PyTorch unavailable for {model_id!r}: {type(exc).__name__}. "
            "Install backend/requirements-vision.txt on vision workers."
        ) from exc

    loc = map_location or device
    try:
        payload = torch.load(str(path), map_location=loc, weights_only=True)
    except TypeError as exc:
        # Torch too old for weights_only=: full pickle load only for a pinned file.
        if pin is None:
            raise ModelUnavailableError(
                f"Torch cannot safely load {model_id!r} (no weights_only); "
                "set VETMIND_LOCAL_TORCH_WEIGHTS_SHA256 to trust this exact file."
            ) from exc
        payload = torch.load(str(path), map_location=loc)
    except Exception as exc:  # noqa: BLE001 — e.g. UnpicklingError for objects beyond tensors/dicts
        if pin is None:
            raise ModelUnavailableError(
                f"Checkpoint for {model_id!r} needs full pickle loading; "
                "set VETMIND_LOCAL_TORCH_WEIGHTS_SHA256 to trust this exact file."
            ) from exc
        try:
            payload = torch.load(str(path), map_location=loc, weights_only=False)
        except Exception as exc2:  # noqa: BLE001
            raise ModelUnavailableError(
                f"Failed to load checkpoint for {model_id!r}: {type(exc2).__name__}: {exc2}"
            ) from exc2

    meta: dict[str, Any] = {}
    if isinstance(payload, dict):
        for k in (
            "model_id",
            "version",
            "architecture",
            "label_names",
            "num_classes",
            "clinically_approved",
            "calibration",
        ):
            if k in payload:
                meta[k] = payload[k]

    entry = CachedWeights(
        key=key,
        weights_path=str(path.resolve()),
        digest_sha256=digest,
        payload=payload,
        meta=meta,
    )
    return store.put(entry)


def readiness_weight_fields(
    *,
    model_id: str,
    version: str,
    device: str,
    weights_path: str | None,
) -> dict[str, Any]:
    """Extra readiness blockers / digests for registry payloads."""
    out: dict[str, Any] = {
        "weights_path": weights_path or "",
        "weight_digest_sha256": "",
        "cuda_available": False,
        "torch_available": False,
        "monai_available": False,
        "weight_cache_hit": False,
    }
    try:
        import torch  # type: ignore[import-not-found]

        out["torch_available"] = True
        out["cuda_available"] = bool(torch.cuda.is_available())
    except Exception:  # noqa: BLE001
        pass
    try:
        import monai  # type: ignore[import-not-found]  # noqa: F401

        out["monai_available"] = True
        try:
            import monai as _m

            out["monai_version"] = getattr(_m, "__version__", "unknown")
        except Exception:  # noqa: BLE001
            out["monai_version"] = "unknown"
    except Exception:  # noqa: BLE001
        pass

    if weights_path and Path(weights_path).is_file():
        try:
            out["weight_digest_sha256"] = cached_file_sha256(Path(weights_path))
        except OSError:
            out["weight_digest_sha256"] = ""
        key = WeightCacheKey(model_id=model_id, version=version, device=device)
        hit = global_weight_cache().get(key)
        out["weight_cache_hit"] = hit is not None and hit.digest_sha256 == out["weight_digest_sha256"]
    return out
