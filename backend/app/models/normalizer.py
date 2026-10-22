from collections import defaultdict

from app.models.evidence_validation import validate_evidence_references
from app.models.mock_vision import ABSENCE_WARNING, MOCK_DISCLAIMER
from app.schemas.enums import FindingStatus, ModelExecutionStatus, SourceKind
from app.schemas.findings import Finding, PotentialConflict, StructuredFindings
from app.schemas.model_input import ImagingModelInput

AGREEMENT_NOTE = (
    "Multiple models reported findings at the same location. "
    "Agreement does not prove clinical correctness."
)


def _resolve_source_kind(kinds: list[SourceKind]) -> SourceKind:
    unique = list(dict.fromkeys(kinds))
    if not unique:
        return SourceKind.MOCK
    if len(unique) == 1:
        return unique[0]
    return SourceKind.MIXED


def _location_key(location: str) -> str:
    return " ".join(location.strip().lower().split())


def detect_potential_conflicts(findings: list[Finding]) -> list[PotentialConflict]:
    """Generic conflict flags. Findings are never dropped or auto-resolved."""
    by_loc: dict[str, list[Finding]] = defaultdict(list)
    for finding in findings:
        by_loc[_location_key(finding.anatomical_location)].append(finding)

    conflicts: list[PotentialConflict] = []
    for idx, (loc_key, group) in enumerate(sorted(by_loc.items())):
        if len(group) < 2:
            continue
        models = {f.source_model for f in group}
        codes = {f.finding_code for f in group}
        statuses = {f.finding_status for f in group}
        if len(models) < 2:
            continue

        incompatible_codes = len(codes) >= 2
        opposing_status = FindingStatus.SUSPECTED in statuses and FindingStatus.UNCERTAIN in statuses
        # Treat NOT_ASSESSED vs SUSPECTED as soft incompatibility when codes also differ
        soft_status = len(statuses) >= 2 and incompatible_codes

        if not (incompatible_codes or opposing_status or soft_status):
            continue

        conflict_id = f"conflict-{idx + 1}"
        reason_parts = []
        if incompatible_codes:
            reason_parts.append(f"distinct finding_codes={sorted(codes)}")
        if opposing_status or soft_status:
            reason_parts.append(f"distinct statuses={[s.value for s in statuses]}")
        reason_parts.append(f"models={sorted(models)}")

        for finding in group:
            finding.conflict_group_id = conflict_id

        conflicts.append(
            PotentialConflict(
                conflict_id=conflict_id,
                finding_ids=[f.finding_id for f in group],
                anatomical_location_key=loc_key,
                reason="POTENTIAL CONFLICT PRESERVED: " + "; ".join(reason_parts),
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

    if resolved_kind in {SourceKind.MOCK, SourceKind.MIXED} and MOCK_DISCLAIMER not in warnings:
        warnings.insert(0, MOCK_DISCLAIMER)
    if resolved_kind == SourceKind.MIXED:
        warnings.append(
            "MIXED provenance: contributing adapters reported more than one source_kind. "
            "Inspect contributing_source_kinds and per-finding source_model; do not treat the fused "
            "output as a single validated clinical source."
        )
    if resolved_kind == SourceKind.REAL:
        warnings.append(
            "source_kind=real preserves adapter provenance only; it does not imply clinical validation."
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
                f"Contradictory provenance on {finding.finding_id}: "
                "REAL-sourced finding marked synthetic=true (preserved, not rewritten)."
            )
        if parent_kinds == {SourceKind.MOCK} and not finding.synthetic:
            warnings.append(
                f"Contradictory provenance on {finding.finding_id}: "
                "MOCK-sourced finding marked synthetic=false (preserved, not rewritten)."
            )

    warnings.extend(validate_evidence_references(merged_findings, model_input))

    if len(unique_models) == 1:
        source_id = unique_models[0]
        version = versions_by_model.get(source_id, primary.source_model_version)
    else:
        source_id = "fusion-normalizer"
        version = "0.2.0"

    return StructuredFindings(
        schema_version=primary.schema_version if primary.schema_version else "1.1.0",
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
