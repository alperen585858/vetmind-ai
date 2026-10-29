from collections import defaultdict

from app.models.evidence_validation import validate_evidence_references
from app.models.mock_vision import ABSENCE_WARNING, MOCK_DISCLAIMER
from app.models.ontology import code_family
from app.schemas.enums import FindingStatus, ModelExecutionStatus, SourceKind
from app.schemas.findings import ConflictReasonCode, Finding, PotentialConflict, StructuredFindings
from app.schemas.model_input import ImagingModelInput

AGREEMENT_NOTE = (
    "Birden fazla model aynı konumda bulgu bildirdi. "
    "Modellerin uyuşması klinik doğruluğu kanıtlamaz."
)

_OPPOSING_LATERALITY = {
    frozenset({"LEFT", "RIGHT"}),
}


def _resolve_source_kind(kinds: list[SourceKind]) -> SourceKind:
    unique = list(dict.fromkeys(kinds))
    if not unique:
        return SourceKind.MOCK
    if len(unique) == 1:
        return unique[0]
    return SourceKind.MIXED


def _location_key(location: str) -> str:
    return " ".join(location.strip().lower().split())


def _primary_series_uid(finding: Finding) -> str | None:
    """Best-effort DICOM series anchor from evidence refs (F9)."""
    for ref in finding.evidence_references:
        if ref.series_instance_uid:
            return ref.series_instance_uid
    return None


def _primary_sop_frame(finding: Finding) -> tuple[str, int | None] | None:
    for ref in finding.evidence_references:
        if ref.sop_instance_uid:
            return (ref.sop_instance_uid, ref.frame_index)
    return None


def _conflict_group_key(finding: Finding) -> str:
    """Priority: SOP+frame → series UID → normalized location (soft).

    Code-family is used *inside* a group to decide hard vs soft conflict
    (ISS-FUS-01), not as part of the group key — otherwise cross-family
    findings on the same series would never meet.
    """
    sop = _primary_sop_frame(finding)
    if sop is not None:
        uid, frame = sop
        frame_part = f"frame:{frame}" if frame is not None else "frame:any"
        return f"sop:{uid}|{frame_part}"

    series = _primary_series_uid(finding)
    if series:
        return f"series:{series}"

    return f"loc:{_location_key(finding.anatomical_location)}"


def _laterality_opposes(a: str, b: str) -> bool:
    pair = frozenset({a, b})
    return pair in _OPPOSING_LATERALITY


