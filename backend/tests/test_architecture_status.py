"""Admin live architecture diagram: every box reflects the running configuration."""

from __future__ import annotations

from dataclasses import replace

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.routing.capabilities import default_capabilities
from app.routing.execution_policy import VisionExecutionMode
from app.schemas.enums import AnatomicalRegion, Modality, SourceKind
from app.services.architecture_status import build_architecture, models_for_modality
from tests.conftest import make_payload

ADMIN = {"X-VetMind-Demo-Role": "admin"}


def test_admin_only(client: TestClient) -> None:
    assert client.get("/api/v1/admin/architecture", headers={"X-VetMind-Demo-Role": "vet"}).status_code == 403
    res = client.get("/api/v1/admin/architecture", headers=ADMIN)
    assert res.status_code == 200
    body = res.json()
    # Every id in the layout has a node, and the four router branches are one row.
    ids = [i for row in body["rows"] for i in row]
    assert set(ids) == set(body["nodes"])
    assert ["xray", "ct", "mri", "document"] in body["rows"]
    assert body["side_nodes"] == ["rag"]


def test_default_setup_is_mock(container: AppContainer) -> None:
    nodes = build_architecture(container)["nodes"]
    for branch in ("xray", "ct", "mri"):
        assert nodes[branch]["status"] == "mock"
        assert nodes[branch]["branch_label"]
    assert nodes["llm"]["status"] == "mock"
    # Tests run with hash embeddings, as requested → not a fallback.
    assert nodes["rag"]["status"] == "active"
    assert nodes["classifier"]["detail"] == "Yalnızca kurallar"


def test_real_model_replaces_mocks_only_in_exclusive_mode() -> None:
    caps = default_capabilities()
    real_xr = replace(
        next(c for c in caps if c.model_id == "mock-xr-vision-v1"),
        model_id="vet-xr-thorax-v1",
        source_kind=SourceKind.REAL,
        regions=frozenset({AnatomicalRegion.THORAX}),
        priority=0,
    )
    caps.append(real_xr)
    exclusive = [c.model_id for c in models_for_modality(caps, Modality.XR, VisionExecutionMode.EXCLUSIVE_REAL)]
    # THORAX goes to the real model; regions the real model does not cover keep the mock.
    assert exclusive[0] == "vet-xr-thorax-v1"
    assert "mock-xr-vision-v1" in exclusive
    mixed = [c.model_id for c in models_for_modality(caps, Modality.XR, VisionExecutionMode.MIXED)]
    assert set(mixed) == {"vet-xr-thorax-v1", "mock-xr-vision-v1"}
    # Disabled models never show up.
    assert models_for_modality([replace(real_xr, enabled=False)], Modality.XR, VisionExecutionMode.MIXED) == []


def test_recent_analysis_is_counted(client: TestClient) -> None:
    case_id = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json")).json()["case_id"]
    assert client.post(f"/api/v1/cases/{case_id}/analyze").status_code == 200
    nodes = client.get("/api/v1/admin/architecture", headers=ADMIN).json()["nodes"]
    assert nodes["mri"]["recent_uses"] == 1
    assert nodes["xray"]["recent_uses"] == 0
    assert nodes["review"]["detail"].startswith("1 ")
    assert nodes["llm"]["info"]["Son taslak"] != "henüz yok"
