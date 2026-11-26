"""Small key/value table for settings an admin changes from the UI (#107: 2FA role policy).

Revision ID: 0005_app_settings
Revises: 0004_audit_indexes
Create Date: 2026-11-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0005_app_settings"
down_revision = "0004_audit_indexes"
branch_labels = None
depends_on = None

JSON_DOC = sa.Text().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    if sa.inspect(op.get_bind()).has_table("app_settings"):
        return
    op.create_table(
        "app_settings",
        sa.Column("key", sa.Text, primary_key=True),
        sa.Column("payload", JSON_DOC, nullable=False),
        sa.Column("updated_at", sa.Text, nullable=False),
        sa.Column("updated_by", sa.Text),
    )


def downgrade() -> None:
    op.drop_table("app_settings")
