"""Email verification tokens (#41).

Same shape as ``password_resets``: SHA-256 of the emailed token, never the token itself.
User rows need no change: ``email_verified`` lives in the JSON payload and defaults to True,
so every account that existed before this revision counts as verified.

Revision ID: 0002_email_verifications
Revises: 0001_initial
Create Date: 2026-11-26
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002_email_verifications"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if sa.inspect(op.get_bind()).has_table("email_verifications"):
        return
    op.create_table(
        "email_verifications",
        sa.Column("token_hash", sa.Text, primary_key=True),
        sa.Column("subject", sa.Text, nullable=False),
        sa.Column("created_at", sa.Float, nullable=False),
        sa.Column("expires_at", sa.Float, nullable=False),
        sa.Column("used_at", sa.Float),
    )
    op.create_index("ix_email_verify_subject", "email_verifications", ["subject"])


def downgrade() -> None:
    op.drop_table("email_verifications")