def detect_potential_conflicts(findings: list[Finding]) -> list[PotentialConflict]:
    """Generic conflict flags. Findings are never dropped or auto-resolved.

    Grouping uses SOP → series+family → location. Laterality LEFT vs RIGHT is a
    hard conflict within a group. Cross-family codes conflict; same-family code
    differences alone are soft (status-driven).
    """
    by_key: dict[str, list[Finding]] = defaultdict(list)
    for finding in findings:
        by_key[_conflict_group_key(finding)].append(finding)

    conflicts: list[PotentialConflict] = []
    for idx, (group_key, group) in enumerate(sorted(by_key.items())):
        if len(group) < 2:
            continue
        models = {f.source_model for f in group}
        codes = {f.finding_code for f in group}
        families = {code_family(f.finding_code) for f in group}
        statuses = {f.finding_status for f in group}
        lateralities = {f.laterality for f in group}

        if len(models) < 2:
            # Single-model duplicates are not multi-adapter conflicts.
            # Exception: opposing laterality still deserves a flag.
            laterality_clash = any(
                _laterality_opposes(a.laterality, b.laterality)
                for i, a in enumerate(group)
                for b in group[i + 1 :]
            )
            if not laterality_clash:
                continue

        cross_family = len(families) >= 2
        incompatible_codes = len(codes) >= 2 and cross_family
        same_family_diff = len(codes) >= 2 and not cross_family
        opposing_status = FindingStatus.SUSPECTED in statuses and FindingStatus.UNCERTAIN in statuses
        soft_status = len(statuses) >= 2 and (incompatible_codes or same_family_diff)
        laterality_clash = any(
            _laterality_opposes(a.laterality, b.laterality)
            for i, a in enumerate(group)
            for b in group[i + 1 :]
        )
        same_sop = group_key.startswith("sop:")

        if not (incompatible_codes or opposing_status or soft_status or laterality_clash):
            continue

        conflict_id = f"conflict-{idx + 1}"
        reason_codes: list[str] = [ConflictReasonCode.MULTI_MODEL.value]
        reason_parts: list[str] = []
        if incompatible_codes:
            reason_codes.append(ConflictReasonCode.CROSS_FAMILY.value)
            reason_codes.append(ConflictReasonCode.DISTINCT_CODES.value)
            reason_parts.append(f"farklı bulgu kodları={sorted(codes)} aileler={sorted(families)}")
        elif same_family_diff and (opposing_status or soft_status):
            reason_codes.append(ConflictReasonCode.DISTINCT_CODES.value)
            reason_parts.append(f"aynı ailede farklı kodlar={sorted(codes)}")
        if opposing_status or soft_status:
            reason_codes.append(ConflictReasonCode.OPPOSING_STATUS.value)
            reason_parts.append(f"farklı durumlar={[s.value for s in statuses]}")
        if laterality_clash:
            reason_codes.append(ConflictReasonCode.OPPOSING_LATERALITY.value)
            reason_parts.append(f"zıt taraf (lateralite)={sorted(lateralities)}")
        if same_sop:
            reason_codes.append(ConflictReasonCode.SAME_SOP_DIVERGENT.value)
        reason_parts.append(f"modeller={sorted(models)}")
        reason_parts.append(f"grup={group_key}")
        series_uids = {s for s in (_primary_series_uid(f) for f in group) if s}
        if series_uids:
            reason_parts.append(f"seriler={sorted(series_uids)}")

        # Deduplicate reason codes while preserving order
        reason_codes = list(dict.fromkeys(reason_codes))

        for finding in group:
            finding.conflict_group_id = conflict_id

        loc_key = _location_key(group[0].anatomical_location)
        conflicts.append(
            PotentialConflict(
                conflict_id=conflict_id,
                finding_ids=[f.finding_id for f in group],
                anatomical_location_key=loc_key if group_key == f"loc:{loc_key}" else group_key,
                reason="OLASI ÇELİŞKİ KORUNDU: " + "; ".join(reason_parts),
                reason_codes=reason_codes,
                group_key=group_key,
            )
        )
    return conflicts


