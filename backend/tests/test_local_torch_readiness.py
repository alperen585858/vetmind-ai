"""Local torch appears in readiness with blockers when weights missing."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


def test_local_torch_readiness_not_configured_without_weights(tmp_path: Path) -> None:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=tmp_path / "unused.sqlite3",
        quarantine_root=tmp_path / "q",
        local_torch_model_id="local-brain-v1",
        local_torch_entrypoint="app.models.entrypoint:LocalTorchEntrypoint",
        local_torch_modalities=("MR",),
        local_torch_regions=("BRAIN",),
        local_torch_weights_path=str(tmp_path / "missing.pt"),
        auth_enabled=False,
    )
    client = TestClient(create_app(AppContainer(repo=InMemoryCaseRepository(), settings=settings)))
    body = client.get("/api/v1/models/readiness").json()
    entry = next(m for m in body["models"] if m["model_id"] == "local-brain-v1")
    assert entry["adapter_kind"] == "local_torch"
    assert "not_configured" in entry["blockers"] or entry["availability"] == "not_configured"
