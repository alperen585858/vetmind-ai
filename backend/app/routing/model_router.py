from dataclasses import dataclass

from app.imaging.pixel_ops import parse_image_position
from app.imaging.series_selection import case_dimensionality_ok, select_series_for_modality
from app.routing.capabilities import (
    AVAILABILITY_NOT_CONFIGURED,
    INPUT_METADATA_ONLY,
    INPUT_PIXELS_2D,
    INPUT_PIXELS_3D,
    ModelCapability,
    default_capabilities,
)
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, Modality, Species
from app.schemas.model_input import ModelInputFrameRef, ModelInputSeriesRef

MANUAL_REVIEW_MODEL = "manual-review"


@dataclass(frozen=True)
class RouteDecision:
    supported: bool
    model_ids: list[str]
    reason: str
    rule_id: str | None = None
    matched_capabilities: tuple[str, ...] = ()


def cap_input_compatible(
    cap: ModelCapability,
    case: CaseRecord,
    *,
    pixel_analysis_opt_in: bool = False,
) -> bool:
    """Reject pixel-requiring models when authorization/geometry cannot satisfy them."""
    from app.models.pixel_authorization import evaluate_pixel_access

    reqs = cap.input_requirements or frozenset({INPUT_METADATA_ONLY})
    needs_pixels = bool(reqs & {INPUT_PIXELS_2D, INPUT_PIXELS_3D})
    if not needs_pixels:
        return True
    if not cap.allows_pixel_analysis:
        return False
    decision = evaluate_pixel_access(
        case,
        model_id=cap.model_id,
        capability=cap,
        pixel_analysis_opt_in=pixel_analysis_opt_in,
    )
    if not decision.authorized:
        return False
    series = _series_refs_from_case(case)
    selection = select_series_for_modality(series, case.modality)
    spatial_n = sum(
        1 for f in selection.frames if parse_image_position(f.image_position_patient)
    )
    ok, _reason = case_dimensionality_ok(
        modality=case.modality,
        frame_count=len(selection.frames),
        spatial_frame_count=spatial_n,
        requires_2d=INPUT_PIXELS_2D in reqs,
        requires_3d=INPUT_PIXELS_3D in reqs,
    )
    return ok


def _series_refs_from_case(case: CaseRecord) -> list[ModelInputSeriesRef]:
    if case.model_input is not None and case.model_input.series:
        return list(case.model_input.series)
    series: list[ModelInputSeriesRef] = []
    if case.dicom_study is None:
        return series
    for ser in case.dicom_study.series:
        frames = [
            ModelInputFrameRef(
                sop_instance_uid=inst.sop_instance_uid,
                series_instance_uid=ser.series_instance_uid,
                instance_number=inst.instance_number,
                has_pixel_data=inst.has_pixel_data,
                image_position_patient=inst.image_position_patient,
            )
            for inst in ser.instances
        ]
        series.append(
            ModelInputSeriesRef(
                series_instance_uid=ser.series_instance_uid,
                modality=ser.modality,
                frame_count=len(frames),
                frames=frames,
            )
        )
    return series


def list_routable_capabilities(
    case: CaseRecord,
    capabilities: list[ModelCapability],
    *,
    pixel_analysis_opt_in: bool = False,
) -> list[ModelCapability]:
    """Capabilities that would be selected by ModelRouter (anatomy + input-compatible).

    Shared with ImagingModelInput.prepared_for_models so readiness UI cannot overstate
    runnable adapters relative to the orchestrator route.
    """
    anatomy = [
        cap
        for cap in capabilities
        if ModelRouter._matches_anatomy(cap, case)  # noqa: SLF001 — shared pure filter
    ]
    anatomy.sort(key=lambda c: (c.priority, c.model_id))
    return [
        cap
        for cap in anatomy
        if cap_input_compatible(cap, case, pixel_analysis_opt_in=pixel_analysis_opt_in)
    ]


def list_routable_model_ids(
    case: CaseRecord,
    capabilities: list[ModelCapability],
    *,
    pixel_analysis_opt_in: bool = False,
) -> list[str]:
    """Deduplicated model_ids from list_routable_capabilities (stable order)."""
    return list(
        dict.fromkeys(
            c.model_id
            for c in list_routable_capabilities(
                case, capabilities, pixel_analysis_opt_in=pixel_analysis_opt_in
            )
        )
    )


