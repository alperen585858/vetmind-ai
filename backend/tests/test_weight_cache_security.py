"""Checkpoint loading: weights_only by default, SHA-256 pin, working cache (fake torch)."""

import hashlib
import sys
import types
from pathlib import Path

import pytest

from app.models.errors import ModelUnavailableError
from app.models.weight_cache import WeightCache, load_torch_checkpoint


@pytest.fixture()
def fake_torch(monkeypatch):
    calls: list[dict] = []
    mod = types.ModuleType("torch")
    mod.refuse_weights_only = False

    def load(path, map_location=None, weights_only=None):
        calls.append({"path": path, "weights_only": weights_only})
        if weights_only and mod.refuse_weights_only:
            raise RuntimeError("UnpicklingError: unsupported global")
        return {"state_dict": {}, "label_names": ["a"]}

    mod.load = load
    monkeypatch.setitem(sys.modules, "torch", mod)
    return mod, calls


def _ckpt(tmp_path: Path) -> tuple[Path, str]:
    p = tmp_path / "model.pt"
    p.write_bytes(b"checkpoint-bytes")
    return p, hashlib.sha256(b"checkpoint-bytes").hexdigest()


def test_safe_load_and_cache_hit_with_relative_path(tmp_path, fake_torch, monkeypatch) -> None:
    _, calls = fake_torch
    path, _ = _ckpt(tmp_path)
    cache = WeightCache()
    monkeypatch.chdir(tmp_path)
    first = load_torch_checkpoint("model.pt", model_id="m", version="1", cache=cache)
    second = load_torch_checkpoint("model.pt", model_id="m", version="1", cache=cache)
    assert first is second, "relative path must hit the cache"
    assert calls == [{"path": "model.pt", "weights_only": True}]


def test_pin_mismatch_refuses(tmp_path, fake_torch) -> None:
    path, _ = _ckpt(tmp_path)
    with pytest.raises(ModelUnavailableError, match="pinned SHA-256"):
        load_torch_checkpoint(str(path), model_id="m", version="1", cache=WeightCache(), expected_sha256="0" * 64)


def test_full_pickle_only_for_pinned_file(tmp_path, fake_torch) -> None:
    mod, calls = fake_torch
    mod.refuse_weights_only = True
    path, digest = _ckpt(tmp_path)
    with pytest.raises(ModelUnavailableError, match="VETMIND_LOCAL_TORCH_WEIGHTS_SHA256"):
        load_torch_checkpoint(str(path), model_id="m", version="1", cache=WeightCache())
    loaded = load_torch_checkpoint(str(path), model_id="m", version="1", cache=WeightCache(), expected_sha256=digest.upper())
    assert loaded.digest_sha256 == digest
    assert [c["weights_only"] for c in calls] == [True, True, False]
