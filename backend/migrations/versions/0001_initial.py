"""Initial schema: every store in one database (#102).

Tables that the old code created itself (cases, jobs, ... in an existing Postgres) are left as
they are, so upgrading such a database keeps its rows.

Revision ID: 0001_initial
Revises:
Create Date: 2026-11-25
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

# JSON documents (pydantic payloads): JSONB on Postgres, text on SQLite.
JSON_DOC = sa.Text().with_variant(postgresql.JSONB(), "postgresql")
TEXT = sa.Text
# Epoch seconds (auth / report-link tokens).
EPOCH = sa.Float


def _create(name: str, *columns: sa.Column, indexes: tuple[tuple[str, list[str]], ...] = (), **kw) -> None:
    if sa.inspect(op.get_bind()).has_table(name):
        return
    op.create_table(name, *columns, **kw)
    for index_name, cols in indexes:
        op.create_index(index_name, name, cols)


def upgrade() -> None:
    # Cases (was SqliteCaseRepository / PostgresCaseRepository).
    _create(
        "cases",
        sa.Column("case_id", TEXT, primary_key=True),
        sa.Column("created_at", TEXT, nullable=False),
        sa.Column("payload", JSON_DOC, nullable=False),
        indexes=(("idx_cases_created_at", ["created_at"]),),
    )
    _create(
        "jobs",
        sa.Column("job_id", TEXT, primary_key=True),
        sa.Column("case_id", TEXT, nullable=False),
        sa.Column("payload", JSON_DOC, nullable=False),
        indexes=(("idx_jobs_case_id", ["case_id"]),),
    )
    for table in ("ingestions", "document_ingestions"):
        _create(
            table,
            sa.Column("ingest_id", TEXT, primary_key=True),
            sa.Column("created_at", TEXT, nullable=False),
            sa.Column("payload", JSON_DOC, nullable=False),
        )

    # Workflow (pets, submissions, managed users).
    _create(
        "pets",
        sa.Column("pet_id", TEXT, primary_key=True),
        sa.Column("created_at", TEXT, nullable=False),
        sa.Column("payload", JSON_DOC, nullable=False),
    )
    _create(
        "submissions",
        sa.Column("submission_id", TEXT, primary_key=True),
        sa.Column("created_at", TEXT, nullable=False),
        sa.Column("payload", JSON_DOC, nullable=False),
    )
    _create(
        "managed_users",
        sa.Column("email", TEXT, primary_key=True),
        sa.Column("payload", JSON_DOC, nullable=False),
    )

    _create(
        "user_settings",
        sa.Column("subject", TEXT, primary_key=True),
        sa.Column("payload", JSON_DOC, nullable=False),
        sa.Column("updated_at", TEXT, nullable=False),
    )
    _create(
        "notifications",
        sa.Column("notification_id", TEXT, primary_key=True),
        sa.Column("recipient_subject", TEXT, nullable=False),
        sa.Column("dedupe_key", TEXT, nullable=False, unique=True),
        sa.Column("created_at", TEXT, nullable=False),
        sa.Column("payload", JSON_DOC, nullable=False),
        indexes=(("idx_ntf_recipient", ["recipient_subject"]),),
    )
    _create(
        "support_threads",
        sa.Column("thread_id", TEXT, primary_key=True),
        sa.Column("updated_at", TEXT, nullable=False),
        sa.Column("payload", JSON_DOC, nullable=False),
    )
    _create(
        "demo_payments",
        sa.Column("payment_id", TEXT, primary_key=True),
        sa.Column("submission_id", TEXT, nullable=False, unique=True),
        sa.Column("created_at", TEXT, nullable=False),
        sa.Column("payload", JSON_DOC, nullable=False),
    )
    _create(
        "radiologist_payouts",
        sa.Column("payout_id", TEXT, primary_key=True),
        sa.Column("case_id", TEXT, nullable=False, unique=True),
        sa.Column("radiologist_subject", TEXT, nullable=False),
        sa.Column("approved_at", TEXT, nullable=False),
        sa.Column("payload", JSON_DOC, nullable=False),
        indexes=(("idx_rpay_radiologist", ["radiologist_subject"]),),
    )
    _create(
        "radiologist_payout_settings",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=False),
        sa.Column("payload", JSON_DOC, nullable=False),
        sa.CheckConstraint("id = 1", name="ck_payout_settings_single_row"),
    )

    # Tokens (hashes only; raw tokens are never stored).
    _create(
        "report_view_tokens",
        sa.Column("token_hash", TEXT, primary_key=True),
        sa.Column("case_id", TEXT, nullable=False),
        sa.Column("report_version", sa.Integer, nullable=False),
        sa.Column("created_at", EPOCH, nullable=False),
        sa.Column("expires_at", EPOCH, nullable=False),
        sa.Column("used_at", EPOCH),
        sa.Column("revoked_at", EPOCH),
        indexes=(("ix_report_view_case", ["case_id"]),),
    )
    _create(
        "refresh_tokens",
        sa.Column("token_hash", TEXT, primary_key=True),
        sa.Column("subject", TEXT, nullable=False),
        sa.Column("family_id", TEXT, nullable=False),
        sa.Column("token_version", sa.Integer, nullable=False),
        sa.Column("created_at", EPOCH, nullable=False),
        sa.Column("expires_at", EPOCH, nullable=False),
        sa.Column("revoked_at", EPOCH),
        sa.Column("replaced_by", TEXT),
        indexes=(("ix_refresh_family", ["family_id"]), ("ix_refresh_subject", ["subject"])),
    )
    _create(
        "password_resets",
        sa.Column("token_hash", TEXT, primary_key=True),
        sa.Column("subject", TEXT, nullable=False),
        sa.Column("created_at", EPOCH, nullable=False),
        sa.Column("expires_at", EPOCH, nullable=False),
        sa.Column("used_at", EPOCH),
        indexes=(("ix_reset_subject", ["subject"]),),
    )

    # Formerly flat files: audit JSONL, feedback JSONL, revision_lessons.json.
    _create(
        "audit_events",
        sa.Column("event_id", TEXT, primary_key=True),
        sa.Column("timestamp", TEXT, nullable=False),
        sa.Column("event_type", TEXT, nullable=False),
        sa.Column("actor", TEXT, nullable=False),
        sa.Column("outcome", TEXT, nullable=False),
        sa.Column("clinic_id", TEXT),
        sa.Column("payload", JSON_DOC, nullable=False),
        indexes=(("ix_audit_timestamp", ["timestamp"]),),
    )
    _create(
        "feedback_events",
        sa.Column("event_id", TEXT, primary_key=True),
        sa.Column("case_id", TEXT, nullable=False),
        sa.Column("created_at", TEXT, nullable=False),
        sa.Column("payload", JSON_DOC, nullable=False),
        indexes=(("ix_feedback_case", ["case_id"]), ("ix_feedback_created", ["created_at"])),
    )
    _create(
        "revision_lessons",
        sa.Column("lesson_id", TEXT, primary_key=True),
        sa.Column("created_at", TEXT, nullable=False),
        sa.Column("payload", JSON_DOC, nullable=False),
    )


def downgrade() -> None:
    for table in (
        "revision_lessons", "feedback_events", "audit_events", "password_resets", "refresh_tokens",
        "report_view_tokens", "radiologist_payout_settings", "radiologist_payouts", "demo_payments",
        "support_threads", "notifications", "user_settings", "managed_users", "submissions", "pets",
        "document_ingestions", "ingestions", "jobs", "cases",
    ):
        op.drop_table(table)
