"""P0.4 — plug-in registry smoke; Gemini VLM path still present."""

from __future__ import annotations

from app.container import AppContainer
from app.models.interfaces import ImagingModel
from app.routing.capabilities import ModelCapability
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, Modality, ModelExecutionStatus, SourceKind, Species
from app.schemas.findings import StructuredFindings, StudyInfo


class _SmokeAdapter:
    model_id = "smoke-plugin-v1"
    version = "0.0.1"

    def analyze(self, case: CaseRecord) -> StructuredFindings:
        return StructuredFindings(
            case_id=case.case_id,
            study=StudyInfo(study_id=case.case_id, dicom_available=False, metadata_only=True),
            species=case.species,
            modality=case.modality,
            anatomical_region=case.anatomical_region,
            source_model_id=self.model_id,
            source_model_version=self.version,
            source_kind=SourceKind.MOCK,
            execution_status=ModelExecutionStatus.SUCCESS,
            findings=[],
            warnings=["smoke plugin — not clinical"],
            review_required=True,
            no_findings_returned=True,
            absences_not_confirmed=True,
            contributing_model_ids=[self.model_id],
            contributing_source_kinds=[SourceKind.MOCK],
        )


def test_smoke_adapter_satisfies_protocol_and_container_builds() -> None:
    adapter: ImagingModel = _SmokeAdapter()  # type: ignore[assignment]
    case = CaseRecord(
        case_id="smoke-1",
        patient_name="P",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
    )
    out = adapter.analyze(case)
    assert out.source_model_id == "smoke-plugin-v1"
    assert out.source_kind == SourceKind.MOCK

    container = AppContainer()
    assert container.models
    assert "mock-brain-mri-v1" in container.models or any(
        "mock" in mid for mid in container.models
    )
    # Optional Gemini VLM must not break container when unset.
    assert container.model_registry_view is not None
    assert any(mid.startswith("mock-") for mid in container.models)


def test_capability_declaration_for_new_plugin() -> None:
    cap = ModelCapability(
        model_id="smoke-plugin-v1",
        modalities=frozenset({Modality.MR}),
        regions=frozenset({AnatomicalRegion.BRAIN}),
        species=frozenset({Species.CANINE}),
        source_kind=SourceKind.MOCK,
        allows_pixel_analysis=False,
        adapter_kind="python",
        description="smoke",
    )
    assert cap.model_id == "smoke-plugin-v1"
    assert Modality.MR in cap.modalities
