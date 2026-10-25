"""P0 hardening regression tests (architecture review)."""

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.llm.gateway import LLMGateway
from app.llm.mock_provider import MockLLMProvider
from app.models.mock_vision import MockBrainMriModel
from app.models.normalizer import normalize_outputs
from app.schemas.case import CaseRecord, ReviewFeedback
from app.schemas.enums import (
    AnatomicalRegion,
    CaseLifecycleStatus,
    FindingStatus,
    MockScenario,
    Modality,
    ModelExecutionStatus,
    PipelineOutcome,
    ReportStatus,
    ReviewAction,
    SourceKind,
    Species,
)
from app.schemas.findings import Finding, StructuredFindings, StudyInfo
from app.services.repository import InMemoryCaseRepository
from app.validation.report_validator import ReportValidator
from tests.conftest import make_payload


def test_frontend_failure_status_contract_not_revision() -> None:
    """Contract with src/lib/caseStatusMap.ts — failed ≠ expert revizyon."""
    mapping = {
        "failed": "analiz_basarisiz",
        "unsupported": "manuel_inceleme",
        "success": "uzman_incelemesinde",  # matches src/lib/caseStatusMap.ts
        "partial": "uzman_incelemesinde",
    }
    assert mapping["failed"] != "revizyon"
    assert mapping["unsupported"] != "revizyon"
    assert "revizyon" not in mapping.values()


def test_unsupported_cannot_approve_ai_draft(client: TestClient) -> None:
    payload = make_payload(scenario="unsupported").model_dump(mode="json")
    case_id = client.post("/api/v1/cases", json=payload).json()["case_id"]
    analyzed = client.post(f"/api/v1/cases/{case_id}/analyze").json()
    assert analyzed["outcome"] == "unsupported"
    assert analyzed["report"] is None
    assert client.get(f"/api/v1/cases/{case_id}/report").status_code == 404
    res = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "expert-demo", "action": "approve"},
    )
    assert res.status_code == 409
    assert "manual" in res.json()["detail"].lower() or "unsupported" in res.json()["detail"].lower()
    case = client.get(f"/api/v1/cases/{case_id}").json()
    assert case["status"] == "manual_review"
    assert case["draft_report"] is None


def test_failed_cannot_approve(client: TestClient) -> None:
    payload = make_payload(scenario="model_failure").model_dump(mode="json")
    case_id = client.post("/api/v1/cases", json=payload).json()["case_id"]
    analyzed = client.post(f"/api/v1/cases/{case_id}/analyze").json()
    assert analyzed["outcome"] == "failed"
    assert analyzed["report"] is None
    res = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "expert-demo", "action": "approve"},
    )
    assert res.status_code == 409
    assert client.get(f"/api/v1/cases/{case_id}").json()["status"] == "failed"


def test_validation_failed_cannot_approve(client: TestClient) -> None:
    container = AppContainer(repo=InMemoryCaseRepository())
    app_client = TestClient(__import__("app.main", fromlist=["create_app"]).create_app(container))
    case_id = app_client.post("/api/v1/cases", json=make_payload().model_dump(mode="json")).json()["case_id"]
    app_client.post(f"/api/v1/cases/{case_id}/analyze")
    case = container.repo.get_case(case_id)
    assert case and case.draft_report
    case.draft_report.impression.cited_finding_ids.append("does-not-exist")
    case.draft_report.status = ReportStatus.VALIDATION_FAILED
    container.repo.save_case(case)

    res = app_client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "expert-demo", "action": "approve"},
    )
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert isinstance(detail, dict)
    assert any("Geçersiz bulgu atıfları" in e for e in detail["errors"])


def test_validator_status_not_overwritten_by_orchestrator() -> None:
    container = AppContainer(repo=InMemoryCaseRepository())
    case = CaseRecord(
        case_id="case-val",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        scenario=MockScenario.BRAIN_MRI_SUSPECTED,
    )
    findings = MockBrainMriModel().analyze(case)
    report = LLMGateway(MockLLMProvider()).generate_draft(case, findings)
    report.impression.cited_finding_ids.append("bogus-id")
    result = ReportValidator().validate(report, findings)
    assert result.ok is False
    assert report.status == ReportStatus.VALIDATION_FAILED

    # Simulate orchestrator policy: never overwrite validation failure.
    if result.ok and report.status == ReportStatus.DRAFT:
        report.status = ReportStatus.AWAITING_REVIEW
    assert report.status == ReportStatus.VALIDATION_FAILED


