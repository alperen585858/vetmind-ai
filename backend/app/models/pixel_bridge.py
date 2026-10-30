"""Connect authorized DICOM pixel preprocessing to Vision model input adapters."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from typing import Any

import numpy as np

from app.imaging.contracts import PreprocessingContract
from app.imaging.decoder import AuthorizedDicomDecoder
from app.imaging.interfaces import PrepValidationError
from app.imaging.metadata_prep import MetadataOnlyPreparationPipeline
from app.imaging.preprocessor import ContractImagePreprocessor
from app.imaging.profiles import profile_for_modality
from app.imaging.volume import SliceOrderedVolumeAssembler
from app.models.bridge_resources import (
    ArtifactWorkspace,
    ResourceLimits,
    enforce_instance_limit,
    enforce_tensor_bytes,
)
from app.models.entrypoint import PreparedTensorBundle
from app.models.errors import IncompatibleInputError, ModelUnavailableError
from app.models.pixel_authorization import evaluate_pixel_access
from app.routing.capabilities import ModelCapability
from app.schemas.case import CaseRecord
from app.schemas.enums import Modality
from app.storage.quarantine import QuarantineStore


class AuthorizedPixelBridge:
    """Decode → assemble → preprocess only when pixel policy + contract allow it."""

    def __init__(
        self,
        *,
        quarantine: QuarantineStore | None,
        capabilities: list[ModelCapability],
        limits: ResourceLimits | None = None,
        artifact_root: Path | None = None,
        pixel_analysis_opt_in: bool = False,
    ) -> None:
        self._quarantine = quarantine
        self._capabilities = list(capabilities)
        self._limits = limits or ResourceLimits()
        self._artifact_root = artifact_root
        self._pixel_analysis_opt_in = bool(pixel_analysis_opt_in)
        self._decoder = AuthorizedDicomDecoder(
            quarantine_root=quarantine.root if quarantine else None
        )
        self._assembler = SliceOrderedVolumeAssembler()
        self._preprocessor = ContractImagePreprocessor()
        self._meta = MetadataOnlyPreparationPipeline(
            capabilities=self._capabilities,
            pixel_analysis_opt_in=self._pixel_analysis_opt_in,
            quarantine_root=quarantine.root if quarantine else None,
        )

    def prepare_for_model(
        self,
        case: CaseRecord,
        *,
        model_id: str,
        contract: PreprocessingContract | None = None,
        window_center: float | None = None,
        window_width: float | None = None,
        keep_tensor_in_memory: bool = False,
        workspace: ArtifactWorkspace | None = None,
    ) -> PreparedTensorBundle:
        by_id = {c.model_id: c for c in self._capabilities}
        cap = by_id.get(model_id)
        decision = evaluate_pixel_access(
            case,
            model_id=model_id,
            capability=cap,
            pixel_analysis_opt_in=self._pixel_analysis_opt_in,
        )
        if not decision.authorized:
            codes = ", ".join(decision.reason_codes) or "unauthorized"
            raise IncompatibleInputError(f"Pixel access denied: {codes}")

        contract = contract or profile_for_modality(
            case.modality,
            model_id,
            version=(cap.model_version if cap else "1.0.0"),
            regions=frozenset({case.anatomical_region}),
            species=frozenset({case.species}),
        )
        if case.modality not in contract.modalities and contract.modalities:
            raise IncompatibleInputError(
                f"Contract {contract.contract_id} does not support modality={case.modality.value}."
            )

        try:
            self._meta.assert_pixel_access_allowed(case, contract)
        except PrepValidationError as exc:
            raise IncompatibleInputError(str(exc)) from exc

        frames = collect_frames_with_bytes(case)
        enforce_instance_limit(len(frames), self._limits)
        if not frames:
            raise IncompatibleInputError("No DICOM frame references available for pixel prep.")

        decoded: list[dict[str, Any]] = []
        for fr in frames:
            rel = fr.get("quarantine_relative_path")
            raw = fr.get("bytes")
            try:
                if raw is not None:
                    decoded.append(self._decoder.decode_bytes(raw, contract=contract))
                elif rel and self._quarantine is not None:
                    decoded.append(
                        self._decoder.decode_instance(
                            quarantine_relative_path=str(rel),
                            contract=contract,
                        )
                    )
                else:
                    raise IncompatibleInputError(
                        "Frame lacks quarantine path and in-memory bytes; cannot decode."
                    )
            except PrepValidationError as exc:
                raise IncompatibleInputError(str(exc)) from exc

        # Preserve IPP / instance numbers from model input when decoder lacks them.
        for d, fr in zip(decoded, frames):
            if not d.get("image_position_patient") and fr.get("image_position_patient"):
                d["image_position_patient"] = fr["image_position_patient"]
            if d.get("instance_number") is None and fr.get("instance_number") is not None:
                d["instance_number"] = fr["instance_number"]

        try:
            if case.modality in {Modality.MR, Modality.CT} or contract.output_tensor_layout == "dhw":
                volume = self._assembler.assemble(case=case, contract=contract, decoded=decoded)
            else:
                # 2D: use first ordered slice (XR).
                volume = {
                    "pixels": decoded[0]["pixels"],
                    "pixel_spacing": decoded[0].get("pixel_spacing"),
                    "sop_instance_uid": decoded[0].get("sop_instance_uid"),
                    "sop_instance_uids": [decoded[0].get("sop_instance_uid")],
                }
            prepared, provenance = self._preprocessor.preprocess(
                volume=volume,
                contract=contract,
                window_center=window_center,
                window_width=window_width,
            )
        except PrepValidationError as exc:
            raise IncompatibleInputError(str(exc)) from exc

        tensor = prepared.get("tensor")
        if not isinstance(tensor, np.ndarray):
            raise IncompatibleInputError("Preprocessor did not produce a tensor.")
        enforce_tensor_bytes(int(tensor.nbytes), self._limits)

        provenance = replace(
            provenance,
            pixels_loaded=True,
            authorization_reason_codes=decision.reason_codes,
        )

        artifact_path: str | None = None
        if workspace is not None:
            # Persist shape sidecar only by default (not raw clinical pixels to disk unless asked).
            meta = (
                f"shape={','.join(str(x) for x in tensor.shape)}\n"
                f"layout={prepared.get('tensor_layout')}\n"
                f"contract={contract.contract_id}\n"
            ).encode("utf-8")
            artifact_path = str(workspace.write_bytes("prep_meta.txt", meta))
            if keep_tensor_in_memory is False and self._artifact_root is not None:
                # Optional compact float16 dump for local entrypoints under workspace.
                path = workspace.path / "tensor_f16.npy"
                np.save(path, tensor.astype(np.float16, copy=False))
                artifact_path = str(path)
                enforce_tensor_bytes(path.stat().st_size, self._limits)

        return PreparedTensorBundle(
            layout=str(prepared.get("tensor_layout") or contract.output_tensor_layout),
            tensor_shape=tuple(int(x) for x in tensor.shape),
            provenance=provenance,
            artifact_path=artifact_path,
            tensor=tensor if keep_tensor_in_memory else None,
            pixel_spacing_mm=prepared.get("pixel_spacing_mm")
            if isinstance(prepared.get("pixel_spacing_mm"), tuple)
            else None,
        )


def _collect_frame_refs(case: CaseRecord) -> list[dict[str, Any]]:
    """Collect frames for prep — prefer ImagingModelInput selection (Phase 20)."""
    from app.imaging.series_selection import select_series_for_modality

    refs: list[dict[str, Any]] = []
    mi = case.model_input
    if mi is not None:
        selected_uids = set(mi.selection.series_instance_uids) if mi.selection else set()
        series_list = list(mi.series)
        if selected_uids:
            series_list = [s for s in series_list if s.series_instance_uid in selected_uids]
        if not series_list:
            series_list = list(mi.series)
        selection = select_series_for_modality(series_list, case.modality)
        frames = selection.frames or tuple(
            fr for s in series_list for fr in s.frames
        )
        for fr in frames:
            refs.append(
                {
                    "quarantine_relative_path": fr.quarantine_relative_path,
                    "image_position_patient": fr.image_position_patient,
                    "instance_number": fr.instance_number,
                    "sop_instance_uid": fr.sop_instance_uid,
                    "ingest_id": fr.ingest_id,
                }
            )
        return refs
    if case.dicom_study is not None:
        from app.schemas.model_input import ModelInputFrameRef, ModelInputSeriesRef

        series_refs = []
        for series in case.dicom_study.series:
            frames = [
                ModelInputFrameRef(
                    sop_instance_uid=inst.sop_instance_uid,
                    series_instance_uid=series.series_instance_uid,
                    instance_number=inst.instance_number,
                    has_pixel_data=inst.has_pixel_data,
                    quarantine_relative_path=inst.quarantine_relative_path,
                    image_position_patient=inst.image_position_patient,
                    ingest_id=inst.ingest_id,
                )
                for inst in series.instances
            ]
            series_refs.append(
                ModelInputSeriesRef(
                    series_instance_uid=series.series_instance_uid,
                    modality=series.modality,
                    frame_count=len(frames),
                    frames=frames,
                )
            )
        selection = select_series_for_modality(series_refs, case.modality)
        for fr in selection.frames:
            refs.append(
                {
                    "quarantine_relative_path": fr.quarantine_relative_path,
                    "image_position_patient": fr.image_position_patient,
                    "instance_number": fr.instance_number,
                    "sop_instance_uid": fr.sop_instance_uid,
                    "ingest_id": fr.ingest_id,
                }
            )
    return refs


def attach_in_memory_dicom_bytes(case: CaseRecord, files: list[bytes]) -> CaseRecord:
    """Test helper: stash synthetic DICOM bytes on model_input frame dicts via extras.

    Production adapters read quarantine paths only. This mutates a shallow copy of
    frame metadata through a private list used by the bridge when present.
    """
    if case.model_input is None:
        raise ModelUnavailableError("model_input required before attaching in-memory DICOM.")
    # Store on case as ephemeral attribute for bridge (not persisted).
    setattr(case, "_bridge_in_memory_dicom", list(files))
    return case


def collect_frames_with_bytes(case: CaseRecord) -> list[dict[str, Any]]:
    refs = _collect_frame_refs(case)
    blobs: list[bytes] = list(getattr(case, "_bridge_in_memory_dicom", []) or [])
    if blobs and len(blobs) == len(refs):
        for ref, blob in zip(refs, blobs):
            ref["bytes"] = blob
    elif blobs and refs:
        # Align by index when counts differ — pad/truncate safely for probes.
        for i, ref in enumerate(refs):
            if i < len(blobs):
                ref["bytes"] = blobs[i]
    return refs