def normalize_outputs(
    outputs: list[StructuredFindings],
    *,
    model_input: ImagingModelInput | None = None,
) -> StructuredFindings:
    """Evidence fusion: merge adapter outputs without silently resolving disagreements.

    Preserves findings, model IDs/versions, source kinds, and evidence references.
    Does not fabricate confidence scores. Flags dangling structured DICOM evidence when
    ``model_input`` is provided.
    """
    if not outputs:
        raise ValueError("No model outputs to normalize.")

    primary = outputs[0]
    merged_findings: list[Finding] = []
    warnings: list[str] = []
    model_ids: list[str] = []
    source_kinds: list[SourceKind] = []
    statuses: list[ModelExecutionStatus] = []
    versions_by_model: dict[str, str] = {}

    for out in outputs:
        for finding in out.findings:
            # Preserve provenance on each finding (copy to avoid cross-mutation surprises).
            merged_findings.append(
                finding.model_copy(
                    update={
                        "source_model_version": finding.source_model_version or out.source_model_version,
                    }
                )
            )
        warnings.extend(out.warnings)
        model_ids.extend(out.contributing_model_ids or [out.source_model_id])
        source_kinds.append(out.source_kind)
        if out.contributing_source_kinds:
            source_kinds.extend(out.contributing_source_kinds)
        statuses.append(out.execution_status)
        versions_by_model[out.source_model_id] = out.source_model_version

    conflicts = detect_potential_conflicts(merged_findings)
    for conflict in conflicts:
        warnings.append(conflict.reason)
        warnings.append(conflict.note)

    # Same location + same code from multiple models: agreement is not clinical proof.
    loc_code_models: dict[tuple[str, str], set[str]] = defaultdict(set)
    for finding in merged_findings:
        loc_code_models[(_location_key(finding.anatomical_location), finding.finding_code)].add(
            finding.source_model
        )
    if any(len(models) >= 2 for models in loc_code_models.values()):
        warnings.append(AGREEMENT_NOTE)

    if ModelExecutionStatus.FAILED in statuses:
        status = ModelExecutionStatus.FAILED
    elif ModelExecutionStatus.UNSUPPORTED in statuses and all(
        s in {ModelExecutionStatus.UNSUPPORTED, ModelExecutionStatus.FAILED} for s in statuses
    ):
        status = ModelExecutionStatus.UNSUPPORTED
    elif len(set(statuses)) > 1 or ModelExecutionStatus.PARTIAL in statuses:
        status = ModelExecutionStatus.PARTIAL
    else:
        status = statuses[0]

    no_findings = len(merged_findings) == 0
    if no_findings and ABSENCE_WARNING not in warnings:
        warnings.append(ABSENCE_WARNING)

    resolved_kind = _resolve_source_kind(source_kinds)
    unique_kinds = list(dict.fromkeys(source_kinds))
    unique_models = list(dict.fromkeys(model_ids))

    if MOCK_DISCLAIMER and resolved_kind in {SourceKind.MOCK, SourceKind.MIXED} and MOCK_DISCLAIMER not in warnings:
        warnings.insert(0, MOCK_DISCLAIMER)
    if resolved_kind == SourceKind.MIXED:
        warnings.append(
            "KARMA KAYNAK: katkı veren modeller birden fazla kaynak türü bildirdi. "
            "Katkı veren kaynakları ve her bulgunun modelini inceleyin."
        )

    # Flag contradictory finding-level provenance; never silently rewrite.
    for finding in merged_findings:
        parent_kinds = {
            out.source_kind
            for out in outputs
            if finding.source_model in (out.contributing_model_ids or [out.source_model_id])
            or finding.source_model == out.source_model_id
        }
        if SourceKind.REAL in parent_kinds and finding.synthetic:
            warnings.append(
                f"{finding.finding_id} için çelişkili kaynak bilgisi: "
                "gerçek kaynaklı bulgu sentetik olarak işaretli (değiştirilmeden korundu)."
            )
        if parent_kinds == {SourceKind.MOCK} and not finding.synthetic:
            warnings.append(
                f"{finding.finding_id} için çelişkili kaynak bilgisi: "
                "demo kaynaklı bulgu sentetik değil olarak işaretli (değiştirilmeden korundu)."
            )

    warnings.extend(validate_evidence_references(merged_findings, model_input))

    if len(unique_models) == 1:
        source_id = unique_models[0]
        version = versions_by_model.get(source_id, primary.source_model_version)
    else:
        source_id = "fusion-normalizer"
        version = "0.2.0"

    return StructuredFindings(
        schema_version=primary.schema_version if primary.schema_version else "1.2.0",
        case_id=primary.case_id,
        study=primary.study,
        species=primary.species,
        modality=primary.modality,
        anatomical_region=primary.anatomical_region,
        source_model_id=source_id,
        source_model_version=version,
        source_kind=resolved_kind,
        execution_status=status,
        findings=merged_findings,
        warnings=list(dict.fromkeys(warnings)),
        review_required=True,
        no_findings_returned=no_findings,
        absences_not_confirmed=True,
        contributing_model_ids=unique_models,
        contributing_source_kinds=unique_kinds,
        potential_conflicts=conflicts,
    )
