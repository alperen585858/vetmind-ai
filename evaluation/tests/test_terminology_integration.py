"""Nonclinical schema-bridge fixtures against the actual backend contracts."""
from pathlib import Path
import sys
import pytest

BACKEND = Path(__file__).resolve().parents[2] / "backend"
if not BACKEND.is_dir():
    pytest.skip("VetMind backend unavailable", allow_module_level=True)
sys.path.insert(0, str(BACKEND))

from app.schemas.enums import AnatomicalRegion, FindingStatus, Modality, ModelExecutionStatus, SourceKind, Species
from app.schemas.findings import Finding, StructuredFindings
from evaluation.clinical_terminology.catalog import TermCatalog, TermEntry, TermScope
from evaluation.clinical_terminology.integration import audit_structured_findings
from evaluation.clinical_terminology.resolver import CatalogResolver


def specimen(*, source_kind=SourceKind.REAL, region=AnatomicalRegion.BRAIN, findings=None, status=ModelExecutionStatus.SUCCESS):
    return StructuredFindings(
        case_id="private_case_id", species=Species.CANINE, modality=Modality.MR,
        anatomical_region=region, source_model_id="unit_model", source_model_version="1",
        source_kind=source_kind, execution_status=status, findings=findings or [],
    )


def finding(**overrides):
    fields = dict(finding_id="f1", finding_code="fake_finding", anatomical_location="fake_anatomy",
                  description="PRIVATE CLINICAL FREE TEXT", finding_status=FindingStatus.POSSIBLE,
                  source_model="unit_model", laterality="LEFT")
    fields.update(overrides)
    return Finding(**fields)


def resolver(*, reviewed=True):
    entries = [TermEntry(
        canonical_id="TEST:" + kind, preferred_label=label, kind=kind,
        scope=TermScope(species="canine", domain="brain"),
        review_state="expert_reviewed" if reviewed else "pending",
        reviewed_by="unit-fixture" if reviewed else None,
        source_references=("unit-fixture",),
    ) for kind, label in (("finding", "fake_finding"), ("anatomy", "fake_anatomy"))]
    return CatalogResolver(TermCatalog(catalog_id="unit", catalog_version="1.0.0", terms=entries))


def test_reviewed_matches_are_structural_only():
    output = audit_structured_findings(specimen(findings=[finding()]), resolver())
    assert output.status == "structurally_resolved"
    assert (output.resolved_finding_terms, output.resolved_anatomy_terms) == (1, 1)
    assert output.clinical_validation == "not_evaluated"
    assert output.clinical_metrics is None
    assert "PRIVATE" not in repr(output) and "private_case_id" not in repr(output)


def test_pending_terms_are_not_equivalent():
    output = audit_structured_findings(specimen(findings=[finding()]), resolver(reviewed=False))
    assert output.status == "needs_review"
    assert output.resolved_finding_terms == 0


def test_mock_source_not_assessed():
    output = audit_structured_findings(specimen(source_kind=SourceKind.MOCK, findings=[finding()]), resolver())
    assert output.status == "not_evaluated" and output.unsupported_scope


def test_unknown_region_not_force_mapped():
    output = audit_structured_findings(specimen(region=AnatomicalRegion.THORAX, findings=[finding()]), resolver())
    assert output.status == "not_evaluated" and output.unsupported_scope


def test_empty_output_is_not_disease_exclusion():
    output = audit_structured_findings(specimen(findings=[]), resolver())
    assert output.status == "not_evaluated" and output.finding_count == 0


def test_unknown_laterality_triggers_review():
    output = audit_structured_findings(specimen(findings=[finding(laterality="UNKNOWN")]), resolver())
    assert output.status == "needs_review" and output.unknown_laterality == 1


def test_failed_inference_not_assessed():
    output = audit_structured_findings(specimen(status=ModelExecutionStatus.FAILED, findings=[finding()]), resolver())
    assert output.status == "not_evaluated"


def test_not_a_backend_contract_rejected():
    with pytest.raises(TypeError):
        audit_structured_findings({"case_id": "fake"}, resolver())
