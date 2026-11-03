"""Versioned, conservative terminology normalization for offline comparisons.

This is not a clinical ontology. Aliases must be curated and reviewed before use
with clinical data. Unknown expressions never become known diagnoses by guessing.
"""
from __future__ import annotations
import re
import unicodedata
from dataclasses import dataclass, field
from collections.abc import Mapping


def normalize_token(value: str) -> str:
    if not isinstance(value, str):
        raise TypeError('term must be a string')
    text = unicodedata.normalize('NFKC', value).casefold().strip()
    text = ''.join(char for char in unicodedata.normalize('NFKD', text)
                   if not unicodedata.combining(char))
    return re.sub(r'\s+', ' ', re.sub(r'[^\w]+', ' ', text)).strip()


@dataclass(frozen=True)
class TermMatch:
    canonical: str | None
    normalized: str
    match_type: str
    vocabulary_version: str


@dataclass
class Terminology:
    version: str
    aliases: Mapping[str, list[str]]
    _lookup: dict[str, str] = field(init=False, repr=False)

    def __post_init__(self) -> None:
        if not self.version.strip():
            raise ValueError('vocabulary version required')
        lookup: dict[str, str] = {}
        for canonical, alternatives in self.aliases.items():
            if not canonical.strip():
                raise ValueError('canonical term must not be blank')
            if isinstance(alternatives, (str, bytes)):
                raise TypeError('aliases must be a sequence of strings')
            for candidate in [canonical, *alternatives]:
                key = normalize_token(candidate)
                if not key:
                    raise ValueError('empty normalized alias')
                existing = lookup.get(key)
                if existing and existing != canonical:
                    raise ValueError(f'alias collision: {candidate!r}')
                lookup[key] = canonical
        self._lookup = lookup

    def resolve(self, term: str) -> TermMatch:
        key = normalize_token(term)
        canonical = self._lookup.get(key)
        kind = ('unknown' if canonical is None else
                'canonical' if key == normalize_token(canonical) else 'alias')
        return TermMatch(canonical, key, kind, self.version)

    def equivalent(self, first: str, second: str) -> bool:
        a, b = self.resolve(first), self.resolve(second)
        return a.canonical is not None and a.canonical == b.canonical


EMPTY_VOCABULARY = Terminology(version='unconfigured', aliases={})
