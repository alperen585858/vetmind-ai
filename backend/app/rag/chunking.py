"""Split long knowledge-base sources into retrieval chunks (#100).

A long source embedded as one vector blurs its topics together, so uploads are cut
into ~600-900 character chunks on paragraph and sentence boundaries. Each chunk keeps
its own text (``text``) plus the previous chunk's last sentence as ``context``: the
context is embedded with the chunk (so a sentence that refers back still matches) but
is not part of the stored passage, so joining the chunks gives back the source.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

TARGET_CHARS = 800
MAX_CHARS = 900
_MAX_CONTEXT = 300

_PARAGRAPH = re.compile(r"\n\s*\n")
# Sentence end: . ! ? … followed by whitespace. Abbreviations may split early; harmless here.
_SENTENCE = re.compile(r"(?<=[.!?…])\s+")


@dataclass(frozen=True)
class Chunk:
    text: str
    context: str = ""


def _sentences(text: str) -> list[str]:
    out: list[str] = []
    for para in _PARAGRAPH.split(text):
        para = " ".join(para.split())
        if para:
            out.extend(s for s in _SENTENCE.split(para) if s)
    return out


def _hard_split(sentence: str, limit: int) -> list[str]:
    """A single sentence longer than the limit is cut on word boundaries."""
    parts: list[str] = []
    current = ""
    for word in sentence.split():
        if current and len(current) + 1 + len(word) > limit:
            parts.append(current)
            current = word
        else:
            current = f"{current} {word}" if current else word
    if current:
        parts.append(current)
    return parts


def split_passage(text: str, *, target: int = TARGET_CHARS, max_chars: int = MAX_CHARS) -> list[Chunk]:
    """Return one chunk for short text, otherwise sentence-packed chunks of about ``target`` chars."""
    clean = (text or "").strip()
    if not clean:
        return []
    if len(clean) <= max_chars:
        return [Chunk(text=clean)]

    pieces: list[str] = []
    for sentence in _sentences(clean):
        pieces.extend(_hard_split(sentence, max_chars) if len(sentence) > max_chars else [sentence])

    texts: list[list[str]] = [[]]
    size = 0
    for piece in pieces:
        if texts[-1] and size + 1 + len(piece) > target:
            texts.append([])
            size = 0
        texts[-1].append(piece)
        size += len(piece) + (1 if size else 0)

    chunks: list[Chunk] = []
    for i, group in enumerate(texts):
        context = ""
        if i > 0:
            last = texts[i - 1][-1]
            context = last if len(last) <= _MAX_CONTEXT else ""
        chunks.append(Chunk(text=" ".join(group), context=context))
    return chunks


def chunk_id(source_id: str, index: int, count: int) -> str:
    """Single-chunk sources keep their id (older indexes stay valid); others get ``#n``."""
    return source_id if count == 1 else f"{source_id}#{index + 1}"
