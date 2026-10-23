"""Lightweight synthetic Vision adapter for contract verification (no real inference).

Produces ModelTaskOutputs-shaped structures and maps them to StructuredFindings.
Always source_kind=MOCK / synthetic=True. Never used as a silent clinical fallback.
"""

from __future__ import annotations

from app.models.interfaces import ImagingModel
from app.models.model_input_builder import require_model_input
from app.models.task_output_mapper import map_task_outputs_to_findings
from app.schemas.case import CaseRecord
from app.schemas.enums import FindingStatus, ModelExecutionStatus, SourceKind
from app.schemas.findings import StructuredFindings
from app.schemas.model_outputs import (
    BoundingBox2D,
    ClassificationLabel,
    ClassificationOutput,
    DetectionOutput,
    MeasurementOutput,
    MeasurementValue,
    ModelTaskOutputs,
    SegmentationOutput,
    SegmentationRegion,
)

SYNTHETIC_MODEL_ID = "synthetic-contract-sim-v1"
SYNTHETIC_VERSION = "0.1.0-sim"


class SyntheticContractSimulator:
    """Verifies input package + task output contracts with deterministic synthetic heads."""

    model_id = SYNTHETIC_MODEL_ID
    version = SYNTHETIC_VERSION

    def analyze(self, case: CaseRecord) -> StructuredFindings:
        model_input = require_model_input(case)
        outputs = self.build_task_outputs(case)
        findings = map_task_outputs_to_findings(case, outputs)
        findings.warnings.append(
            f"Consumed ImagingModelInput v{model_input.schema_version}; "
            f"metadata_only={model_input.metadata_only}; "
            f"pixel_analysis_authorized={model_input.pixel_analysis_authorized}."
        )
        findings.processing_metadata = {
            **findings.processing_metadata,
            "adapter": "synthetic_contract_simulator",
            "instances": str(model_input.total_instances),
        }
        return findings

    def build_task_outputs(self, case: CaseRecord) -> ModelTaskOutputs:
        """Emit one example of each supported task head (clearly synthetic)."""
        return ModelTaskOutputs(
            model_id=self.model_id,
            model_version=self.version,
            case_id=case.case_id,
            execution_status=ModelExecutionStatus.SUCCESS,
            source_kind=SourceKind.MOCK,
            classification=ClassificationOutput(
                labels=[
                    ClassificationLabel(
                        label="SYNTHETIC_CLASS_PROBE",
                        score=None,
                        finding_status=FindingStatus.NOT_ASSESSED,
                    )
                ],
                top_label="SYNTHETIC_CLASS_PROBE",
            ),
            detection=DetectionOutput(
                boxes=[
                    BoundingBox2D(
                        x_min=10.0,
                        y_min=10.0,
                        x_max=40.0,
                        y_max=40.0,
                        label="SYNTHETIC_BOX",
                        score=None,
                        frame_index=0,
                    )
                ]
            ),
            segmentation=SegmentationOutput(
                regions=[
                    SegmentationRegion(
                        region_id="syn-region-1",
                        label="SYNTHETIC_MASK",
                        mask_encoding="none",
                        score=None,
                    )
                ]
            ),
            measurements=MeasurementOutput(
                measurements=[
                    MeasurementValue(
                        measurement_id="syn-meas-1",
                        name="synthetic_span_mm",
                        value=0.0,
                        unit="mm",
                        anatomical_location=case.anatomical_region.value,
                        note="Synthetic measurement for contract probe only.",
                    )
                ]
            ),
            warnings=[
                "SYNTHETIC CONTRACT SIMULATOR — not medical image interpretation.",
                "Scores intentionally omitted (never invented).",
            ],
            processing_metadata={"adapter": "synthetic_contract_simulator"},
        )


def build_synthetic_simulator() -> ImagingModel:
    return SyntheticContractSimulator()
