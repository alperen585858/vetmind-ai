from collections import defaultdict

from app.models.evidence_validation import validate_evidence_references
from app.models.mock_vision import ABSENCE_WARNING, MOCK_DISCLAIMER
from app.models.ontology import code_family, codes_oppose, is_technique_code
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


def _series_or_location_key(finding: Finding) -> str:
    """Broader key so opposing codes on different SOPs in one series still meet."""
    series = _primary_series_uid(finding)
    if series:
        return f"series:{series}"
    return f"loc:{_location_key(finding.anatomical_location)}"


def _laterality_opposes(a: str, b: str) -> bool:
    pair = frozenset({a, b})
    return pair in _OPPOSING_LATERALITY


def _pathology_findings(group: list[Finding]) -> list[Finding]:
    return [f for f in group if not is_technique_code(f.finding_code)]


def _opposing_code_pairs(group: list[Finding]) -> list[tuple[Finding, Finding]]:
    pairs: list[tuple[Finding, Finding]] = []
    for i, a in enumerate(group):
        for b in group[i + 1 :]:
            if codes_oppose(a.finding_code, b.finding_code):
                pairs.append((a, b))
    return pairs


def _append_conflict(
    conflicts: list[PotentialConflict],
    *,
    conflict_id: str,
    group: list[Finding],
    group_key: str,
    reason_codes: list[str],
    reason_parts: list[str],
) -> None:
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


