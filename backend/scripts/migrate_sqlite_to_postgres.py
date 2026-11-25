#!/usr/bin/env python3
"""Copy old local data into the VetMind database (#102).

Reads every *.sqlite3 file in the data folder (the old main file and its sidecars:
vetmind_workflow, vetmind_auth, vetmind_notifications, ...) plus the old flat files
(audit/security.jsonl, feedback/feedback.jsonl, revision_lessons.json) and writes them into
the target database, after running the migrations there. Rows that already exist are kept
(ON CONFLICT DO NOTHING), so running it twice is safe. Source files are not changed.

Run (from backend/):
  python scripts/migrate_sqlite_to_postgres.py                                   # data/ -> VETMIND_DATABASE_URL
  python scripts/migrate_sqlite_to_postgres.py --to postgresql://vetmind:vetmind@localhost:5432/vetmind
  python scripts/migrate_sqlite_to_postgres.py --to sqlite:///data/vetmind.sqlite3   # merge sidecars into one file
  python scripts/migrate_sqlite_to_postgres.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.feedback.store import FeedbackStore  # noqa: E402
from app.llm.lessons import LessonStore, RevisionLesson  # noqa: E402
from app.security.audit import AuditEvent, AuditLogger  # noqa: E402
from app.settings import load_settings  # noqa: E402
from app.storage.sql import Database, SqlConnection  # noqa: E402

# Old files whose rows should win over the defaults a fresh database may already hold.
_REPLACE_TABLES = {"radiologist_payout_settings"}


def _target_columns(conn: SqlConnection, table: str) -> list[str]:
    if conn.dialect == "sqlite":
        return [r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    rows = conn.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?",
        (table,),
    ).fetchall()
    return [r["column_name"] for r in rows]


def _primary_key(conn: SqlConnection, table: str) -> list[str]:
    if conn.dialect == "sqlite":
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
        return [r["name"] for r in sorted(rows, key=lambda r: r["pk"]) if r["pk"]]
    rows = conn.execute(
        """
        SELECT a.attname AS name FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = ?::regclass AND i.indisprimary
        """,
        (table,),
    ).fetchall()
    return [r["name"] for r in rows]


def copy_sqlite_file(path: Path, target: SqlConnection, *, dry_run: bool) -> dict[str, int]:
    counts: dict[str, int] = {}
    src = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    src.row_factory = sqlite3.Row
    try:
        tables = [r["name"] for r in src.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        for table in tables:
            if table in {"alembic_version", "sqlite_sequence"}:
                continue
            target_cols = _target_columns(target, table)
            if not target_cols:
                print(f"  skip {path.name}:{table} (no such table in the new schema)")
                continue
            src_cols = [r["name"] for r in src.execute(f"PRAGMA table_info({table})")]
            cols = [c for c in src_cols if c in target_cols]
            rows = src.execute(f"SELECT {', '.join(cols)} FROM {table}").fetchall()
            counts[f"{path.name}:{table}"] = len(rows)
            if dry_run or not rows:
                continue
            pk = _primary_key(target, table)
            if table in _REPLACE_TABLES and pk:
                updates = ", ".join(f"{c}=excluded.{c}" for c in cols if c not in pk)
                conflict = f"ON CONFLICT({', '.join(pk)}) DO UPDATE SET {updates}"
            else:
                conflict = "ON CONFLICT DO NOTHING"
            sql = f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)}) {conflict}"
            target.executemany(sql, [tuple(r[c] for c in cols) for r in rows])
            target.commit()
    finally:
        src.close()
    return counts


def copy_flat_files(data_dir: Path, db: Database, *, dry_run: bool) -> dict[str, int]:
    counts: dict[str, int] = {}
    audit_path = data_dir / "audit" / "security.jsonl"
    if audit_path.is_file():
        lines = [json.loads(x) for x in audit_path.read_text(encoding="utf-8").splitlines() if x.strip()]
        counts[str(audit_path.relative_to(data_dir))] = len(lines)
        if not dry_run and lines:
            audit = AuditLogger(conn=db.connect())
            for row in lines:
                audit.insert(AuditEvent(**{k: row.get(k) for k in AuditEvent.__dataclass_fields__}))
    feedback_path = data_dir / "feedback" / "feedback.jsonl"
    if feedback_path.is_file():
        lines = [json.loads(x) for x in feedback_path.read_text(encoding="utf-8").splitlines() if x.strip()]
        counts[str(feedback_path.relative_to(data_dir))] = len(lines)
        if not dry_run and lines:
            fb = FeedbackStore(conn=db.connect())
            for row in lines:
                fb.insert(fb.parse(row))
    lessons_path = data_dir / "revision_lessons.json"
    if lessons_path.is_file():
        raw = json.loads(lessons_path.read_text(encoding="utf-8") or "{}")
        items = raw.get("lessons", [])
        counts[lessons_path.name] = len(items)
        if not dry_run and items:
            store = LessonStore(conn=db.connect())
            for item in items:
                store.import_lesson(RevisionLesson.model_validate(item))
    return counts


def main() -> int:
    settings = load_settings()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data", help="folder with the old *.sqlite3 files")
    parser.add_argument("--to", default=settings.database_url, help="target database URL (postgresql:// or sqlite:///)")
    parser.add_argument("--dry-run", action="store_true", help="only count what would be copied")
    args = parser.parse_args()

    if not args.data_dir.is_dir():
        print(f"No data folder: {args.data_dir}", file=sys.stderr)
        return 1
    db = Database(args.to)
    target = db.connect()  # runs the migrations
    safe = args.to.split("@", 1)[-1]
    print(f"{'Would copy' if args.dry_run else 'Copying'} {args.data_dir} -> {db.dialect} {safe}")
    target_file = Path(args.to.split("sqlite:///", 1)[1]).resolve() if db.dialect == "sqlite" else None

    totals: dict[str, int] = {}
    for path in sorted(args.data_dir.glob("*.sqlite3")):
        if target_file is not None and path.resolve() == target_file:
            continue
        totals.update(copy_sqlite_file(path, target, dry_run=args.dry_run))
    totals.update(copy_flat_files(args.data_dir, db, dry_run=args.dry_run))
    for key, n in totals.items():
        print(f"  {key}: {n}")
    print(f"{sum(totals.values())} rows {'found' if args.dry_run else 'copied (existing rows kept)'}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
