"""Clinic-scoped patient records (#108).

Cases keep their payload as JSON; ``patient_id`` lives in that payload, so the cases table
needs no change. Existing cases simply have no patient until one is linked.

Revision ID: 0003_patients
Revises: 0002_email_verifications
Create Date: 2026-11-26
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003_patients"
down_revision = "0002_email_verifications"
branch_labels = None
depends_on = None

JSON_DOC = sa.Text().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    if sa.inspect(op.get_bind()).has_table("patients"):
        return
    op.create_table(
        "patients",
        sa.Column("patient_id", sa.Text, primary_key=True),
        sa.Column("clinic_id", sa.Text),
        sa.Column("created_at", sa.Text, nullable=False),
        sa.Column("payload", JSON_DOC, nullable=False),
    )
    op.create_index("ix_patients_clinic", "patients", ["clinic_id"])


def downgrade() -> None:
    op.drop_table("patients")
