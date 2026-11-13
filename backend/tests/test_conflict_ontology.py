"""ISS-FUS-01 — conflict ontology, laterality, SOP-anchor grouping."""

from __future__ import annotations

from app.models.normalizer import detect_potential_conflicts
from app.models.ontology import code_family, same_family
from app.schemas.enums import FindingStatus
from app.schemas.findings import EvidenceReference, Finding


def _f(
    fid: str,
    code: str,
    *,
    model: str,
    location: str = "Brain",
    status: FindingStatus = FindingStatus.SUSPECTED,
    laterality: str = "UNKNOWN",
    series: str | None = None,
    sop: str | None = None,
    frame: int | None = None,
) -> Finding:
    refs = []
    if series or sop:
        refs.append(
            EvidenceReference(
                evidence_id=f"e-{fid}",
                description="anchor",
                series_instance_uid=series,
                sop_instance_uid=sop,
                frame_index=frame,
            )
        )
    return Finding(
        finding_id=fid,
        finding_code=code,
        description=code,
        anatomical_location=location,
        finding_status=status,
        source_model=model,
        laterality=laterality,  # type: ignore[arg-type]
        evidence_references=refs,
        synthetic=True,
    )


def test_ontology_families() -> None:
    assert same_family("IVDD", "DISC_HERNIATION")
    assert code_family("IVDD_SUSPECTED") == "IVDD"
    assert not same_family("IVDD", "MENINGIOMA")
    assert same_family("VENTRICLE-DILATION", "VENTRICLE-STRUCTURE")
    assert code_family("IMAGE-QUALITY") == "TECHNIQUE"


def test_codes_oppose_ventricle_pair() -> None:
    from app.models.ontology import canonicalize_finding_code, clear_ontology_cache, codes_oppose

    clear_ontology_cache()
    assert codes_oppose("VENTRICLE-DILATION", "VENTRICLE-STRUCTURE")
    assert codes_oppose("VENTRICLE_DILATION", "VENTRICLE_STRUCTURE")
    assert codes_oppose("VENTRICLE-DILATATION", "BRAIN-VENTRICLE")
    assert canonicalize_finding_code("VENTRICLE_DILATATION") == "VENTRICLE-DILATION"
    assert not codes_oppose("VENTRICLE-DILATION", "VENTRICLE-DILATION")


def test_divergent_labels_same_sop_conflict() -> None:
    findings = [
        _f("a", "CODE-A", model="m1", sop="1.2.3.sop", frame=0),
        _f("b", "CODE-B", model="m2", sop="1.2.3.sop", frame=0, status=FindingStatus.UNCERTAIN),
    ]
    conflicts = detect_potential_conflicts(findings)
    assert len(conflicts) == 1
    assert "same_sop_divergent" in conflicts[0].reason_codes
    assert "cross_family" in conflicts[0].reason_codes


def test_same_label_different_series_no_auto_conflict() -> None:
    findings = [
        _f("a", "CODE-A", model="m1", series="1.2.series-a", location="brain / olfactory"),
        _f(
            "b",
            "CODE-B",
            model="m2",
            series="1.2.series-b",
            location="brain / olfactory",
            status=FindingStatus.UNCERTAIN,
        ),
    ]
    assert detect_potential_conflicts(findings) == []


def test_opposing_laterality_conflict() -> None:
    findings = [
        _f("a", "IVDD", model="m1", laterality="LEFT", location="C2-C3"),
        _f("b", "IVDD", model="m2", laterality="RIGHT", location="C2-C3"),
    ]
    conflicts = detect_potential_conflicts(findings)
    assert len(conflicts) == 1
    assert "opposing_laterality" in conflicts[0].reason_codes
    assert findings[0].conflict_group_id == conflicts[0].conflict_id


def test_same_family_severity_soft_without_status_clash() -> None:
    """Same family + both SUSPECTED → no hard conflict (soft severity only)."""
    findings = [
        _f("a", "IVDD", model="m1", location="C3-C4"),
        _f("b", "DISC_HERNIATION", model="m2", location="C3-C4"),
    ]
    assert detect_potential_conflicts(findings) == []


def test_single_model_opposing_ventricle_codes_same_series() -> None:
    """One VLM adapter: dilation vs normal structure on different SOPs, same series."""
    findings = [
        _f(
            "dil",
            "VENTRICLE-DILATION",
            model="vlm",
            location="lateral ventriküller",
            series="1.2.series",
            sop="1.2.sop.dil",
            frame=0,
            status=FindingStatus.POSSIBLE,
        ),
        _f(
            "norm",
            "VENTRICLE-STRUCTURE",
            model="vlm",
            location="Lateral Ventriküller",
            series="1.2.series",
            sop="1.2.sop.norm",
            frame=0,
            status=FindingStatus.POSSIBLE,
        ),
    ]
    conflicts = detect_potential_conflicts(findings)
    assert len(conflicts) >= 1
    assert any("opposing_codes" in c.reason_codes for c in conflicts)
    assert any("single_model" in c.reason_codes for c in conflicts)


def test_technique_only_group_no_conflict() -> None:
    findings = [
        _f("a", "IMAGE-QUALITY", model="vlm", sop="1.2.3", frame=0),
        _f("b", "ANATOMIC-STRUCTURE", model="vlm", sop="1.2.3", frame=0),
    ]
    assert detect_potential_conflicts(findings) == []
