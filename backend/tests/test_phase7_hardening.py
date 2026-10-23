"""Phase 7 — deep audit regression tests (approve race, document tenancy, provenance)."""

from __future__ import annotations

import time
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.container import AppContainer
from app.llm.http_provider import HttpLLMProvider, _report_provenance_from_findings
from app.llm.interfaces import LLMGenerationInput, LLMRequest
from app.main import create_app
from app.models.normalizer import detect_potential_conflicts
from app.routing.capabilities import ModelCapability
from app.schemas.enums import (
    AnatomicalRegion,
    FindingStatus,
    ModelExecutionStatus,
    Modality,
    SourceKind,
    Species,
)
from app.schemas.findings import EvidenceReference, Finding
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings
from tests.conftest import make_payload
from tests.test_phase5_security import _auth, _client, _token


def test_analyze_discarded_when_approved_in_flight(tmp_path: Path) -> None:
    """P0: in-flight analyze must not clobber a concurrent expert approval."""
    settings = Settings(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        auth_enabled=False,
        auth_api_key=None,
        jwt_secret="phase7-secret",
        async_analyze_delay_ms=400,
        rag_backend="embedding",
        tenant_isolation=False,
        deployment_mode="demo",
        malware_scan_required=False,
        audit_log_path=tmp_path / "audit.jsonl",
        max_concurrent_analyze=8,
    )
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    client = TestClient(create_app(container))

    case_id = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json")).json()[
        "case_id"
    ]
    # First analyze → draft for approval path.
    assert client.post(f"/api/v1/cases/{case_id}/analyze").status_code == 200

    # Start slow re-analyze, then approve while job is still running.
    enqueued = client.post(f"/api/v1/cases/{case_id}/analyze/async")
    assert enqueued.status_code == 202
    job_id = enqueued.json()["job_id"]

    approved = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "expert-phase7", "action": "approve", "comment": "ship it"},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    assert approved.json()["draft_report"]["immutable"] is True
    approved_report_id = approved.json()["draft_report"]["report_id"]

    deadline = time.time() + 5
    terminal = None
    while time.time() < deadline:
        polled = client.get(f"/api/v1/jobs/{job_id}").json()
        terminal = polled["status"]
        if terminal in {"completed", "failed", "cancelled", "timed_out"}:
            break
        time.sleep(0.05)

    assert terminal == "failed"
    job = client.get(f"/api/v1/jobs/{job_id}").json()
    assert "approved while analysis was in flight" in (job.get("error_message") or "")

    case = client.get(f"/api/v1/cases/{case_id}").json()
    assert case["status"] == "approved"
    assert case["draft_report"]["immutable"] is True
    assert case["draft_report"]["report_id"] == approved_report_id
    assert case["draft_report"]["status"] == "approved"


