"""Persist pets, imaging submissions, and managed users (JSON document store)."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Optional, Protocol

from app.schemas.workflow import ImagingSubmission, ManagedUser, PetRecord


class WorkflowStore(Protocol):
    def save_pet(self, pet: PetRecord) -> PetRecord: ...

    def get_pet(self, pet_id: str) -> Optional[PetRecord]: ...

    def list_pets(self) -> list[PetRecord]: ...

    def save_submission(self, sub: ImagingSubmission) -> ImagingSubmission: ...

    def get_submission(self, submission_id: str) -> Optional[ImagingSubmission]: ...

    def list_submissions(self) -> list[ImagingSubmission]: ...

    def delete_submission(self, submission_id: str) -> bool: ...

    def save_user(self, user: ManagedUser) -> ManagedUser: ...

    def get_user(self, email: str) -> Optional[ManagedUser]: ...

    def list_users(self) -> list[ManagedUser]: ...

    def delete_user(self, email: str) -> bool: ...


class InMemoryWorkflowStore:
    def __init__(self) -> None:
        self._pets: dict[str, PetRecord] = {}
        self._subs: dict[str, ImagingSubmission] = {}
        self._users: dict[str, ManagedUser] = {}

    def save_pet(self, pet: PetRecord) -> PetRecord:
        self._pets[pet.pet_id] = pet
        return pet

    def get_pet(self, pet_id: str) -> Optional[PetRecord]:
        return self._pets.get(pet_id)

    def list_pets(self) -> list[PetRecord]:
        return sorted(self._pets.values(), key=lambda p: p.created_at, reverse=True)

    def save_submission(self, sub: ImagingSubmission) -> ImagingSubmission:
        self._subs[sub.submission_id] = sub
        return sub

    def get_submission(self, submission_id: str) -> Optional[ImagingSubmission]:
        return self._subs.get(submission_id)

    def list_submissions(self) -> list[ImagingSubmission]:
        return sorted(self._subs.values(), key=lambda s: s.created_at, reverse=True)

    def delete_submission(self, submission_id: str) -> bool:
        return self._subs.pop(submission_id, None) is not None

    def save_user(self, user: ManagedUser) -> ManagedUser:
        self._users[user.email.lower()] = user
        return user

    def get_user(self, email: str) -> Optional[ManagedUser]:
        return self._users.get(email.lower())

    def list_users(self) -> list[ManagedUser]:
        return sorted(self._users.values(), key=lambda u: u.email)

    def delete_user(self, email: str) -> bool:
        return self._users.pop(email.lower(), None) is not None


class SqliteWorkflowStore:
    def __init__(self, db_path: Path | str) -> None:
        self._path = Path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=DELETE;")
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS pets (
                pet_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS submissions (
                submission_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS managed_users (
                email TEXT PRIMARY KEY,
                payload TEXT NOT NULL
            );
            """
        )
        self._conn.commit()

    def save_pet(self, pet: PetRecord) -> PetRecord:
        self._conn.execute(
            """
            INSERT INTO pets (pet_id, created_at, payload) VALUES (?, ?, ?)
            ON CONFLICT(pet_id) DO UPDATE SET created_at=excluded.created_at, payload=excluded.payload
            """,
            (pet.pet_id, pet.created_at.isoformat(), pet.model_dump_json()),
        )
        self._conn.commit()
        return pet

    def get_pet(self, pet_id: str) -> Optional[PetRecord]:
        row = self._conn.execute("SELECT payload FROM pets WHERE pet_id=?", (pet_id,)).fetchone()
        return PetRecord.model_validate_json(row["payload"]) if row else None

    def list_pets(self) -> list[PetRecord]:
        rows = self._conn.execute("SELECT payload FROM pets ORDER BY created_at DESC").fetchall()
        return [PetRecord.model_validate_json(r["payload"]) for r in rows]

    def save_submission(self, sub: ImagingSubmission) -> ImagingSubmission:
        self._conn.execute(
            """
            INSERT INTO submissions (submission_id, created_at, payload) VALUES (?, ?, ?)
            ON CONFLICT(submission_id) DO UPDATE SET created_at=excluded.created_at, payload=excluded.payload
            """,
            (sub.submission_id, sub.created_at.isoformat(), sub.model_dump_json()),
        )
        self._conn.commit()
        return sub

    def get_submission(self, submission_id: str) -> Optional[ImagingSubmission]:
        row = self._conn.execute(
            "SELECT payload FROM submissions WHERE submission_id=?", (submission_id,)
        ).fetchone()
        return ImagingSubmission.model_validate_json(row["payload"]) if row else None

    def list_submissions(self) -> list[ImagingSubmission]:
        rows = self._conn.execute("SELECT payload FROM submissions ORDER BY created_at DESC").fetchall()
        return [ImagingSubmission.model_validate_json(r["payload"]) for r in rows]

    def delete_submission(self, submission_id: str) -> bool:
        cur = self._conn.execute("DELETE FROM submissions WHERE submission_id=?", (submission_id,))
        self._conn.commit()
        return cur.rowcount > 0

    def save_user(self, user: ManagedUser) -> ManagedUser:
        self._conn.execute(
            """
            INSERT INTO managed_users (email, payload) VALUES (?, ?)
            ON CONFLICT(email) DO UPDATE SET payload=excluded.payload
            """,
            (user.email.lower(), user.model_dump_json()),
        )
        self._conn.commit()
        return user

    def get_user(self, email: str) -> Optional[ManagedUser]:
        row = self._conn.execute(
            "SELECT payload FROM managed_users WHERE email=?", (email.lower(),)
        ).fetchone()
        return ManagedUser.model_validate_json(row["payload"]) if row else None

    def list_users(self) -> list[ManagedUser]:
        rows = self._conn.execute("SELECT payload FROM managed_users ORDER BY email").fetchall()
        return [ManagedUser.model_validate_json(r["payload"]) for r in rows]

    def delete_user(self, email: str) -> bool:
        cur = self._conn.execute("DELETE FROM managed_users WHERE email=?", (email.lower(),))
        self._conn.commit()
        return cur.rowcount > 0


def build_workflow_store(settings) -> WorkflowStore:
    if settings.storage_backend == "memory":
        return InMemoryWorkflowStore()
    # sqlite + postgres demos: use sidecar sqlite next to case db (or dedicated path)
    if settings.storage_backend == "postgres":
        # Keep workflow docs in a local sqlite sidecar for Phase 14 (cases remain in Postgres).
        path = Path(settings.sqlite_path).with_name("vetmind_workflow.sqlite3")
        return SqliteWorkflowStore(path)
    return SqliteWorkflowStore(Path(settings.sqlite_path).with_name("vetmind_workflow.sqlite3"))