class ModelRouter:
    """Capability-based router. No LLM. No MockScenario. No concrete adapter imports.

    Matches case modality, anatomical region, species, input requirements, and
    preprocessing/pixel constraints against ModelCapability entries.
    """

    def __init__(
        self,
        capabilities: list[ModelCapability] | None = None,
        *,
        pixel_analysis_opt_in: bool = False,
    ) -> None:
        self._capabilities = list(capabilities if capabilities is not None else default_capabilities())
        self._pixel_analysis_opt_in = bool(pixel_analysis_opt_in)

    def replace_capabilities(self, capabilities: list[ModelCapability]) -> None:
        self._capabilities = list(capabilities)

    def list_capabilities(self) -> list[ModelCapability]:
        return list(self._capabilities)

    def route(self, case: CaseRecord) -> RouteDecision:
        anatomy_matches = [cap for cap in self._capabilities if self._matches_anatomy(cap, case)]
        anatomy_matches.sort(key=lambda c: (c.priority, c.model_id))

        if not anatomy_matches:
            return RouteDecision(
                supported=False,
                model_ids=[MANUAL_REVIEW_MODEL],
                reason=(
                    f"No enabled model capability for "
                    f"{case.modality.value} + {case.anatomical_region.value} + {case.species.value}. "
                    "Routed to manual review."
                ),
                rule_id="fallback.manual_review",
            )

        compatible = [cap for cap in anatomy_matches if self._input_compatible(cap, case)]
        if not compatible:
            ids = ", ".join(c.model_id for c in anatomy_matches)
            return RouteDecision(
                supported=False,
                model_ids=[MANUAL_REVIEW_MODEL],
                reason=(
                    f"Models matched anatomy ({ids}) but input/preprocessing requirements "
                    "are unsupported for this case. Routed to manual review."
                ),
                rule_id="fallback.manual_review.unsupported_input",
                matched_capabilities=tuple(c.model_id for c in anatomy_matches),
            )

        model_ids = list(dict.fromkeys(c.model_id for c in compatible))
        return RouteDecision(
            supported=True,
            model_ids=model_ids,
            reason=(
                f"Matched {len(model_ids)} model(s) for "
                f"{case.modality.value} + {case.anatomical_region.value} + {case.species.value}."
            ),
            rule_id=f"capability.{case.modality.value}.{case.anatomical_region.value}",
            matched_capabilities=tuple(c.model_id for c in compatible),
        )

    @staticmethod
    def _matches_anatomy(cap: ModelCapability, case: CaseRecord) -> bool:
        if not cap.enabled:
            return False
        if cap.availability == AVAILABILITY_NOT_CONFIGURED:
            return False
        if case.modality not in cap.modalities:
            return False
        if case.anatomical_region not in cap.regions:
            return False
        if cap.species is not None and case.species not in cap.species:
            return False
        return True

    def _input_compatible(self, cap: ModelCapability, case: CaseRecord) -> bool:
        return cap_input_compatible(
            cap,
            case,
            pixel_analysis_opt_in=self._pixel_analysis_opt_in,
        )

    @staticmethod
    def _series_refs(case: CaseRecord) -> list[ModelInputSeriesRef]:
        if case.model_input is not None:
            return list(case.model_input.series)
        if case.dicom_study is None:
            return []
        out: list[ModelInputSeriesRef] = []
        for ser in case.dicom_study.series:
            frames = [
                ModelInputFrameRef(
                    sop_instance_uid=inst.sop_instance_uid,
                    series_instance_uid=ser.series_instance_uid,
                    instance_number=inst.instance_number,
                    has_pixel_data=inst.has_pixel_data,
                    image_position_patient=inst.image_position_patient,
                    quarantine_relative_path=inst.quarantine_relative_path,
                    ingest_id=inst.ingest_id,
                )
                for inst in ser.instances
            ]
            out.append(
                ModelInputSeriesRef(
                    series_instance_uid=ser.series_instance_uid,
                    modality=ser.modality,
                    frame_count=len(frames),
                    frames=frames,
                )
            )
        return out


# Backward-compatible alias used by older tests/docs naming.
def RouteRule(*, modality: Modality, region: AnatomicalRegion, model_ids: tuple[str, ...], description: str = "") -> ModelCapability:
    """Deprecated helper: builds a ModelCapability from the old RouteRule shape."""
    return ModelCapability(
        model_id=model_ids[0],
        modalities=frozenset({modality}),
        regions=frozenset({region}),
        species=None,
        priority=10,
        description=description or f"{modality.value}+{region.value}",
    )
