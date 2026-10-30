"""Pixel-access authorization policy (default deny). Separate from any pixel loading.

This module never decodes, loads, or transmits pixel data. It only records whether
future pixel-based inference would be allowed given case permissions and model capability.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.routing.capabilities import ModelCapability
from app.schemas.case import CaseRecord
from app.schemas.enums import SourceKind
from app.schemas.model_input import PixelAuthorizationSummary

# Stable machine-readable denial/authorization codes (no paths / PII).
DENIED_MOCK_ADAPTER = "DENIED_MOCK_ADAPTER"
DENIED_MODEL_NOT_PIXEL_CAPABLE = "DENIED_MODEL_NOT_PIXEL_CAPABLE"
DENIED_CLASSIFICATION_UNCONFIRMED = "DENIED_CLASSIFICATION_UNCONFIRMED"
DENIED_STUDY_INTEGRITY = "DENIED_STUDY_INTEGRITY"
DENIED_SOURCE_PERMISSION_UNVERIFIED = "DENIED_SOURCE_PERMISSION_UNVERIFIED"
DENIED_CONSENT_UNVERIFIED = "DENIED_CONSENT_UNVERIFIED"
DENIED_NO_CANDIDATE_MODEL = "DENIED_NO_CANDIDATE_MODEL"
DENIED_PIXEL_OPT_IN = "DENIED_PIXEL_OPT_IN"
AUTHORIZED_POLICY_ONLY = "AUTHORIZED_POLICY_ONLY"


@dataclass(frozen=True)
class PixelAuthorizationDecision:
    """Per-model authorization outcome. Never embeds storage paths or credentials."""

    authorized: bool
    model_id: str
    reason_codes: tuple[str, ...]


def study_integrity_ok(case: CaseRecord) -> bool:
    """Study must have resolvable DICOM instance anchors for pixel consideration."""
    study = case.dicom_study
    if study is None:
        return False
    if not (study.study_instance_uid or "").strip():
        return False
    if not study.series:
        return False
    for series in study.series:
        if not (series.series_instance_uid or "").strip():
            return False
        if not series.instances:
            return False
        for inst in series.instances:
            if not (inst.sop_instance_uid or "").strip():
                return False
    return True


def evaluate_pixel_access(
    case: CaseRecord,
    *,
    model_id: str,
    capability: ModelCapability | None,
    pixel_analysis_opt_in: bool = False,
) -> PixelAuthorizationDecision:
    """Default-deny pixel authorization for a single model capability."""
    reasons: list[str] = []

    if capability is None:
        return PixelAuthorizationDecision(
            authorized=False,
            model_id=model_id,
            reason_codes=(DENIED_MODEL_NOT_PIXEL_CAPABLE,),
        )

    if capability.source_kind == SourceKind.MOCK or model_id.startswith("mock-"):
        reasons.append(DENIED_MOCK_ADAPTER)

    if not capability.allows_pixel_analysis:
        reasons.append(DENIED_MODEL_NOT_PIXEL_CAPABLE)

    from app.routing.capabilities import AVAILABILITY_SYNTHETIC

    if (
        capability.allows_pixel_analysis
        and not pixel_analysis_opt_in
        and capability.availability != AVAILABILITY_SYNTHETIC
    ):
        reasons.append(DENIED_PIXEL_OPT_IN)

    if not case.classification_confirmed:
        reasons.append(DENIED_CLASSIFICATION_UNCONFIRMED)

    if not study_integrity_ok(case):
        reasons.append(DENIED_STUDY_INTEGRITY)

    # If permissions/consent cannot be verified, deny (defaults are False).
    if not case.imaging_source_permission_verified:
        reasons.append(DENIED_SOURCE_PERMISSION_UNVERIFIED)
    if not case.imaging_analysis_consent_verified:
        reasons.append(DENIED_CONSENT_UNVERIFIED)

    # Never authorize from a config flag alone — all checks above must pass.
    if reasons:
        return PixelAuthorizationDecision(
            authorized=False,
            model_id=model_id,
            reason_codes=tuple(dict.fromkeys(reasons)),
        )

    return PixelAuthorizationDecision(
        authorized=True,
        model_id=model_id,
        reason_codes=(AUTHORIZED_POLICY_ONLY,),
    )


def summarize_pixel_authorization(
    case: CaseRecord,
    *,
    model_ids: list[str],
    capabilities: list[ModelCapability],
    pixel_analysis_opt_in: bool = False,
) -> PixelAuthorizationSummary:
    """Aggregate per-model decisions into a safe summary for ImagingModelInput."""
    by_id = {c.model_id: c for c in capabilities}
    if not model_ids:
        return PixelAuthorizationSummary(
            authorized=False,
            reason_codes=[DENIED_NO_CANDIDATE_MODEL],
            evaluated_model_ids=[],
        )

    all_codes: list[str] = []
    any_authorized = False
    for mid in model_ids:
        decision = evaluate_pixel_access(
            case,
            model_id=mid,
            capability=by_id.get(mid),
            pixel_analysis_opt_in=pixel_analysis_opt_in,
        )
        all_codes.extend(decision.reason_codes)
        if decision.authorized:
            any_authorized = True

    # Prefer authorization code when any model authorized; else unique denials.
    if any_authorized:
        codes = [AUTHORIZED_POLICY_ONLY]
    else:
        codes = list(dict.fromkeys(all_codes)) or [DENIED_NO_CANDIDATE_MODEL]

    return PixelAuthorizationSummary(
        authorized=any_authorized,
        reason_codes=codes,
        evaluated_model_ids=list(model_ids),
    )
