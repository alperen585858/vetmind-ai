#!/usr/bin/env python3
"""Copy RAG documents (seed + clinic sources) from ChromaDB or rag_index.json into pgvector (#117).

Run (from backend/), with VETMIND_DATABASE_URL pointing at the app's PostgreSQL:
  python scripts/rag_migrate_to_pgvector.py --from-chroma data/chroma        # Chroma folder
  python scripts/rag_migrate_to_pgvector.py --from-chroma-url http://localhost:8001
  python scripts/rag_migrate_to_pgvector.py --from-json data/rag_index.json

Reading from Chroma needs the optional client: pip install -r requirements-chroma.txt.
Vectors are copied as they are; if the configured embedding (VETMIND_RAG_EMBEDDING) differs
from the stored one, every document is re-embedded on load. Refuses to write into a table that
already has documents unless --replace is given. The source is left untouched.

With Docker the backend copies rag_index.json in by itself on first start; this script is for
clinic sources that only exist in a Chroma volume.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.rag.ollama_embeddings import build_embedding_backend  # noqa: E402
from app.rag.pgvector_store import PgVectorStore  # noqa: E402
from app.rag.vector_store import IndexedDoc, read_json_index  # noqa: E402
from app.settings import load_settings  # noqa: E402


def _from_chroma(path: Path | None, url: str | None) -> tuple[list[IndexedDoc], str]:
    from app.rag.chroma_store import ChromaVectorStore

    source = ChromaVectorStore(path=path, url=url)
    stored = source._read()  # noqa: SLF001 — read only, no re-embedding or seeding
    return stored if stored else ([], "")


def main() -> int:
    settings = load_settings()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--from-json", type=Path, help="source rag_index.json")
    src.add_argument("--from-chroma", type=Path, help="source Chroma folder")
    src.add_argument("--from-chroma-url", help="source Chroma server URL")
    parser.add_argument("--database-url", default=settings.database_url, help="target PostgreSQL (pgvector)")
    parser.add_argument("--replace", action="store_true", help="empty rag_chunks first")
    args = parser.parse_args()

    if not args.database_url:
        print("No target database: set VETMIND_DATABASE_URL or pass --database-url.", file=sys.stderr)
        return 1
    if args.from_json is not None:
        if not args.from_json.is_file():
            print(f"JSON index not found: {args.from_json}", file=sys.stderr)
            return 1
        docs, signature = read_json_index(args.from_json)
        label = str(args.from_json)
    else:
        docs, signature = _from_chroma(args.from_chroma, args.from_chroma_url)
        label = str(args.from_chroma or args.from_chroma_url)
    custom = sum(1 for d in docs if d.source_key.startswith("custom-"))
    print(f"{label}: {len(docs)} chunks ({custom} from clinic uploads), embedding {signature or '?'}")
    if not docs:
        print("Nothing to copy.", file=sys.stderr)
        return 1

    store = PgVectorStore(args.database_url, build_embedding_backend())
    existing = store.count()
    if existing and not args.replace:
        print(f"rag_chunks already has {existing} rows; use --replace.", file=sys.stderr)
        return 2
    if args.replace:
        store._conn.execute("DELETE FROM rag_chunks")  # noqa: SLF001
        store._conn.commit()  # noqa: SLF001
    store._docs = docs  # noqa: SLF001
    store._write(signature_override=signature or None)  # noqa: SLF001 — one transaction
    store.load()  # re-embeds if the configured embedding differs, adds missing seed docs
    print(f"pgvector: {store.count()} rows")
    return 0 if store.count() >= len(docs) else 3


if __name__ == "__main__":
    raise SystemExit(main())
