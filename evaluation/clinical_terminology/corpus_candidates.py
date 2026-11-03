"""Conservative, provenance-preserving extraction from VetMind's static RAG corpus.

Extract SOURCE STRINGS only. Never infer diagnoses, aliases, equivalence,
measurement validity, clinical performance, or expert review status.
This module does not alter the production RAG corpus or the active term catalog.
"""
from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from evaluation.clinical_terminology.catalog import TermCatalog, TermEntry, TermScope
from evaluation.terminology import normalize_token

MAX_SOURCE_BYTES = 1_000_000
MAX_SOURCE_ITEMS = 500
SOURCE_ID = "backend/app/rag/corpus/breed_morphotypes.json"

CandidateOrigin = Literal["suture_schedule", "anatomical_pitfall"]
CandidateFlag = Literal[
    "qualified_label", "composite_label", "unscoped_species",
    "duplicate_surface", "source_statement_unverified",
]


class _Frozen(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)


class CorpusCandidate(_Frozen):
    candidate_id: str = Field(pattern=r"^SRC_[0-9a-f]{20}$")
    preferred_label_as_written: str = Field(min_length=1, max_length=256)
    origin: CandidateOrigin
    source_pointer: str = Field(min_length=1, max_length=512)
    source_id: Literal["backend/app/rag/corpus/breed_morphotypes.json"] = SOURCE_ID
    species_mentioned: tuple[Literal["canine", "feline"], ...] = ()
    flags: tuple[CandidateFlag, ...] = ()
    review_state: Literal["pending"] = "pending"
    eligible_for_clinical_matching: Literal[False] = False

    @model_validator(mode="after")
    def validate_candidate(self) -> "CorpusCandidate":
        if not normalize_token(self.preferred_label_as_written):
            raise ValueError("candidate label has no searchable characters")
        if len(set(self.flags)) != len(self.flags):
            raise ValueError("duplicate review flags")
        if len(set(self.species_mentioned)) != len(self.species_mentioned):
            raise ValueError("duplicate species")
        return self


class CorpusReviewQueue(_Frozen):
    schema_version: Literal["1.0.0"] = "1.0.0"
    extractor_version: Literal["0.2.0"] = "0.2.0"
    source_id: Literal["backend/app/rag/corpus/breed_morphotypes.json"] = SOURCE_ID
    source_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    review_state: Literal["pending"] = "pending"
    clinical_validation: Literal["not_evaluated"] = "not_evaluated"
    candidates: tuple[CorpusCandidate, ...] = ()

    @model_validator(mode="after")
    def validate_unique(self) -> "CorpusReviewQueue":
        ids = [item.candidate_id for item in self.candidates]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate candidate identifier")
        return self

    @property
    def counts(self) -> dict[str, int]:
        return {
            "candidates": len(self.candidates),
            "suture_schedule": sum(c.origin == "suture_schedule" for c in self.candidates),
            "anatomical_pitfall": sum(c.origin == "anatomical_pitfall" for c in self.candidates),
            "requires_segmentation": sum("composite_label" in c.flags or "qualified_label" in c.flags for c in self.candidates),
        }


def _pointer_component(value: str) -> str:
    """RFC 6901 JSON Pointer escaping (source location, never a web URL)."""
    return value.replace("~", "~0").replace("/", "~1")


def _required_object(value: object) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(k, str) for k in value):
        raise ValueError("source section must be a string-keyed object")
    return value


def _structured_flags(label: str, *, species: tuple[str, ...]) -> tuple[CandidateFlag, ...]:
    flags: list[CandidateFlag] = []
    if "(" in label or ")" in label:
        flags.append("qualified_label")
    if any(delimiter in label for delimiter in (" / ", " & ", ";", " et ")):
        flags.append("composite_label")
    if not species:
        flags.append("unscoped_species")
    flags.append("source_statement_unverified")
    return tuple(flags)


def _make_candidate(
    *, label: str, origin: CandidateOrigin, pointer: str,
    species: tuple[Literal["canine", "feline"], ...] = (),
) -> CorpusCandidate:
    if not isinstance(label, str):
        raise ValueError("source candidate label must be a string")
    # Full source pointer is included in the identifier; two different source
    # statements remain distinct, even if labels happen to match.
    identifier = "SRC_" + sha256(f"{origin}|{pointer}|{label}".encode("utf-8")).hexdigest()[:20]
    return CorpusCandidate(
        candidate_id=identifier, preferred_label_as_written=label,
        origin=origin, source_pointer=pointer,
        species_mentioned=species, flags=_structured_flags(label, species=species),
    )


