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
    "Yalnızca temsilî ırklar listelenmiştir; eksiksiz bir ırk kaydı değildir. "
    "Yalnızca referans materyaldir; klinik kanıt veya tanı kuralı değildir."
)

# Passages and titles are shown to Turkish users (reports, Bilgi Tabanı); data keys stay English.
_SPECIES_TR = {"dogs": "Köpek", "cats": "Kedi"}
_LABEL_TR = {
    "description": "açıklama",
    "cephalic_index_range": "sefalik indeks aralığı",
    "craniofacial_angle_range": "kraniyofasiyal açı aralığı",
    "representative_breeds": "temsilî ırklar",
    "clinical_notes": "klinik notlar",
    "closure rules": "kapanma kuralları",
    "misinterpretation_risk": "yanlış yorumlama riski",
    "affected_breeds": "etkilenen ırklar",
    "resolution": "çözüm",
}


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

            title = f"{_SPECIES_TR.get(species, species.title())} kraniyal morfotip: {morphotype}"
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
                    section="Irk morfolojisi",
                    passage=passage,
                    keywords=tuple(
                        dict.fromkeys(
                            [species, "dog" if species == "dogs" else "cat", morphotype]
                            + breeds
                            + ["cranial morphology", "cephalic index", "kraniyal morfoloji", "sefalik indeks", "ırk"]
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
                title=f"Kraniyal sütür kapanması: {structure}",
                section="Kraniyal sütür kapanma kuralları",
                passage=f"{structure}. {_format_value('closure rules', details)}",
                keywords=("suture", "synchondrosis", "closure", "cranial", "sütür", "kapanma", structure),
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
                title=f"Anatomik tuzak: {structure}",
                section="Veteriner kraniyal anatomi tuzakları",
                passage=" ".join(passage_parts),
                keywords=("anatomical pitfall", "cranial anatomy", "anatomik tuzak", "kraniyal anatomi", structure),
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
        rendered = "belirtilmemiş"
    else:
        rendered = str(value)
    return f"{_LABEL_TR.get(label, label.replace('_', ' '))}: {rendered}."


def _source_id(*parts: str) -> str:
    slug = "-".join(parts).casefold()
    return re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
