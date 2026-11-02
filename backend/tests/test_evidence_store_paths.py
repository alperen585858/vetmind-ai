"""Evidence refs are stored with "/" on every OS and old Windows-style refs still resolve."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.models.evidence_store import EvidenceArtifactStore


def test_stored_ref_uses_forward_slashes(tmp_path: Path) -> None:
    store = EvidenceArtifactStore(tmp_path)
    art = store.write_bytes("case-1", "ev-1", filename="overlay.png", data=b"png")
    assert "\\" not in art.relative_path
    assert art.relative_path.endswith("/ev-1_overlay.png")
    assert store.resolve(art.relative_path) == art.absolute_path


def test_windows_style_ref_still_resolves(tmp_path: Path) -> None:
    store = EvidenceArtifactStore(tmp_path)
    art = store.write_bytes("case-1", "ev-1", filename="overlay.png", data=b"png")
    legacy = art.relative_path.replace("/", "\\")
    assert store.resolve(legacy) == art.absolute_path


def test_backslash_traversal_is_still_rejected(tmp_path: Path) -> None:
    store = EvidenceArtifactStore(tmp_path / "store")
    (tmp_path / "secret.png").write_bytes(b"x")
    with pytest.raises(ValueError):
        store.resolve("..\\secret.png")
