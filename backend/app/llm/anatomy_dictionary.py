"""Exact lookup for report wording in the supplied VetMind search dictionary."""

from collections import defaultdict
from functools import lru_cache
from hashlib import sha256
from pathlib import Path
from threading import RLock
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
    Definition_TR: str | None = None
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
        # Lookup tables are private and read-only after loading. Copy public
        # metadata so callers cannot change another instance's version.
        with _CACHE_LOCK:
            path = path.resolve()
            approvals_path = approvals_path.resolve() if approvals_path is not None else None
            cached = _load_cached(
                path, _file_signature(path), approvals_path, _file_signature(approvals_path),
            )
            self._approved_locatives = cached._approved_locatives
            self._ambiguous = cached._ambiguous
            self._terms = cached._terms
            self.version = cached.version.model_copy(deep=True)

    def _load(self, path: Path, approvals_path: Path | None) -> None:
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
        self._ambiguous = ambiguous | {key for key, ids in index.items() if len(ids) > 1}
        self._terms = {
            key: by_id[next(iter(ids))]
            for key, ids in index.items()
            if len(ids) == 1 and key not in ambiguous
        }
        self.version = AnatomyDictionaryVersion(
            version=source.metadata.Schema_Version, sha256=digest, mode=mode,
            approvals_sha256=approvals_digest,
        )

    def unresolved_reason(self, location: str, *, species: Species) -> str | None:
        """Explain conservative matching without selecting an ambiguous candidate."""
        key = location_key(location)
        if key in self._ambiguous:
            return "ambiguous"
        term = self._terms.get(key)
        if term is None:
            return "unknown"
        if "A" not in term.Category:
            return "not_anatomy"
        if term.Uncertain:
            return "uncertain_term"
        if not term.Source_Locations and not term.External_Sources:
            return "missing_source"
        if species not in _SPECIES.get(term.Species, set()):
            return "species_mismatch"
        if not term.Turkish_Term.strip():
            return "missing_label"
        if self.version.mode == "reviewed" and term.Term_ID not in self._approved_locatives:
            return "pending_review"
        return None

    def resolve(self, location: str, *, species: Species) -> AnatomyTermMatch | None:
        if self.unresolved_reason(location, species=species) is not None:
            return None
        term = self._terms[location_key(location)]
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
            definition_tr=term.Definition_TR,
        )


_CACHE_LOCK = RLock()


def _file_signature(path: Path | None) -> tuple[int, ...] | None:
    if path is None:
        return None
    stat = path.stat()
    return (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)


@lru_cache(maxsize=8)
def _load_cached(
    path: Path,
    signature: tuple[int, ...] | None,
    approvals_path: Path | None,
    approvals_signature: tuple[int, ...] | None,
) -> AnatomyDictionary:
    # Exceptions are not cached. Never fall back to stale data on invalid files.
    dictionary = AnatomyDictionary.__new__(AnatomyDictionary)
    dictionary._load(path, approvals_path)
    if (
        _file_signature(path) != signature
        or _file_signature(approvals_path) != approvals_signature
    ):
        raise ValueError("Report anatomy files changed during loading; retry with stable files.")
    return dictionary
