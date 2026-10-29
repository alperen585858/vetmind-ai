from app.models.interfaces import ImagingAdapterError, ImagingModel
from app.schemas.case import CaseRecord
from app.schemas.enums import (
    FindingStatus,
    MockScenario,
    ModelExecutionStatus,
    SourceKind,
)
from app.schemas.findings import EvidenceReference, Finding, StructuredFindings

MOCK_DISCLAIMER = ""
ABSENCE_WARNING = (
    "Bulgu dönmedi. Bulgu olmaması, hastalığın olmadığının doğrulandığı anlamına gelmez."
)


_REGION_TR = {"BRAIN": "beyin", "CERVICAL": "servikal", "THORAX": "toraks", "OTHER": "diğer", "UNKNOWN": "bilinmeyen bölge"}


class MockVisionError(ImagingAdapterError):
    """Deterministic mock execution failure (subclass of ImagingAdapterError)."""


DICOM_METADATA_ONLY_WARNING = ""


def _base(
    case: CaseRecord,
    *,
    model_id: str,
    version: str,
    status: ModelExecutionStatus,
) -> StructuredFindings:
    warnings: list[str] = []
    if case.model_input is not None:
        mi = case.model_input
        warnings.append(
            f"Kullanılan ImagingModelInput v{mi.schema_version}: "
            f"{mi.total_instances} görüntü / {len(mi.series)} seri; "
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
        uncertainty_note=uncertainty_note,
        synthetic=True,
    )


class MockBrainMriModel:
    model_id = "mock-brain-mri-v1"
    version = "0.1.0"

    def analyze(self, case: CaseRecord) -> StructuredFindings:
        if case.scenario == MockScenario.MODEL_FAILURE:
            raise MockVisionError("Demo beyin MR modeli bilinçli olarak hata verdi (senaryo: model hatası).")
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
                    "Olfaktör bulbus bölgesi yakınında şüpheli ekstra-aksiyel kitle etkisi."
                ),
                anatomical_location="beyin / olfaktör bulbus bölgesi",
                finding_status=FindingStatus.SUSPECTED,
                model_id=self.model_id,
                version=self.version,
                evidence=[
                    EvidenceReference(
                        evidence_id=f"{case.case_id}-ev-brain-01",
                        description="T2A transvers seri ipucu.",
                        series_hint="T2A transvers",
                        note="",
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
                    "Olfaktör bulbusta belirgin kitle etkisi izlenmedi."
                ),
                anatomical_location="beyin / olfaktör bulbus bölgesi",
                finding_status=FindingStatus.UNCERTAIN,
                model_id=self.model_id,
                version=self.version,
                uncertainty_note="Alternatif model ile çelişen bulgu.",
            )
        ]
        out.warnings.append("Çelişen model çıktıları — her iki bulgu da incelenmeli.")
        return out


class MockCervicalMriModel:
    model_id = "mock-cervical-mri-v1"
    version = "0.1.0"

    def analyze(self, case: CaseRecord) -> StructuredFindings:
        if case.scenario == MockScenario.MODEL_FAILURE:
            raise MockVisionError("Demo servikal MR modeli bilinçli olarak hata verdi (senaryo: model hatası).")
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
                    "C2–C3 seviyesinde şüpheli ekstradural omurilik basısı."
                ),
                anatomical_location="servikal omurga / C2–C3",
                finding_status=FindingStatus.SUSPECTED,
                model_id=self.model_id,
                version=self.version,
                evidence=[
                    EvidenceReference(
                        evidence_id=f"{case.case_id}-ev-cerv-01",
                        description="T2A sagital seri ipucu.",
                        series_hint="T2A sagital",
                        note="",
                    )
                ],
            )
        ]
        return out


class MockCt3dModel:
    """Stub CT 3D adapter — synthetic findings only; no volume reconstruction."""

    model_id = "mock-ct-3d-v1"
    version = "0.1.0"

    def analyze(self, case: CaseRecord) -> StructuredFindings:
        if case.scenario == MockScenario.MODEL_FAILURE:
            raise MockVisionError("Demo BT 3B modeli bilinçli olarak hata verdi (senaryo: model hatası).")
        if case.scenario == MockScenario.NO_FINDINGS:
            out = _base(case, model_id=self.model_id, version=self.version, status=ModelExecutionStatus.SUCCESS)
            out.no_findings_returned = True
            out.warnings.append(ABSENCE_WARNING)
            return out
        out = _base(case, model_id=self.model_id, version=self.version, status=ModelExecutionStatus.SUCCESS)
        region = _REGION_TR.get(case.anatomical_region.value, case.anatomical_region.value.lower())
        out.findings = [
            _finding(
                finding_id=f"{case.case_id}-f-ct-01",
                finding_code="MOCK-CT-VOLUME-HINT",
                description=(
                    f"{region.capitalize()} çalışmasında olası yumuşak doku yoğunluk asimetrisi."
                ),
                anatomical_location=region,
                finding_status=FindingStatus.POSSIBLE,
                model_id=self.model_id,
                version=self.version,
                evidence=[
                    EvidenceReference(
                        evidence_id=f"{case.case_id}-ev-ct-01",
                        description="Aksiyel BT seri ipucu.",
                        series_hint="Aksiyel BT",
                        note="",
                    )
                ],
            )
        ]
        return out


