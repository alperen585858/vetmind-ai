"""Indexes for the admin audit screen filters (#106).

Revision ID: 0004_audit_indexes
Revises: 0003_patients
Create Date: 2026-11-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004_audit_indexes"
down_revision = "0003_patients"
branch_labels = None
depends_on = None

_INDEXES = (
    ("ix_audit_event_type", ["event_type"]),
    ("ix_audit_actor", ["actor"]),
    ("ix_audit_clinic", ["clinic_id"]),
)


def upgrade() -> None:
    existing = {ix["name"] for ix in sa.inspect(op.get_bind()).get_indexes("audit_events")}
    for name, cols in _INDEXES:
        if name not in existing:
            op.create_index(name, "audit_events", cols)


def downgrade() -> None:
    for name, _cols in _INDEXES:
        op.drop_index(name, table_name="audit_events")
