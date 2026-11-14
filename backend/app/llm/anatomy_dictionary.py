"""Exact lookup for report wording in the supplied VetMind search dictionary."""

from collections import defaultdict
from hashlib import sha256
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.normalizer import location_key
from app.schemas.enums import Species
from app.schemas.report import AnatomyDictionaryVersion, AnatomyTermMatch

_SPECIES = {
    "Her ikisi": {Species.CANINE, Species.FELINE},
    "Köpek": {Species.CANINE},
    "Kedi": {Species.FELINE},
}
_DEMO_LOCATIVES = {
    "beyin": "beyinde",
    "beyin sapı": "beyin sapında",
    "frontal lob": "frontal lobda",
    "servikal omurilik": "servikal omurilikte",
}


class _Metadata(BaseModel):
    Schema_Version: str = Field(min_length=1)
    Count: int
    Ambiguous_Query_Candidates: dict[str, list[str]]


class _Term(BaseModel):
    Term_ID: str = Field(min_length=1)
    Turkish_Term: str = Field(min_length=1)
    Search_Labels: list[str]
    Category: list[str]
    Species: str
    Uncertain: bool
    Source_Locations: list[dict]
    External_Sources: list[dict]

    @property
    def eligible(self) -> bool:
        return (
            "A" in self.Category
            and not self.Uncertain
            and bool(self.Turkish_Term.strip())
            and bool(self.Source_Locations or self.External_Sources)
            and self.Species in _SPECIES
        )


class _SearchDictionary(BaseModel):
    metadata: _Metadata
    terms: list[_Term]


class _Approvals(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dictionary_sha256: str
    reviewed_by: str = Field(min_length=1, pattern=r"\S")
    # The reviewer approves the canonical label and supplies its in-sentence locative.
    terms: dict[str, str]


class AnatomyDictionary:
    def __init__(self, path: Path, approvals_path: Path | None = None) -> None:
        raw = path.read_bytes()
        source = _SearchDictionary.model_validate_json(raw)
        by_id = {term.Term_ID: term for term in source.terms}
        if len(by_id) != len(source.terms) or len(by_id) != source.metadata.Count:
            raise ValueError("Report anatomy dictionary count or term IDs are inconsistent.")

        digest = sha256(raw).hexdigest()
        self._approved_locatives: dict[str, str] = {}
        mode: Literal["demo", "reviewed"] = "demo"
        approvals_digest = None
        if approvals_path is not None:
            approvals_raw = approvals_path.read_bytes()
            approvals = _Approvals.model_validate_json(approvals_raw)
            if approvals.dictionary_sha256 != digest:
                raise ValueError("Report anatomy approvals do not match the dictionary SHA-256.")
            for term_id, locative in approvals.terms.items():
                if term_id not in by_id or not by_id[term_id].eligible or not locative.strip():
                    raise ValueError(f"Invalid report anatomy approval for {term_id!r}.")
                self._approved_locatives[term_id] = locative.strip()
            mode = "reviewed"
            approvals_digest = sha256(approvals_raw).hexdigest()

        # Count collisions across the entire dictionary, before filtering by category,
        # species or review. None of those filters can disambiguate a model's wording.
        index: dict[str, set[str]] = defaultdict(set)
        for term in source.terms:
            for label in term.Search_Labels:
                if key := location_key(label):
                    index[key].add(term.Term_ID)
        ambiguous = {location_key(query) for query in source.metadata.Ambiguous_Query_Candidates}
        self._terms = {
            key: by_id[next(iter(ids))]
            for key, ids in index.items()
            if len(ids) == 1 and key not in ambiguous
        }
        self.version = AnatomyDictionaryVersion(
            version=source.metadata.Schema_Version, sha256=digest, mode=mode,
            approvals_sha256=approvals_digest,
        )

    def resolve(self, location: str, *, species: Species) -> AnatomyTermMatch | None:
        term = self._terms.get(location_key(location))
        if term is None or not term.eligible or species not in _SPECIES[term.Species]:
            return None
        label = term.Turkish_Term
        if self.version.mode == "reviewed":
            locative = self._approved_locatives.get(term.Term_ID)
            if locative is None:
                return None
        else:
            locative = _DEMO_LOCATIVES.get(label)
        return AnatomyTermMatch(
            term_id=term.Term_ID,
            original_location=location,
            turkish_label=label,
            turkish_locative=locative,
        )
