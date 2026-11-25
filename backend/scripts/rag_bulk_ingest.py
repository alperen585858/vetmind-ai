#!/usr/bin/env python3
"""Bulk-load knowledge passages into the RAG vector store (ChromaDB by default).

Usage (from backend/):
  python scripts/rag_bulk_ingest.py path/to/docs.jsonl
  python scripts/rag_bulk_ingest.py path/to/docs.json

JSONL: one object per line with title, passage, optional section/keywords/source_id/approved.
JSON: {"documents":[...]} or a bare list.

approved defaults to false — do not claim clinical KB unless you set true.
See docs/INTEGRATION_PLAYBOOK.md.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Allow `python scripts/rag_bulk_ingest.py` from backend/
_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from dataclasses import replace  # noqa: E402

from app.rag.ollama_embeddings import build_embedding_backend  # noqa: E402
from app.rag.stores import build_vector_store  # noqa: E402
from app.settings import load_settings  # noqa: E402


def _load_rows(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return []
    if path.suffix.lower() == ".jsonl":
        rows: list[dict] = []
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            rows.append(json.loads(line))
        return rows
    data = json.loads(text)
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("documents"), list):
        return data["documents"]
    raise SystemExit("JSON must be a list or {\"documents\": [...]}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Bulk ingest RAG documents into the VetMind vector store (Chroma by default).")
    parser.add_argument("path", type=Path, help="JSONL or JSON file of documents")
    parser.add_argument(
        "--index",
        type=Path,
        default=None,
        help="Use this JSON index file instead of Chroma (VETMIND_RAG_STORE=json)",
    )
    args = parser.parse_args()
    if not args.path.is_file():
        print(f"File not found: {args.path}", file=sys.stderr)
        return 1
    settings = load_settings()
    if args.index:
        settings = replace(settings, rag_store="json", rag_index_path=args.index)
    store = build_vector_store(settings, build_embedding_backend())
    store.load()
    index_path = getattr(store, "url", None) or store.path
    rows = _load_rows(args.path)
    added = store.add_documents_bulk(rows, default_approved=False)
    print(f"Added {len(added)} document(s). Index size={len(store)}. path={index_path}")
    for doc in added:
        print(f"  - {doc.source_id} approved={doc.approved} title={doc.title[:60]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
