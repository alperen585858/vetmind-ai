"""Explicit gate for the as-yet-unknown 13-section standard."""
from evaluation.contracts import EvaluationManifest, EvaluationStatus, InfrastructureAssessment

def assess(manifest: EvaluationManifest) -> InfrastructureAssessment:
    case_labels=manifest.reference_status == "expert_verified"
    return InfrastructureAssessment(manifest=manifest, checks=[
        EvaluationStatus(name="clinical_labels", status="ready" if case_labels else "not_evaluated",
                         reason=None if case_labels else "No expert-verified reference dataset"),
        EvaluationStatus(name="image_metrics", status="not_evaluated",
                         reason="No image/reference predictions supplied"),
        EvaluationStatus(name="report_template", status="not_evaluated",
                         reason="The official 13-section rules and validator are not available"),
    ])
