"""A box the model reports on a resized input is drawn at the matching place on the original slice."""

import numpy as np

from app.imaging.evidence_renderer import native_bbox_from_evidence
from app.imaging.preprocessor import ContractImagePreprocessor
from app.imaging.profiles import xray_2d_profile
from app.models.task_output_mapper import attach_spatial_chain
from app.schemas.enums import AnatomicalRegion, FindingStatus, Modality, ModelExecutionStatus, SourceKind, Species
from app.schemas.findings import BoundingBoxEvidence, EvidenceReference, Finding, StructuredFindings


def _findings(bbox: BoundingBoxEvidence) -> StructuredFindings:
    return StructuredFindings(
        case_id="c", species=Species.CANINE, modality=Modality.XR, anatomical_region=AnatomicalRegion.THORAX,
        source_model_id="m", source_model_version="1", source_kind=SourceKind.REAL,
        execution_status=ModelExecutionStatus.SUCCESS,
        findings=[Finding(
            finding_id="f1", finding_code="X", description="d", anatomical_location="l",
            finding_status=FindingStatus.SUSPECTED, source_model="m",
            evidence_references=[EvidenceReference(evidence_id="e1", description="box", bbox=bbox)],
        )],
    )


def test_resize_is_recorded_and_box_maps_back_to_native() -> None:
    contract = xray_2d_profile("xr-model")
    work, provenance = ContractImagePreprocessor().preprocess(
        volume={"pixels": np.random.rand(512, 512).astype("float32"), "sop_instance_uid": "1.2.3"},
        contract=contract,
        window_center=0.5,
        window_width=1.0,
        resize_hw=(128, 128),
        modality_hint="XR",
    )
    assert work["tensor"].shape[-2:] == (128, 128)
    assert [s["name"] for s in provenance.spatial_chain] == ["resize"]

    sf = attach_spatial_chain(
        _findings(BoundingBoxEvidence(x_min=20, y_min=20, x_max=40, y_max=40, coordinate_space="model_input")),
        provenance.spatial_chain,
    )
    bbox = sf.findings[0].evidence_references[0].bbox
    assert native_bbox_from_evidence(bbox) == (80.0, 80.0, 160.0, 160.0)


def test_native_and_already_chained_boxes_untouched() -> None:
    chain = ({"name": "resize", "params": {"sx": 0.25, "sy": 0.25, "src_h": 512, "src_w": 512, "dst_h": 128, "dst_w": 128}},)
    native = BoundingBoxEvidence(x_min=1, y_min=1, x_max=2, y_max=2)
    sf = attach_spatial_chain(_findings(native), chain)
    assert sf.findings[0].evidence_references[0].bbox.transform_chain == []
