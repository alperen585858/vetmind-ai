"""Review-gated clinical terminology catalogs for the VetMind evaluation module.

A catalog is a software artifact, NOT clinical evidence or an authoritative NAV
ontology. Its entries must be explicitly reviewed before clinical equivalence
may be asserted by the strict resolver.
"""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from evaluation.terminology import normalize_token

Species = Literal["canine", "feline", "any"]
Domain = Literal["cranium", "brain", "cervical", "general"]
TermKind = Literal["finding", "anatomy"]
ReviewState = Literal["pending", "expert_reviewed"]


class LockedModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)


class TermScope(LockedModel):
    species: Species = "any"
    domain: Domain = "general"

    def overlaps(self, other: "TermScope") -> bool:
        return (
            (self.species == "any" or other.species == "any" or self.species == other.species)
            and (self.domain == "general" or other.domain == "general" or self.domain == other.domain)
        )

    def accepts(self, species: Species | None, domain: Domain | None) -> bool:
        return (
            (species is None or self.species == "any" or self.species == species)
            and (domain is None or self.domain == "general" or self.domain == domain)
        )


class TermEntry(LockedModel):
    canonical_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z][A-Za-z0-9_.:-]*$")
    kind: TermKind
    preferred_label: str = Field(min_length=1, max_length=256)
    aliases: tuple[str, ...] = Field(default=(), max_length=64)
    scope: TermScope = Field(default_factory=TermScope)
    review_state: ReviewState = "pending"
    reviewed_by: str | None = Field(default=None, min_length=1, max_length=128)
    source_references: tuple[str, ...] = Field(default=(), max_length=32)

    @model_validator(mode="after")
    def validate_entry(self) -> "TermEntry":
        if self.review_state == "expert_reviewed":
            if not self.reviewed_by or not self.source_references:
                raise ValueError("expert_reviewed requires reviewer and references")
        elif self.reviewed_by:
            raise ValueError("pending entries cannot claim a reviewer")
        normalized = [normalize_token(x) for x in (self.preferred_label, *self.aliases)]
        if not all(normalized) or len(normalized) != len(set(normalized)):
            raise ValueError("empty or duplicate normalized surface form")
        if not all(ref.strip() for ref in self.source_references):
            raise ValueError("blank reference identifier")
        return self

    def surfaces(self) -> tuple[str, ...]:
        return (self.preferred_label, *self.aliases)


class TermCatalog(LockedModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    catalog_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z][A-Za-z0-9_.:-]*$")
    catalog_version: str = Field(min_length=1, max_length=32)
    terms: tuple[TermEntry, ...] = ()

    @model_validator(mode="after")
    def validate_catalog(self) -> "TermCatalog":
        if not re.fullmatch(r"\d+\.\d+\.\d+", self.catalog_version):
            raise ValueError("catalog_version must be semantic version X.Y.Z")
        identifiers: set[str] = set()
        surfaces: dict[tuple[TermKind, str], list[TermEntry]] = {}
        for entry in self.terms:
            if entry.canonical_id in identifiers:
                raise ValueError("duplicate canonical_id")
            identifiers.add(entry.canonical_id)
            for form in entry.surfaces():
                key = (entry.kind, normalize_token(form))
                for prior in surfaces.get(key, []):
                    if prior.scope.overlaps(entry.scope) and (
                        prior.review_state == "expert_reviewed"
                        and entry.review_state == "expert_reviewed"
                    ):
                        raise ValueError("overlapping reviewed surface form collision")
                surfaces.setdefault(key, []).append(entry)
        return self

    @property
    def reviewed_count(self) -> int:
        return sum(t.review_state == "expert_reviewed" for t in self.terms)
