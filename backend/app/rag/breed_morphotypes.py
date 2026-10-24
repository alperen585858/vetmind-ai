"""Load breed-morphology reference data as RAG-compatible corpus documents.

The JSON contains three cranial morphotypes per species and representative breed
examples, not an exhaustive registry of dog and cat breeds.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from app.rag.corpus import CorpusDoc, SEED_CORPUS

_DATA_PATH = Path(__file__).with_name("corpus") / "breed_morphotypes.json"
_COVERAGE_NOTE = (
    "Representative breeds only; this is not an exhaustive breed registry. "
    "Reference material only; not clinical evidence or a diagnostic rule."
)


def load_breed_morphotype_data(path: Path | None = None) -> dict[str, Any]:
    """Read and minimally validate the breed morphology JSON."""
    source = path or _DATA_PATH
    data = json.loads(source.read_text(encoding="utf-8"))
    required = {
        "metadata",
        "cranial_morphotypes",
        "suture_closure_rules_months",
        "anatomical_pitfalls",
    }
    if not isinstance(data, dict) or not required.issubset(data):
        raise ValueError(f"Breed morphology data must contain {sorted(required)}.")
    if not isinstance(data["cranial_morphotypes"], dict):
        raise ValueError("cranial_morphotypes must be an object.")
    if not isinstance(data["suture_closure_rules_months"], dict):
        raise ValueError("suture_closure_rules_months must be an object.")
    if not isinstance(data["anatomical_pitfalls"], list):
        raise ValueError("anatomical_pitfalls must be an array.")
    return data


def load_breed_morphotype_documents(path: Path | None = None) -> tuple[CorpusDoc, ...]:
    """Convert morphotypes, suture rules, and anatomical pitfalls to RAG documents."""
    data = load_breed_morphotype_data(path)
    documents: list[CorpusDoc] = []
    for species, morphotypes in data["cranial_morphotypes"].items():
        if not isinstance(morphotypes, dict):
            raise ValueError(f"cranial_morphotypes.{species} must be an object.")
        for morphotype, details in morphotypes.items():
            if not isinstance(details, dict):
                raise ValueError(f"Morphotype {species}.{morphotype} must be an object.")
            breeds = details.get("representative_breeds", [])
            if not isinstance(breeds, list) or not all(
                isinstance(item, str) for item in breeds
            ):
                raise ValueError(
                    f"Morphotype {species}.{morphotype} has invalid representative_breeds."
                )

            title = f"{species.title()} cranial morphotype: {morphotype}"
            passage_parts = [
                _format_value(label, details[label])
                for label in (
                    "description",
                    "cephalic_index_range",
                    "craniofacial_angle_range",
                    "representative_breeds",
                    "clinical_notes",
                )
                if label in details
            ]
            passage = " ".join(part for part in passage_parts if part)
            passage = f"{passage} {_COVERAGE_NOTE}".strip()
            documents.append(
                CorpusDoc(
                    source_id=_source_id("breed", species, morphotype),
                    title=title,
                    section="Breed morphology",
                    passage=passage,
                    keywords=tuple(
                        dict.fromkeys(
                            [species, "dog" if species == "dogs" else "cat", morphotype]
                            + breeds
                            + ["cranial morphology", "cephalic index"]
                        )
                    ),
                )
            )

    rules = data["suture_closure_rules_months"].get("structures", {})
    if not isinstance(rules, dict):
        raise ValueError("suture_closure_rules_months.structures must be an object.")
    for structure, details in rules.items():
        documents.append(
            CorpusDoc(
                source_id=_source_id("suture", structure),
                title=f"Cranial suture closure: {structure}",
                section="Cranial suture closure rules",
                passage=f"{structure}. {_format_value('closure rules', details)}",
                keywords=("suture", "synchondrosis", "closure", "cranial", structure),
            )
        )

    for pitfall in data["anatomical_pitfalls"]:
        if not isinstance(pitfall, dict) or not isinstance(pitfall.get("id"), str):
            raise ValueError("Each anatomical pitfall must be an object with a string id.")
        structure = str(pitfall.get("structure", pitfall["id"]))
        passage_parts = [
            _format_value(label, pitfall[label])
            for label in (
                "description",
                "misinterpretation_risk",
                "affected_breeds",
                "resolution",
            )
            if label in pitfall
        ]
        documents.append(
            CorpusDoc(
                source_id=_source_id("breed", pitfall["id"]),
                title=f"Anatomical pitfall: {structure}",
                section="Veterinary cranial anatomy pitfalls",
                passage=" ".join(passage_parts),
                keywords=("anatomical pitfall", "cranial anatomy", structure),
            )
        )
    return tuple(documents)


def load_default_rag_corpus() -> tuple[CorpusDoc, ...]:
    """Combine the existing neurology seed corpus with breed morphology references."""
    return SEED_CORPUS + load_breed_morphotype_documents()


def _format_value(label: str, value: Any) -> str:
    if isinstance(value, (dict, list)):
        rendered = json.dumps(value, ensure_ascii=False, separators=(",", ": "))
    elif value is None:
        rendered = "not specified"
    else:
        rendered = str(value)
    return f"{label.replace('_', ' ')}: {rendered}."


def _source_id(*parts: str) -> str:
    slug = "-".join(parts).casefold()
    return re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
