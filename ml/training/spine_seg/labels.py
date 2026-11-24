"""SPIDER mask values -> training classes, and the official patient-level split.

SPIDER mask values (Zenodo 10159290):
  0        background
  1-25     vertebrae, numbered from the bottom (L5 = 1)
  100      spinal canal
  101-125  partially visible vertebrae
  201-225  intervertebral discs, numbered from the bottom (L5/S1 = 201)

Vertebra and disc levels are merged: a human level number (L5) has no meaning
in a dog spine, so the model only learns the structure type.
"""

from __future__ import annotations

from typing import Iterable, Mapping

import numpy as np

from ml.evaluation.patient_split import assert_no_patient_leakage, stable_bucket

CLASS_NAMES: tuple[str, ...] = ("background", "vertebra", "spinal_canal", "disc")
NUM_CLASSES = len(CLASS_NAMES)
SEQUENCES: tuple[str, ...] = ("t1", "t2", "t2_SPACE")


def to_classes(mask: np.ndarray) -> np.ndarray:
    """Map raw SPIDER mask values to class indices (uint8)."""
    m = np.asarray(mask)
    out = np.zeros(m.shape, dtype=np.uint8)
    out[((m >= 1) & (m <= 25)) | ((m >= 101) & (m <= 125))] = 1
    out[m == 100] = 2
    out[(m >= 201) & (m <= 225)] = 3
    return out


def parse_series_name(name: str) -> tuple[str, str]:
    """'12_t2_SPACE' -> ('12', 't2_SPACE')."""
    patient, _, sequence = name.partition("_")
    if not patient or sequence not in SEQUENCES:
        raise ValueError(f"Unexpected SPIDER series name: {name!r}")
    return patient, sequence


def build_splits(
    rows: Iterable[Mapping[str, str]],
    *,
    val_frac: float = 0.15,
    sequences: Iterable[str] = SEQUENCES,
    salt: str = "vetmind-spider",
) -> dict[str, list[str]]:
    """Split series names by patient.

    The official SPIDER 'validation' subset becomes our held-out test set (never
    used for model selection). A validation set is carved out of the official
    'training' patients with a deterministic per-patient hash.
    """
    if not 0 < val_frac < 1:
        raise ValueError("val_frac must be in (0, 1)")
    wanted = set(sequences)
    splits: dict[str, list[str]] = {"train": [], "val": [], "test": []}
    patients: dict[str, set[str]] = {"train": set(), "val": set(), "test": set()}
    for row in rows:
        name = row["new_file_name"].strip()
        patient, sequence = parse_series_name(name)
        if sequence not in wanted:
            continue
        subset = row["subset"].strip()
        if subset == "validation":
            split = "test"
        elif subset == "training":
            split = "val" if stable_bucket(patient, salt=salt) < val_frac else "train"
        else:
            raise ValueError(f"Unknown subset {subset!r} for {name}")
        splits[split].append(name)
        patients[split].add(patient)
    assert_no_patient_leakage(patients)
    return {k: sorted(v) for k, v in splits.items()}