def test_review_edits_are_revalidated(client: TestClient) -> None:
    case_id = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json")).json()["case_id"]
    client.post(f"/api/v1/cases/{case_id}/analyze")
    # Empty impression should fail revalidation on approve
    res = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={
            "reviewer_id": "expert-demo",
            "action": "approve",
            "edited_impression": "   ",
        },
    )
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert isinstance(detail, dict)
    assert any("Değerlendirme" in e for e in detail["errors"])


def test_mock_provenance_preserved() -> None:
    case = CaseRecord(
        case_id="case-mock",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        scenario=MockScenario.BRAIN_MRI_SUSPECTED,
    )
    out = MockBrainMriModel().analyze(case)
    merged = normalize_outputs([out])
    assert merged.source_kind == SourceKind.MOCK
    assert SourceKind.MOCK in merged.contributing_source_kinds
    assert out.source_kind == SourceKind.MOCK
    assert all(f.synthetic for f in merged.findings)


def test_mixed_model_provenance_preserved() -> None:
    base = dict(
        case_id="case-mix",
        study=StudyInfo(),
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        source_model_version="0.1.0",
        execution_status=ModelExecutionStatus.SUCCESS,
        review_required=True,
        absences_not_confirmed=True,
    )
    mock_out = StructuredFindings(
        **base,
        source_model_id="mock-brain-mri-v1",
        source_kind=SourceKind.MOCK,
        contributing_model_ids=["mock-brain-mri-v1"],
        contributing_source_kinds=[SourceKind.MOCK],
        findings=[
            Finding(
                finding_id="f-mock",
                finding_code="MOCK-X",
                description="SYNTHETIC MOCK FINDING",
                anatomical_location="brain",
                finding_status=FindingStatus.SUSPECTED,
                source_model="mock-brain-mri-v1",
                synthetic=True,
            )
        ],
    )
    # Unit-test-only REAL-labeled stub (not a clinical model / not from mock fixtures).
    real_out = StructuredFindings(
        **base,
        source_model_id="future-real-adapter",
        source_kind=SourceKind.REAL,
        contributing_model_ids=["future-real-adapter"],
        contributing_source_kinds=[SourceKind.REAL],
        findings=[
            Finding(
                finding_id="f-real",
                finding_code="REAL-STUB",
                description="Unit-test stub finding with REAL source_kind for fusion provenance.",
                anatomical_location="brain",
                finding_status=FindingStatus.UNCERTAIN,
                source_model="future-real-adapter",
                synthetic=False,
            )
        ],
        warnings=[],
    )
    merged = normalize_outputs([mock_out, real_out])
    assert merged.source_kind == SourceKind.MIXED
    assert set(merged.contributing_source_kinds) == {SourceKind.MOCK, SourceKind.REAL}
    assert set(merged.contributing_model_ids) == {"mock-brain-mri-v1", "future-real-adapter"}
    assert {f.finding_id for f in merged.findings} == {"f-mock", "f-real"}
    assert any("KARMA KAYNAK" in w for w in merged.warnings)


def test_brain_and_cervical_mock_workflows_still_work(client: TestClient) -> None:
    brain_id = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json")).json()["case_id"]
    brain = client.post(f"/api/v1/cases/{brain_id}/analyze").json()
    assert brain["outcome"] == "success"
    assert brain["findings"]["findings"][0]["finding_code"] == "MOCK-BRAIN-MASS-EFFECT"
    assert brain["report"]["status"] == "awaiting_review"
    assert brain["findings"]["source_kind"] == "mock"

    cerv_payload = make_payload(
        scenario="cervical_mri_suspected",
        anatomical_region=AnatomicalRegion.CERVICAL,
    ).model_dump(mode="json")
    cerv_id = client.post("/api/v1/cases", json=cerv_payload).json()["case_id"]
    cerv = client.post(f"/api/v1/cases/{cerv_id}/analyze").json()
    assert cerv["outcome"] == "success"
    assert cerv["findings"]["findings"][0]["finding_code"] == "MOCK-CERVICAL-CORD-COMPRESSION"
    assert cerv["job"]["status"] == "completed"
    # Synchronous: job is finished in the same response.
    assert client.get(f"/api/v1/jobs/{cerv['job']['job_id']}").json()["status"] == "completed"


def test_successful_approve_after_valid_edit(client: TestClient) -> None:
    case_id = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json")).json()["case_id"]
    client.post(f"/api/v1/cases/{case_id}/analyze")
    res = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={
            "reviewer_id": "expert-demo",
            "action": "approve",
            "edited_impression": "Reviewed synthetic impression — still not clinically validated.",
        },
    )
    assert res.status_code == 200
    assert res.json()["status"] == "approved"
    assert res.json()["draft_report"]["status"] == "approved"
