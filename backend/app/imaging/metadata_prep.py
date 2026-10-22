"""Metadata-only preparation pipeline — never loads pixel tensors by default."""

from __future__ import annotations

from app.imaging.contracts import PreprocessingContract, TransformProvenance, metadata_only_contract
from app.imaging.interfaces import PrepValidationError
from app.models.model_input_builder import build_imaging_model_input
from app.models.pixel_authorization import evaluate_pixel_access
from app.routing.capabilities import ModelCapability, default_capabilities
from app.schemas.case import CaseRecord
from app.schemas.model_input import ImagingModelInput


class MetadataOnlyPreparationPipeline:
    """Default Phase 3 preparer: builds ImagingModelInput without decoding pixels.

    Pixel decode boundaries call ``assert_pixel_access_allowed`` which always
    denies unless authorization + contract.requires_pixels + capability allow it.
    """

    def __init__(self, capabilities: list[ModelCapability] | None = None) -> None:
        self._capabilities = list(capabilities) if capabilities is not None else list(default_capabilities())

    def prepare(
        self,
        *,
        case: CaseRecord,
        contract: PreprocessingContract | None = None,
    ) -> ImagingModelInput:
        contract = contract or metadata_only_contract("metadata-pipeline")
        if contract.requires_pixels:
            self.assert_pixel_access_allowed(case, contract)
            raise PrepValidationError(
                "Pixel preparation is not implemented in this build. "
                "Configure a real decoder only after authorization and a pixel contract."
            )
        model_input = build_imaging_model_input(case, capabilities=self._capabilities)
        self.validate_input(model_input, contract)
        return model_input

    def validate_input(self, model_input: ImagingModelInput, contract: PreprocessingContract) -> None:
        if not model_input.case_id:
            raise PrepValidationError("ImagingModelInput.case_id is required.")
        if contract.requires_pixels and model_input.metadata_only:
            raise PrepValidationError(
                "Contract requires pixels but ImagingModelInput is metadata_only."
            )
        if contract.requires_pixels and not model_input.pixel_analysis_authorized:
            raise PrepValidationError("Pixel analysis is not authorized for this case.")
        # Transfer syntax allow-list (when declared on contract).
        if contract.allowed_transfer_syntaxes:
            for series in model_input.series:
                for frame in series.frames:
                    ts = frame.transfer_syntax_uid
                    if not ts:
                        raise PrepValidationError(
                            f"Missing transfer_syntax_uid required by contract {contract.contract_id}."
                        )
                    if ts not in contract.allowed_transfer_syntaxes:
                        raise PrepValidationError(
                            f"Unsupported transfer syntax {ts} for contract {contract.contract_id}."
                        )

    def assert_pixel_access_allowed(self, case: CaseRecord, contract: PreprocessingContract) -> None:
        """Enforce default-deny at every pixel boundary."""
        if not contract.requires_pixels:
            raise PrepValidationError("Contract does not require pixels; decode denied.")
        by_id = {c.model_id: c for c in self._capabilities}
        decision = evaluate_pixel_access(
            case,
            model_id=contract.model_id,
            capability=by_id.get(contract.model_id),
        )
        if not decision.authorized:
            codes = ", ".join(decision.reason_codes) or "unauthorized"
            raise PrepValidationError(f"Pixel access denied: {codes}")

    def provenance_for_metadata(self, case: CaseRecord) -> TransformProvenance:
        prepared = [
            c.model_id
            for c in self._capabilities
            if c.enabled
            and case.modality in c.modalities
            and case.anatomical_region in c.regions
            and (c.species is None or case.species in c.species)
        ]
        from app.models.pixel_authorization import summarize_pixel_authorization

        summary = summarize_pixel_authorization(
            case, model_ids=prepared, capabilities=self._capabilities
        )
        sops: list[str] = []
        if case.dicom_study:
            for series in case.dicom_study.series:
                for inst in series.instances:
                    sops.append(inst.sop_instance_uid)
        return TransformProvenance(
            contract_id="meta-only",
            steps=(),
            source_sop_uids=tuple(sops),
            pixels_loaded=False,
            authorization_reason_codes=tuple(summary.reason_codes),
            note="Metadata-only prep; pixels not loaded.",
        )
