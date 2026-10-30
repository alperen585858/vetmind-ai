"""Metadata-only preparation pipeline — never loads pixel tensors by default."""

from __future__ import annotations

from pathlib import Path

from app.imaging.contracts import PreprocessingContract, TransformProvenance, metadata_only_contract
from app.imaging.decoder import AuthorizedDicomDecoder
from app.imaging.interfaces import PrepValidationError
from app.imaging.profiles import profile_for_modality
from app.models.model_input_builder import build_imaging_model_input
from app.models.pixel_authorization import evaluate_pixel_access
from app.routing.capabilities import ModelCapability, default_capabilities
from app.schemas.case import CaseRecord
from app.schemas.enums import Modality
from app.schemas.model_input import ImagingModelInput


class MetadataOnlyPreparationPipeline:
    """Default Phase 3 preparer: builds ImagingModelInput without decoding pixels.

    Pixel decode boundaries call ``assert_pixel_access_allowed`` which always
    denies unless authorization + contract.requires_pixels + build opt-in allow it.
    """

    def __init__(
        self,
        capabilities: list[ModelCapability] | None = None,
        *,
        pixel_analysis_opt_in: bool = False,
        quarantine_root: Path | None = None,
    ) -> None:
        self._capabilities = list(capabilities) if capabilities is not None else list(default_capabilities())
        self._pixel_analysis_opt_in = bool(pixel_analysis_opt_in)
        self._quarantine_root = quarantine_root

    def prepare(
        self,
        *,
        case: CaseRecord,
        contract: PreprocessingContract | None = None,
    ) -> ImagingModelInput:
        contract = contract or metadata_only_contract("metadata-pipeline")
        model_input = build_imaging_model_input(
            case,
            capabilities=self._capabilities,
            pixel_analysis_opt_in=self._pixel_analysis_opt_in,
        )
        if contract.requires_pixels:
            self.assert_pixel_access_allowed(case, contract)
            if not self._pixel_analysis_opt_in:
                raise PrepValidationError(
                    "Pixel decode opt-in is disabled (VETMIND_PIXEL_ANALYSIS_OPT_IN)."
                )
            model_input = self._probe_decode_selected_frames(case, model_input, contract)
        self.validate_input(model_input, contract)
        return model_input

    def _probe_decode_selected_frames(
        self,
        case: CaseRecord,
        model_input: ImagingModelInput,
        contract: PreprocessingContract,
    ) -> ImagingModelInput:
        """Verify decode on selected quarantined frames; sets pixel_tensor_ready flags only."""
        if self._quarantine_root is None:
            raise PrepValidationError("Quarantine root is required for pixel decode.")
        decoder = AuthorizedDicomDecoder(quarantine_root=self._quarantine_root)
        selected = set(model_input.selection.series_instance_uids or [])
        decoded_count = 0
        series_out = []
        for series in model_input.series:
            if selected and series.series_instance_uid not in selected:
                series_out.append(series)
                continue
            frames_out = []
            for frame in series.frames:
                rel = frame.quarantine_relative_path
                if not rel:
                    frames_out.append(frame)
                    continue
                decoder.decode_instance(quarantine_relative_path=rel, contract=contract)
                frames_out.append(frame.model_copy(update={"pixel_tensor_ready": True}))
                decoded_count += 1
            series_out.append(series.model_copy(update={"frames": frames_out}))
        if decoded_count == 0:
            raise PrepValidationError(
                "Pixel contract satisfied but no quarantined frames could be decoded."
            )
        warnings = list(model_input.warnings) + [
            f"Pixel opt-in decode probe: {decoded_count} frame(s) verified under {contract.contract_id}."
        ]
        return model_input.model_copy(
            update={
                "series": series_out,
                "metadata_only": False,
                "warnings": warnings,
            }
        )

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
            pixel_analysis_opt_in=self._pixel_analysis_opt_in,
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
            case,
            model_ids=prepared,
            capabilities=self._capabilities,
            pixel_analysis_opt_in=self._pixel_analysis_opt_in,
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

    def pixel_contract_for_case(self, case: CaseRecord, *, model_id: str) -> PreprocessingContract:
        """Resolve preprocessing profile for explicit pixel prep (opt-in builds only)."""
        cap = next((c for c in self._capabilities if c.model_id == model_id), None)
        regions = frozenset({case.anatomical_region})
        species = frozenset({case.species})
        if case.modality not in {Modality.MR, Modality.CT, Modality.XR}:
            raise PrepValidationError(f"No pixel profile for modality {case.modality.value}.")
        return profile_for_modality(
            case.modality,
            model_id,
            regions=regions,
            species=species,
            version=cap.model_version if cap else "1.0.0",
        )
