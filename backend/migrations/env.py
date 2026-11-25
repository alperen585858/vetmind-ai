"""Alembic environment: plain SQL migrations, no ORM models (#102)."""

from __future__ import annotations

import os

from alembic import context
from sqlalchemy import create_engine, pool

from app.storage.sql import sqlalchemy_url

config = context.config


def _url() -> str:
    url = context.get_x_argument(as_dictionary=True).get("url") or config.get_main_option("sqlalchemy.url")
    if not url:
        url = os.getenv("VETMIND_DATABASE_URL") or os.getenv("DATABASE_URL") or ""
    if not url:
        raise RuntimeError("No database URL: pass -x url=..., or set VETMIND_DATABASE_URL.")
    return sqlalchemy_url(url)


def run_migrations_offline() -> None:
    context.configure(url=_url(), literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, render_as_batch=connection.dialect.name == "sqlite")
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
