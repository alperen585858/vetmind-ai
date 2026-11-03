"""Adapters from existing project Pydantic contracts; no main application changes."""
from __future__ import annotations
from typing import TYPE_CHECKING
from evaluation.contracts import EvaluationFinding, EvaluationRecord
if TYPE_CHECKING:
    from app.schemas.findings import StructuredFindings
    from app.schemas.report import DraftReport

def from_structured_findings(source: "StructuredFindings") -> EvaluationRecord:
    """Copies provenance and findings; does NOT infer negatives from missing findings."""
    return EvaluationRecord(
        case_id=source.case_id,
        species=source.species.value,
        modality=source.modality.value,
        anatomical_region=source.anatomical_region.value,
        source_kind=source.source_kind.value,
        execution_status=source.execution_status.value,
        findings=[EvaluationFinding(
            finding_id=f.finding_id,
            finding_code=f.finding_code,
            anatomical_location=f.anatomical_location,
            laterality=f.laterality,
            confidence=f.model_confidence,
            reviewed=False,
        ) for f in source.findings],
        expert_verified=False,
    )

def report_sections(source: "DraftReport") -> dict[str, str]:
    """Present four existing fields only; never claim official 13-section conformity."""
    return {name: getattr(source, name).text for name in
            ("technique", "findings", "impression", "recommendations")}