def detect_potential_conflicts(findings: list[Finding]) -> list[PotentialConflict]:
    """Generic conflict flags. Findings are never dropped or auto-resolved.

    Grouping uses SOP → series → location. Laterality LEFT vs RIGHT is a hard
    conflict. Cross-family pathology codes conflict; TECHNIQUE-only groups do not.
    Single-adapter opposing ontology pairs are flagged (including across SOPs in
    the same series).
    """
    by_key: dict[str, list[Finding]] = defaultdict(list)
    for finding in findings:
        by_key[_conflict_group_key(finding)].append(finding)

    conflicts: list[PotentialConflict] = []
    conflict_idx = 0
    covered_pairs: set[frozenset[str]] = set()

    for group_key, group in sorted(by_key.items()):
        if len(group) < 2:
            continue
        models = {f.source_model for f in group}
        multi = len(models) >= 2
        pathology = _pathology_findings(group)
        codes = {f.finding_code for f in pathology} if pathology else {f.finding_code for f in group}
        families = {code_family(f.finding_code) for f in pathology} if pathology else set()
        statuses = {f.finding_status for f in group}
        lateralities = {f.laterality for f in group}

        laterality_clash = any(
            _laterality_opposes(a.laterality, b.laterality)
            for i, a in enumerate(group)
            for b in group[i + 1 :]
        )
        opposing_pairs = _opposing_code_pairs(pathology or group)
        opposing_codes = bool(opposing_pairs)

        cross_family = len(families) >= 2
        incompatible_codes = len(codes) >= 2 and cross_family
        same_family_diff = len(codes) >= 2 and not cross_family and len(families) == 1
        opposing_status = FindingStatus.SUSPECTED in statuses and FindingStatus.UNCERTAIN in statuses
        soft_status = multi and len(statuses) >= 2 and (incompatible_codes or same_family_diff)
        same_sop = group_key.startswith("sop:")

        # Technique-only groups: only laterality can flag.
        technique_only = len(pathology) < 2 and not laterality_clash
        if technique_only and not opposing_codes:
            continue

        if not multi:
            # Single adapter: laterality, opposing pairs, or cross-family pathology.
            if not (laterality_clash or opposing_codes or (len(pathology) >= 2 and cross_family)):
                continue

        if multi and not (
            incompatible_codes or opposing_status or soft_status or laterality_clash or opposing_codes
        ):
            continue

        conflict_idx += 1
        conflict_id = f"conflict-{conflict_idx}"
        reason_codes: list[str] = []
        reason_parts: list[str] = []
        if multi:
            reason_codes.append(ConflictReasonCode.MULTI_MODEL.value)
        else:
            reason_codes.append(ConflictReasonCode.SINGLE_MODEL.value)

        if opposing_codes:
            reason_codes.append(ConflictReasonCode.OPPOSING_CODES.value)
            pair_labels = sorted(
                {f"{a.finding_code}↔{b.finding_code}" for a, b in opposing_pairs}
            )
            reason_parts.append(f"zıt kod çiftleri={pair_labels}")
            for a, b in opposing_pairs:
                covered_pairs.add(frozenset({a.finding_id, b.finding_id}))
        if incompatible_codes or (not multi and cross_family and len(pathology) >= 2):
            reason_codes.append(ConflictReasonCode.CROSS_FAMILY.value)
            reason_codes.append(ConflictReasonCode.DISTINCT_CODES.value)
            reason_parts.append(
                f"farklı bulgu kodları={sorted(codes)} aileler={sorted(families)}"
            )
        elif same_family_diff and (opposing_status or soft_status or opposing_codes):
            reason_codes.append(ConflictReasonCode.DISTINCT_CODES.value)
            reason_parts.append(f"aynı ailede farklı kodlar={sorted(codes)}")
        if multi and (opposing_status or soft_status):
            reason_codes.append(ConflictReasonCode.OPPOSING_STATUS.value)
            reason_parts.append(f"farklı durumlar={[s.value for s in statuses]}")
        if laterality_clash:
            reason_codes.append(ConflictReasonCode.OPPOSING_LATERALITY.value)
            reason_parts.append(f"zıt taraf (lateralite)={sorted(lateralities)}")
        if same_sop and multi:
            reason_codes.append(ConflictReasonCode.SAME_SOP_DIVERGENT.value)
        reason_parts.append(f"modeller={sorted(models)}")
        reason_parts.append(f"grup={group_key}")
        series_uids = {s for s in (_primary_series_uid(f) for f in group) if s}
        if series_uids:
            reason_parts.append(f"seriler={sorted(series_uids)}")

        members = pathology if (opposing_codes or cross_family) and pathology else group
        _append_conflict(
            conflicts,
            conflict_id=conflict_id,
            group=members,
            group_key=group_key,
            reason_codes=reason_codes,
            reason_parts=reason_parts,
        )

    # Second pass: opposing ontology pairs across different SOPs in the same series/location.
    by_series: dict[str, list[Finding]] = defaultdict(list)
    for finding in findings:
        if is_technique_code(finding.finding_code):
            continue
        by_series[_series_or_location_key(finding)].append(finding)

    for series_key, group in sorted(by_series.items()):
        if len(group) < 2:
            continue
        for a, b in _opposing_code_pairs(group):
            pair_ids = frozenset({a.finding_id, b.finding_id})
            if pair_ids in covered_pairs:
                continue
            covered_pairs.add(pair_ids)
            conflict_idx += 1
            conflict_id = f"conflict-{conflict_idx}"
            models = {a.source_model, b.source_model}
            reason_codes = [
                ConflictReasonCode.SINGLE_MODEL.value
                if len(models) == 1
                else ConflictReasonCode.MULTI_MODEL.value,
                ConflictReasonCode.OPPOSING_CODES.value,
                ConflictReasonCode.DISTINCT_CODES.value,
            ]
            reason_parts = [
                f"zıt kod çiftleri={[f'{a.finding_code}↔{b.finding_code}']}",
                f"modeller={sorted(models)}",
                f"grup={series_key}",
            ]
            _append_conflict(
                conflicts,
                conflict_id=conflict_id,
                group=[a, b],
                group_key=series_key,
                reason_codes=reason_codes,
                reason_parts=reason_parts,
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

    # Preserve coverage / adapter metadata (previously dropped — UI could not show scope).
    merged_meta: dict[str, str] = {}
    coverage = None
    for out in outputs:
        if out.processing_metadata:
            merged_meta.update(out.processing_metadata)
        if out.analysis_coverage is not None:
            # Re-finalize so inventory/decode alone cannot claim visual completion.
            coverage = out.analysis_coverage.finalize()

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
        processing_metadata=merged_meta,
        analysis_coverage=coverage,
    )
