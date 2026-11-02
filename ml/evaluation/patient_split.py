"""Patient-level train/val/test split helpers (offline)."""

from __future__ import annotations

import hashlib
from collections import defaultdict
from typing import Iterable, Mapping, Sequence


def stable_bucket(patient_id: str, *, salt: str = "vetmind-ml") -> float:
    """Deterministic [0,1) bucket from patient id."""
    digest = hashlib.sha256(f"{salt}:{patient_id}".encode("utf-8")).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF


def split_patients(
    patient_ids: Sequence[str],
    *,
    train_frac: float = 0.7,
    val_frac: float = 0.15,
    salt: str = "vetmind-ml",
) -> dict[str, list[str]]:
    """Split unique patients. Frames must join on patient_id — never split by frame."""
    if train_frac <= 0 or val_frac < 0 or train_frac + val_frac >= 1:
        raise ValueError("Invalid fractions")
    uniq = sorted(set(patient_ids))
    train: list[str] = []
    val: list[str] = []
    test: list[str] = []
    for pid in uniq:
        b = stable_bucket(pid, salt=salt)
        if b < train_frac:
            train.append(pid)
        elif b < train_frac + val_frac:
            val.append(pid)
        else:
            test.append(pid)
    return {"train": train, "val": val, "test": test}


def assert_no_patient_leakage(
    splits: Mapping[str, Iterable[str]],
) -> None:
    seen: dict[str, str] = {}
    for name, ids in splits.items():
        for pid in ids:
            if pid in seen and seen[pid] != name:
                raise AssertionError(
                    f"Patient leakage: {pid!r} in both {seen[pid]!r} and {name!r}"
                )
            seen[pid] = name


def group_frames_by_patient(
    rows: Sequence[Mapping[str, str]],
    *,
    patient_key: str = "patient_id",
) -> dict[str, list[Mapping[str, str]]]:
    grouped: dict[str, list[Mapping[str, str]]] = defaultdict(list)
    for row in rows:
        grouped[str(row[patient_key])].append(row)
    return dict(grouped)