class MockXrVisionModel:
    model_id = "mock-xr-vision-v1"
    version = "0.1.0"

    def analyze(self, case: CaseRecord) -> StructuredFindings:
        if case.scenario == MockScenario.MODEL_FAILURE:
            raise MockVisionError("Demo röntgen modeli bilinçli olarak hata verdi (senaryo: model hatası).")
        if case.scenario == MockScenario.NO_FINDINGS:
            out = _base(case, model_id=self.model_id, version=self.version, status=ModelExecutionStatus.SUCCESS)
            out.no_findings_returned = True
            out.warnings.append(ABSENCE_WARNING)
            return out
        out = _base(case, model_id=self.model_id, version=self.version, status=ModelExecutionStatus.SUCCESS)
        out.findings = [
            _finding(
                finding_id=f"{case.case_id}-f-xr-01",
                finding_code="MOCK-XR-THORAX-OPACITY",
                description=(
                    "Toraks grafisinde kaudal akciğer alanında olası interstisyel opasite."
                ),
                anatomical_location="toraks / kaudal akciğer alanı",
                finding_status=FindingStatus.SUSPECTED,
                model_id=self.model_id,
                version=self.version,
                evidence=[
                    EvidenceReference(
                        evidence_id=f"{case.case_id}-ev-xr-01",
                        description="Sağ lateral toraks projeksiyonu.",
                        series_hint="Sağ lateral toraks",
                        note="",
                    )
                ],
            )
        ]
        return out


class MockMultimodalVlmModel:
    """Document + text context stub (Image+Text branch in the architecture diagram)."""

    model_id = "mock-multimodal-vlm-v1"
    version = "0.1.0"

    def analyze(self, case: CaseRecord) -> StructuredFindings:
        out = _base(case, model_id=self.model_id, version=self.version, status=ModelExecutionStatus.SUCCESS)
        doc_count = len(case.document_context.documents) if case.document_context else 0
        preview = ""
        if case.document_context and case.document_context.combined_text_preview:
            preview = case.document_context.combined_text_preview[:280].replace("\n", " ")
        out.findings = [
            _finding(
                finding_id=f"{case.case_id}-f-vlm-01",
                finding_code="MOCK-VLM-DOCUMENT-CONTEXT",
                description=(
                    f"İncelenen belge sayısı: {doc_count}. "
                    f"{('Metin özeti: ' + preview) if preview else 'Çıkarılabilir metin yok.'}"
                ),
                anatomical_location="belge bağlamı",
                finding_status=FindingStatus.UNCERTAIN,
                model_id=self.model_id,
                version=self.version,
                uncertainty_note="Belge metni taslak bağlamıdır.",
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
            "Bu modalite/bölge otomatik analiz için desteklenmiyor. Vaka manuel radyolog incelemesine yönlendirildi."
        )
        out.no_findings_returned = True
        out.warnings.append(ABSENCE_WARNING)
        return out


def default_model_registry() -> dict[str, ImagingModel]:
    """Injectable adapter registry. Keys are model_id strings used by the router."""
    from app.models.synthetic_simulator import SYNTHETIC_MODEL_ID, build_synthetic_simulator

    registry: dict[str, ImagingModel] = {
        MockBrainMriModel.model_id: MockBrainMriModel(),
        MockBrainMriAltModel.model_id: MockBrainMriAltModel(),
        MockCervicalMriModel.model_id: MockCervicalMriModel(),
        MockCt3dModel.model_id: MockCt3dModel(),
        MockXrVisionModel.model_id: MockXrVisionModel(),
        MockMultimodalVlmModel.model_id: MockMultimodalVlmModel(),
        ManualReviewStub.model_id: ManualReviewStub(),
        # Disabled in default_capabilities — registered for readiness / direct probe only.
        SYNTHETIC_MODEL_ID: build_synthetic_simulator(),
    }
    return registry