def test_document_cross_tenant_ingest_denied(tmp_path: Path) -> None:
    """P1: document ingest must not be readable across clinics (IDOR)."""
    client = _client(tmp_path)
    vet_a = _token(client, "vet@demo.local")
    vet_b = _token(client, "vet-b@demo.local")
    text = b"SYNTHETIC prior note - not clinical evidence.\n"
    upload = client.post(
        "/api/v1/documents/upload",
        data={"patient_name": "Doc Tenant", "species": Species.CANINE.value},
        files=[("files", ("note.txt", text, "text/plain"))],
        headers=_auth(vet_a),
    )
    assert upload.status_code == 201, upload.text
    ingest_id = upload.json()["ingest_id"]
    assert upload.json().get("blocked") is False

    owned = client.get(f"/api/v1/documents/ingestions/{ingest_id}", headers=_auth(vet_a))
    assert owned.status_code == 200
    assert owned.json()["clinic_id"] == "clinic-demo-a"

    denied = client.get(f"/api/v1/documents/ingestions/{ingest_id}", headers=_auth(vet_b))
    assert denied.status_code == 404

    denied_confirm = client.post(
        f"/api/v1/documents/ingestions/{ingest_id}/confirm",
        json={},
        headers=_auth(vet_b),
    )
    assert denied_confirm.status_code == 404

    confirmed = client.post(
        f"/api/v1/documents/ingestions/{ingest_id}/confirm",
        json={},
        headers=_auth(vet_a),
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["clinic_id"] == "clinic-demo-a"
    assert confirmed.json()["owner_subject"] == "vet@demo.local"


def test_document_confirm_includes_live_remote_capability(tmp_path: Path) -> None:
    """F4 residual: document confirm uses container capabilities, not only defaults."""
    remote = ModelCapability(
        model_id="remote-vision-v1",
        modalities=frozenset({Modality.OTHER}),
        regions=frozenset({AnatomicalRegion.UNKNOWN}),
        priority=0,
        enabled=True,
        source_kind=SourceKind.REAL,
        model_version="test",
        timeout_s=5.0,
    )
    settings = Settings(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        auth_enabled=False,
        auth_api_key=None,
        jwt_secret="phase7-secret",
        async_analyze_delay_ms=0,
        rag_backend="lexical",
        tenant_isolation=False,
        deployment_mode="demo",
        malware_scan_required=False,
        audit_log_path=tmp_path / "audit.jsonl",
        max_concurrent_analyze=4,
    )
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    # Inject remote capability into document service list (simulate registered remote).
    container.documents._capabilities = list(container.documents._capabilities) + [remote]  # noqa: SLF001
    client = TestClient(create_app(container))
    upload = client.post(
        "/api/v1/documents/upload",
        data={"patient_name": "F4 Doc", "species": Species.CANINE.value},
        files=[("files", ("n.txt", b"hello stub", "text/plain"))],
    )
    assert upload.status_code == 201
    case = client.post(
        f"/api/v1/documents/ingestions/{upload.json()['ingest_id']}/confirm",
        json={},
    ).json()
    prepared = (case.get("model_input") or {}).get("prepared_for_models") or []
    assert "remote-vision-v1" in prepared
    assert "mock-multimodal-vlm-v1" in prepared


def test_http_llm_provenance_follows_findings_source_kind() -> None:
    assert _report_provenance_from_findings(SourceKind.MOCK) == (SourceKind.MOCK, True)
    assert _report_provenance_from_findings(SourceKind.MIXED) == (SourceKind.MIXED, True)
    assert _report_provenance_from_findings(SourceKind.REAL) == (SourceKind.REAL, False)

    gen = LLMGenerationInput(
        case_id="case-x",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        findings=[],
        findings_source_kind=SourceKind.MOCK,
        execution_status=ModelExecutionStatus.SUCCESS,
    )
    provider = HttpLLMProvider(endpoint="http://127.0.0.1:9/llm", timeout_s=1.0)

    def _fake_post(*_a, **_k):
        req = httpx.Request("POST", "http://127.0.0.1:9/llm")
        return httpx.Response(
            200,
            json={
                "technique": "t",
                "findings": "f",
                "impression": "i",
                "recommendations": "r",
            },
            request=req,
        )

    provider._timeout_s = 1.0  # noqa: SLF001
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(httpx.Client, "post", lambda self, *a, **k: _fake_post())
        out = provider.generate(LLMRequest(generation=gen, instructions="draft"))
    assert out.report.generation.source_kind == SourceKind.MOCK
    assert out.report.generation.synthetic is True
    assert out.report.synthetic is True
    assert out.report.clinically_validated is False


def test_conflict_detection_separates_different_series() -> None:
    """F9: same location text + different series UIDs should not auto-conflict."""
    findings = [
        Finding(
            finding_id="a",
            finding_code="CODE-A",
            description="A",
            anatomical_location="Brain / Olfactory Bulb Region",
            finding_status=FindingStatus.SUSPECTED,
            source_model="model-a",
            evidence_references=[
                EvidenceReference(
                    evidence_id="e1",
                    description="series a",
                    series_instance_uid="1.2.3.series-a",
                )
            ],
        ),
        Finding(
            finding_id="b",
            finding_code="CODE-B",
            description="B",
            anatomical_location="brain / olfactory bulb region",
            finding_status=FindingStatus.UNCERTAIN,
            source_model="model-b",
            evidence_references=[
                EvidenceReference(
                    evidence_id="e2",
                    description="series b",
                    series_instance_uid="1.2.3.series-b",
                )
            ],
        ),
    ]
    assert detect_potential_conflicts(findings) == []


def test_conflict_detection_same_series_still_flags() -> None:
    findings = [
        Finding(
            finding_id="a",
            finding_code="CODE-A",
            description="A",
            anatomical_location="Brain",
            finding_status=FindingStatus.SUSPECTED,
            source_model="model-a",
            evidence_references=[
                EvidenceReference(
                    evidence_id="e1",
                    description="s",
                    series_instance_uid="1.2.3.same",
                )
            ],
        ),
        Finding(
            finding_id="b",
            finding_code="CODE-B",
            description="B",
            anatomical_location="brain",
            finding_status=FindingStatus.UNCERTAIN,
            source_model="model-b",
            evidence_references=[
                EvidenceReference(
                    evidence_id="e2",
                    description="s",
                    series_instance_uid="1.2.3.same",
                )
            ],
        ),
    ]
    conflicts = detect_potential_conflicts(findings)
    assert len(conflicts) == 1
