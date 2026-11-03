"""Read-only Clinical Terminology bridge to VetMind StructuredFindings (no clinical scoring).

The bridge inspects findings already normalized by the backend. It does not
infer diagnoses, change source objects, copy patient identifiers, or use an
unreviewed term to claim equivalence.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from evaluation.clinical_terminology.catalog import Domain, Species
from evaluation.clinical_terminology.resolver import CatalogResolver

if TYPE_CHECKING:
    from app.schemas.findings import StructuredFindings


@dataclass(frozen=True, slots=True)
class StructuredTerminologyAudit:
    status: Literal["not_evaluated", "needs_review", "structurally_resolved"]
    finding_count: int
    resolved_finding_terms: int
    resolved_anatomy_terms: int
    unresolved_finding_terms: int
    unresolved_anatomy_terms: int
    unknown_laterality: int
    catalog_version: str
    unsupported_scope: bool
    clinical_validation: Literal["not_evaluated"] = "not_evaluated"
    clinical_metrics: None = None


_REGION_TO_DOMAIN: dict[str, Domain] = {
    "BRAIN": "brain", "CERVICAL": "cervical",
}


def audit_structured_findings(source: "StructuredFindings", resolver: CatalogResolver) -> StructuredTerminologyAudit:
    """Audit term resolvability for cranial/neuro outputs, never auto-approve.

    BRAIN/CERVICAL are known backend regions; other regions are unsupported
    here rather than being silently mapped to cranium. A separate region map
    must be explicitly introduced if the backend gains a CRANIUM enum.
    """
    from app.schemas.findings import StructuredFindings

    if not isinstance(source, StructuredFindings):
        raise TypeError("StructuredFindings expected")
    if not isinstance(resolver, CatalogResolver):
        raise TypeError("CatalogResolver expected")
    species_raw = source.species.value
    region_raw = source.anatomical_region.value
    scope_supported = (
        species_raw in ("canine", "feline")
        and region_raw in _REGION_TO_DOMAIN
        and source.source_kind.value == "real"
        and source.execution_status.value in ("success", "partial")
    )
    count = len(source.findings)
    if not scope_supported:
        return StructuredTerminologyAudit(
            status="not_evaluated", finding_count=count,
            resolved_finding_terms=0, resolved_anatomy_terms=0,
            unresolved_finding_terms=count, unresolved_anatomy_terms=count,
            unknown_laterality=sum(f.laterality == "UNKNOWN" for f in source.findings),
            catalog_version=resolver.catalog.catalog_version, unsupported_scope=True,
        )
    species: Species = species_raw  # type: ignore[assignment]
    domain = _REGION_TO_DOMAIN[region_raw]
    resolved_codes = 0
    resolved_anatomy = 0
    for finding in source.findings:
        if resolver.resolve(finding.finding_code, kind="finding", species=species, domain=domain).usable_for_clinical_equivalence:
            resolved_codes += 1
        if resolver.resolve(finding.anatomical_location, kind="anatomy", species=species, domain=domain).usable_for_clinical_equivalence:
            resolved_anatomy += 1
    # An empty finding list is NOT proof that the patient is negative.
    if count == 0:
        status: Literal["not_evaluated", "needs_review", "structurally_resolved"] = "not_evaluated"
    elif resolved_codes == resolved_anatomy == count and all(f.laterality != "UNKNOWN" for f in source.findings):
        status = "structurally_resolved"
    else:
        status = "needs_review"
    return StructuredTerminologyAudit(
        status=status, finding_count=count,
        resolved_finding_terms=resolved_codes, resolved_anatomy_terms=resolved_anatomy,
        unresolved_finding_terms=count - resolved_codes,
        unresolved_anatomy_terms=count - resolved_anatomy,
        unknown_laterality=sum(f.laterality == "UNKNOWN" for f in source.findings),
        catalog_version=resolver.catalog.catalog_version, unsupported_scope=False,
    )
