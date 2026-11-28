#!/usr/bin/env python3
"""Copy an existing rag_index.json (seed + clinic sources) into ChromaDB (#103).

Run (from backend/):
  python scripts/rag_migrate_to_chroma.py                       # data/rag_index.json -> data/chroma
  python scripts/rag_migrate_to_chroma.py --json old.json --chroma /tmp/chroma
  python scripts/rag_migrate_to_chroma.py --url http://localhost:8001   # Chroma server

Vectors are copied as they are; if the configured embedding (VETMIND_RAG_EMBEDDING) differs
from the one in the file, every document is re-embedded. Refuses to write into a collection
that already has documents unless --replace is given. The JSON file is left untouched.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.rag.chroma_store import (  # noqa: E402
    DEFAULT_COLLECTION,
    ChromaVectorStore,
    make_chroma_client,
)
from app.rag.ollama_embeddings import build_embedding_backend  # noqa: E402
from app.rag.vector_store import read_json_index  # noqa: E402
from app.settings import load_settings  # noqa: E402


def main() -> int:
    settings = load_settings()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--json", type=Path, default=settings.rag_index_path, help="source rag_index.json")
    parser.add_argument("--chroma", type=Path, default=settings.chroma_path, help="Chroma folder")
    parser.add_argument("--url", default=settings.chroma_url, help="Chroma server URL (instead of --chroma)")
    parser.add_argument("--collection", default=DEFAULT_COLLECTION)
    parser.add_argument("--replace", action="store_true", help="empty the collection first")
    args = parser.parse_args()

    if args.json is None or not args.json.is_file():
        print(f"JSON index not found: {args.json}", file=sys.stderr)
        return 1
    docs, signature = read_json_index(args.json)
    custom = sum(1 for d in docs if d.source_key.startswith("custom-"))
    print(f"{args.json}: {len(docs)} chunks ({custom} from clinic uploads), embedding {signature}")

    path = None if args.url else args.chroma
    client = make_chroma_client(path, args.url)
    existing = {c.name for c in client.list_collections()}
    if args.collection in existing:
        count = client.get_collection(args.collection).count()
        if count and not args.replace:
            print(f"Collection '{args.collection}' already has {count} records; use --replace.", file=sys.stderr)
            return 2
        if args.replace:
            client.delete_collection(args.collection)

    store = ChromaVectorStore(
        path=path, url=args.url, backend=build_embedding_backend(),
        collection=args.collection, legacy_json=args.json, client=client,
    )
    store.load()
    print(f"Chroma '{args.collection}' at {args.url or path}: {store.count()} records")
    return 0 if store.count() >= len(docs) else 3


if __name__ == "__main__":
    raise SystemExit(main())
