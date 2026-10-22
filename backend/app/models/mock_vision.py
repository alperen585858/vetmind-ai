from app.models.interfaces import ImagingAdapterError, ImagingModel
from app.schemas.case import CaseRecord
from app.schemas.enums import (
    FindingStatus,
    MockScenario,
    ModelExecutionStatus,
    SourceKind,
)
from app.schemas.findings import EvidenceReference, Finding, StructuredFindings

MOCK_DISCLAIMER = (
    "SYNTHETIC MOCK OUTPUT. This is not medical image interpretation and is not clinically validated."
)
ABSENCE_WARNING = (
    "No findings were returned. Missing findings must not be treated as confirmed absence of disease."
)


class MockVisionError(ImagingAdapterError):
    """Deterministic mock execution failure (subclass of ImagingAdapterError)."""


DICOM_METADATA_ONLY_WARNING = (
    "Case includes DICOM metadata. Mock imaging adapters do not analyze pixels; "
    "outputs remain synthetic and must not be treated as image-based diagnosis."
)


def _base(
    case: CaseRecord,
    *,
    model_id: str,
    version: str,
    status: ModelExecutionStatus,
) -> StructuredFindings:
    warnings = [MOCK_DISCLAIMER]
    if case.dicom_study is not None or case.study.dicom_available:
        warnings.append(DICOM_METADATA_ONLY_WARNING)
    if case.model_input is not None:
        mi = case.model_input
        warnings.append(
            f"Consumed ImagingModelInput v{mi.schema_version}: "
            f"{mi.total_instances} instance(s) / {len(mi.series)} series; "
            f"metadata_only={mi.metadata_only}; "
            f"pixel_analysis_authorized={mi.pixel_analysis_authorized}."
        )
    return StructuredFindings(
        case_id=case.case_id,
        study=case.study,
        species=case.species,
        modality=case.modality,
        anatomical_region=case.anatomical_region,
        source_model_id=model_id,
        source_model_version=version,
        source_kind=SourceKind.MOCK,
        execution_status=status,
        findings=[],
        warnings=warnings,
        review_required=True,
        no_findings_returned=False,
        absences_not_confirmed=True,
        contributing_model_ids=[model_id],
        contributing_source_kinds=[SourceKind.MOCK],
    )


def _finding(
    *,
    finding_id: str,
    finding_code: str,
    description: str,
    anatomical_location: str,
    finding_status: FindingStatus,
    model_id: str,
    version: str,
    evidence: list[EvidenceReference] | None = None,
    uncertainty_note: str | None = None,
) -> Finding:
    return Finding(
        finding_id=finding_id,
        finding_code=finding_code,
        description=description,
        anatomical_location=anatomical_location,
        finding_status=finding_status,
        source_model=model_id,
        source_model_version=version,
        requires_review=True,
        evidence_references=evidence or [],
        uncertainty_note=uncertainty_note or "Confidence is undefined for mock adapters.",
        synthetic=True,
    )


class MockBrainMriModel:
    model_id = "mock-brain-mri-v1"
    version = "0.1.0"

    def analyze(self, case: CaseRecord) -> StructuredFindings:
        if case.scenario == MockScenario.MODEL_FAILURE:
            raise MockVisionError("Mock Brain MRI adapter forced failure (scenario=model_failure).")
        if case.scenario == MockScenario.NO_FINDINGS:
            out = _base(case, model_id=self.model_id, version=self.version, status=ModelExecutionStatus.SUCCESS)
            out.no_findings_returned = True
            out.warnings.append(ABSENCE_WARNING)
            return out
        out = _base(case, model_id=self.model_id, version=self.version, status=ModelExecutionStatus.SUCCESS)
        out.findings = [
            _finding(
                finding_id=f"{case.case_id}-f-brain-01",
                finding_code="MOCK-BRAIN-MASS-EFFECT",
                description=(
                    "SYNTHETIC MOCK FINDING: suspected extra-axial mass effect near the olfactory bulb region. "
                    "This statement is a fixture for pipeline testing, not a radiology interpretation."
                ),
                anatomical_location="brain / olfactory bulb region (synthetic)",
                finding_status=FindingStatus.SUSPECTED,
                model_id=self.model_id,
                version=self.version,
                evidence=[
                    EvidenceReference(
                        evidence_id=f"{case.case_id}-ev-brain-01",
                        description="Mock series hint only; pixels were not analyzed.",
                        series_hint="T2W transverse (placeholder)",
                        note="Evidence is a mock reference. No pixel-level imaging analysis was performed.",
                    )
                ],
            )
        ]
        return out


