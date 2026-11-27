"""Region checklists the VLM must walk through, plus parsing/merging of its answers.

A systematic review makes the model say, per structure, whether it was in view and
whether anything looked abnormal *in the analyzed slices*. That gives the report
scoped negative statements ("orta hat şifti izlenmedi — incelenen kesitte") instead
of two vague technique notes, without ever claiming the study is normal.
"""

from __future__ import annotations

from typing import Any, Iterable, Sequence

from app.schemas.findings import SystematicReviewItem

_CHECKLISTS: dict[str, tuple[str, ...]] = {
    "BRAIN": (
        "Lateral ventriküller (boyut, simetri)",
        "3. ve 4. ventrikül",
        "Orta hat (şift)",
        "Kitle etkisi / sulkus silinmesi",
        "Serebral korteks ve beyaz cevher",
        "Serebellum",
        "Beyin sapı",
        "Kaudal fossa / foramen magnum",
        "Ekstra-aksiyel alan / meninksler",
        "Kalvaryum ve kafatası tabanı",
    ),
    "CERVICAL": (
        "Vertebra hizası",
        "Disk aralıkları",
        "Spinal kord (çap, sinyal)",
        "Vertebral kanal / foramenler",
        "Kraniyoservikal bileşke",
        "Paravertebral yumuşak doku",
    ),
    "THORACOLUMBAR": (
        "Vertebra hizası",
        "Disk aralıkları",
        "Spinal kord (çap, sinyal)",
        "Vertebral kanal / foramenler",
        "Paravertebral yumuşak doku",
    ),
    "THORAX": (
        "Akciğer parankimi",
        "Plevral boşluk",
        "Kardiyak siluet",
        "Mediasten",
        "Trakea / bronşlar",
        "Toraks duvarı ve iskelet",
    ),
}

_STATUS_RANK = {
    "abnormality_suspected": 3,
    "no_abnormality_seen": 2,
    "not_assessable": 1,
    "not_in_view": 0,
}

_STATUS_ALIASES = {
    "normal": "no_abnormality_seen",
    "no_abnormality": "no_abnormality_seen",
    "unremarkable": "no_abnormality_seen",
    "izlenmedi": "no_abnormality_seen",
    "abnormal": "abnormality_suspected",
    "suspected": "abnormality_suspected",
    "abnormality": "abnormality_suspected",
    "not_visible": "not_in_view",
    "out_of_view": "not_in_view",
    "not_assessed": "not_assessable",
    "uncertain": "not_assessable",
}

STATUS_LABEL_TR = {
    "no_abnormality_seen": "incelenen kesitte anormallik izlenmedi",
    "abnormality_suspected": "anormallik şüphesi",
    "not_in_view": "kesitte yok",
    "not_assessable": "değerlendirilemedi",
}


def checklist_for(region: Any) -> tuple[str, ...]:
    key = str(getattr(region, "value", region) or "").upper()
    return _CHECKLISTS.get(key, ())


def checklist_prompt(region: Any) -> str:
    items = checklist_for(region)
    if not items:
        return (
            "SYSTEMATIC REVIEW: list up to 6 key structures of this region in systematic_review "
            "(one item each)."
        )
    lines = ["SYSTEMATIC REVIEW CHECKLIST (return exactly one systematic_review item per line, same region text):"]
    lines.extend(f"- {r}" for r in items)
    return "\n".join(lines)


def _norm_status(raw: Any) -> str | None:
    text = str(raw or "").strip().lower().replace(" ", "_").replace("-", "_")
    if text in _STATUS_RANK:
        return text
    return _STATUS_ALIASES.get(text)


def parse_systematic_review(
    parsed: dict[str, Any],
    *,
    sent: Sequence[Any],
    locus_for: Any = None,
) -> list[SystematicReviewItem]:
    """Lenient parse of one VLM batch answer. Bad items are dropped.

    ``locus_for(frame) -> str`` renders an evidence locus; frames are matched by IMG index.
    """
    raw = parsed.get("systematic_review")
    if not isinstance(raw, list):
        return []
    by_index = {getattr(fr, "index", None): fr for fr in sent}
    out: list[SystematicReviewItem] = []
    for item in raw[:24]:
        if not isinstance(item, dict):
            continue
        region = str(item.get("region") or "").strip()
        status = _norm_status(item.get("status"))
        if not region or status is None:
            continue
        idx_raw = item.get("source_image_index")
        try:
            idx = int(idx_raw) if idx_raw is not None else None
        except (TypeError, ValueError):
            idx = None
        frame = by_index.get(idx) if idx is not None else None
        if frame is None:
            idx = None
            # A negative or positive claim needs a real slice; without one we cannot scope it.
            if status in {"no_abnormality_seen", "abnormality_suspected"}:
                status = "not_assessable"
        locus = locus_for(frame) if (frame is not None and locus_for is not None) else None
        out.append(
            SystematicReviewItem(
                region=region[:120],
                status=status,  # type: ignore[arg-type]
                note=str(item.get("note") or "").strip()[:400],
                source_image_index=idx,
                evidence_locus=locus,
            )
        )
    return out


def merge_systematic_review(
    batches: Iterable[list[SystematicReviewItem]],
    *,
    region: Any = None,
) -> list[SystematicReviewItem]:
    """Across batches keep, per region, the most informative status (suspected > seen > ...)."""
    best: dict[str, SystematicReviewItem] = {}
    order: list[str] = []
    for items in batches:
        for it in items:
            key = it.region.strip().lower()
            prev = best.get(key)
            if prev is None:
                order.append(key)
                best[key] = it
            elif _STATUS_RANK[it.status] > _STATUS_RANK[prev.status]:
                best[key] = it
    # Checklist regions the model skipped are made explicit rather than silently missing
    # (only when the model answered the checklist at all — older adapters return none).
    for name in (checklist_for(region) if best else ()):
        key = name.lower()
        if key not in best:
            order.append(key)
            best[key] = SystematicReviewItem(
                region=name,
                status="not_assessable",
                note="Model bu bölge için yanıt vermedi.",
            )
    return [best[k] for k in order]