def extract_candidates(raw: bytes) -> CorpusReviewQueue:
    """Parse known static corpus fields; fail closed if the expected shape drifts.

    The source checksum tracks the exact bytes read, not a clinical citation.
    This deliberately excludes free-text description/resolution fields.
    """
    if not raw or len(raw) > MAX_SOURCE_BYTES:
        raise ValueError("source size outside allowed bounds")
    try:
        document = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValueError("source is not valid UTF-8 JSON") from exc
    root = _required_object(document)
    rule_root = _required_object(root.get("suture_closure_rules_months"))
    suture = _required_object(rule_root.get("structures"))
    pitfalls = root.get("anatomical_pitfalls")
    if not isinstance(pitfalls, list):
        raise ValueError("anatomical_pitfalls must be an array")
    if len(suture) + len(pitfalls) > MAX_SOURCE_ITEMS:
        raise ValueError("too many source candidates")

    result: list[CorpusCandidate] = []
    for label in sorted(suture, key=lambda x: (normalize_token(x), x)):
        source_row = _required_object(suture[label])
        species: list[Literal["canine", "feline"]] = []
        for source_key, term in (("dogs", "canine"), ("cats", "feline")):
            if source_key not in source_row:
                raise ValueError("missing species field in suture source")
            if source_row[source_key] is not None:
                if not isinstance(source_row[source_key], list):
                    raise ValueError("suture species field has invalid shape")
                species.append(term)
        result.append(_make_candidate(
            label=label, origin="suture_schedule",
            pointer="/suture_closure_rules_months/structures/" + _pointer_component(label),
            species=tuple(species),
        ))
    for index, row in enumerate(pitfalls):
        obj = _required_object(row)
        label = obj.get("structure")
        if not isinstance(label, str):
            raise ValueError("pitfall structure missing or invalid")
        result.append(_make_candidate(
            label=label, origin="anatomical_pitfall",
            pointer=f"/anatomical_pitfalls/{index}/structure",
        ))

    # No synonym mapping is derived from similar names, parentheticals,
    # adjacent descriptions, suggested radiology criteria, or breed metadata.
    by_surface: dict[str, int] = {}
    for item in result:
        token = normalize_token(item.preferred_label_as_written)
        by_surface[token] = by_surface.get(token, 0) + 1
    flagged = [
        item.model_copy(update={"flags": (*item.flags, "duplicate_surface")})
        if by_surface[normalize_token(item.preferred_label_as_written)] > 1
        else item for item in result
    ]
    return CorpusReviewQueue(
        source_sha256=sha256(raw).hexdigest(), candidates=tuple(flagged),
    )


def read_corpus(path: Path) -> CorpusReviewQueue:
    if not path.is_file() or path.is_symlink():
        raise ValueError("source is not a regular file")
    if path.stat().st_size > MAX_SOURCE_BYTES:
        raise ValueError("source exceeds size limit")
    return extract_candidates(path.read_bytes())


def pending_catalog(queue: CorpusReviewQueue) -> TermCatalog:
    """Draft only: strict, single-term labels; ALWAYS pending, NEVER activated.

    Deliberately EXCLUDES every pitfall, qualified label and composite name.
    Even retained names are source candidates, not clinically approved terms.
    """
    terms: list[TermEntry] = []
    for item in queue.candidates:
        if item.origin != "suture_schedule" or not item.species_mentioned:
            continue
        if any(flag in item.flags for flag in (
            "qualified_label", "composite_label", "duplicate_surface",
        )):
            continue
        species: Literal["canine", "feline", "any"] = (
            item.species_mentioned[0] if len(item.species_mentioned) == 1 else "any"
        )
        terms.append(TermEntry(
            canonical_id=item.candidate_id,
            kind="anatomy",
            preferred_label=item.preferred_label_as_written,
            aliases=(),
            scope=TermScope(species=species, domain="cranium"),
            review_state="pending",
            reviewed_by=None,
            source_references=(f"corpus:{SOURCE_ID}#{item.source_pointer}",),
        ))
    return TermCatalog(
        catalog_id="vetmind-cranial-neuro-draft",
        catalog_version="0.2.0",
        terms=tuple(terms),
    )
