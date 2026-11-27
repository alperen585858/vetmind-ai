"""RAG vectors in PostgreSQL with pgvector (#117).

One row per retrieval chunk (``IndexedDoc``). The embedding column has no fixed size:
the hash embedding has 2048 dimensions and bge-m3 1024, and an HNSW index is limited to
2000, so search is an exact scan (milliseconds at our size: hundreds to a few thousand
chunks). PostgreSQL only; SQLite keeps the JSON file store.

Revision ID: 0006_rag_pgvector
Revises: 0005_app_settings
Create Date: 2026-11-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006_rag_pgvector"
down_revision = "0005_app_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    if sa.inspect(bind).has_table("rag_chunks"):
        return
    op.execute(
        """
        CREATE TABLE rag_chunks (
            source_id     TEXT PRIMARY KEY,
            seq           INTEGER NOT NULL,
            title         TEXT NOT NULL,
            section       TEXT NOT NULL,
            passage       TEXT NOT NULL,
            keywords      JSONB NOT NULL DEFAULT '[]'::jsonb,
            approved      BOOLEAN NOT NULL DEFAULT FALSE,
            regions       TEXT[] NOT NULL DEFAULT '{}',
            species       TEXT[] NOT NULL DEFAULT '{}',
            summary       TEXT NOT NULL DEFAULT '',
            tag_source    TEXT NOT NULL DEFAULT '',
            parent_id     TEXT NOT NULL DEFAULT '',
            chunk_index   INTEGER NOT NULL DEFAULT 0,
            chunk_count   INTEGER NOT NULL DEFAULT 1,
            context       TEXT NOT NULL DEFAULT '',
            embedding_sig TEXT NOT NULL,
            embedding     vector NOT NULL,
            fingerprint   TEXT NOT NULL
        )
        """
    )
    op.execute("CREATE INDEX ix_rag_chunks_seq ON rag_chunks (seq)")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute("DROP TABLE IF EXISTS rag_chunks")