class MockBrainMriAltModel:
    """Second brain adapter used only to demonstrate conflicting outputs (via scenario policy)."""

    model_id = "mock-brain-mri-alt-v1"
    version = "0.1.0"

    def analyze(self, case: CaseRecord) -> StructuredFindings:
        out = _base(case, model_id=self.model_id, version=self.version, status=ModelExecutionStatus.SUCCESS)
        out.findings = [
            _finding(
                finding_id=f"{case.case_id}-f-brain-alt-01",
                finding_code="MOCK-BRAIN-NO-MASS-EFFECT",
                description=(
                    "SYNTHETIC MOCK FINDING (CONFLICTING ADAPTER): alternative mock model did not return "
                    "mass-effect at the olfactory bulb. This is a fixture, not a negative diagnosis."
                ),
                anatomical_location="brain / olfactory bulb region (synthetic)",
                finding_status=FindingStatus.UNCERTAIN,
                model_id=self.model_id,
                version=self.version,
                uncertainty_note="Conflicts with mock-brain-mri-v1 on the same synthetic location.",
            )
        ]
        out.warnings.append("Conflicting mock adapter output. Both findings are preserved for review.")
        return out


class MockCervicalMriModel:
    model_id = "mock-cervical-mri-v1"
    version = "0.1.0"

    def analyze(self, case: CaseRecord) -> StructuredFindings:
        if case.scenario == MockScenario.MODEL_FAILURE:
            raise MockVisionError("Mock Cervical MRI adapter forced failure (scenario=model_failure).")
        if case.scenario == MockScenario.NO_FINDINGS:
            out = _base(case, model_id=self.model_id, version=self.version, status=ModelExecutionStatus.SUCCESS)
            out.no_findings_returned = True
            out.warnings.append(ABSENCE_WARNING)
            return out
        out = _base(case, model_id=self.model_id, version=self.version, status=ModelExecutionStatus.SUCCESS)
        out.findings = [
            _finding(
                finding_id=f"{case.case_id}-f-cerv-01",
                finding_code="MOCK-CERVICAL-CORD-COMPRESSION",
                description=(
                    "SYNTHETIC MOCK FINDING: suspected extradural cord compression at C2–C3. "
                    "This statement is a fixture for pipeline testing, not a radiology interpretation."
                ),
                anatomical_location="cervical spine / C2–C3 (synthetic)",
                finding_status=FindingStatus.SUSPECTED,
                model_id=self.model_id,
                version=self.version,
                evidence=[
                    EvidenceReference(
                        evidence_id=f"{case.case_id}-ev-cerv-01",
                        description="Mock series hint only; pixels were not analyzed.",
                        series_hint="T2W sagittal (placeholder)",
                        note="Evidence is a mock reference. No pixel-level imaging analysis was performed.",
                    )
                ],
            )
        ]
        return out


class ManualReviewStub:
    model_id = "manual-review"
    version = "0.1.0"

    def analyze(self, case: CaseRecord) -> StructuredFindings:
        out = _base(
            case,
            model_id=self.model_id,
            version=self.version,
            status=ModelExecutionStatus.UNSUPPORTED,
        )
        out.warnings.append(
            "Unsupported modality/region for automated pipelines. Case routed to manual radiologist review."
        )
        out.no_findings_returned = True
        out.warnings.append(ABSENCE_WARNING)
        return out


def default_model_registry() -> dict[str, ImagingModel]:
    """Injectable adapter registry. Keys are model_id strings used by the router."""
    registry: dict[str, ImagingModel] = {
        MockBrainMriModel.model_id: MockBrainMriModel(),
        MockBrainMriAltModel.model_id: MockBrainMriAltModel(),
        MockCervicalMriModel.model_id: MockCervicalMriModel(),
        ManualReviewStub.model_id: ManualReviewStub(),
    }
    return registry
