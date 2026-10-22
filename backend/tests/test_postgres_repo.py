"""Postgres repository smoke test — skipped unless VETMIND_DATABASE_URL is set."""

from __future__ import annotations

import os
from uuid import uuid4

import pytest

from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, CaseLifecycleStatus, Modality, Species


pytestmark = pytest.mark.skipif(
    not (os.getenv("VETMIND_DATABASE_URL") or os.getenv("DATABASE_URL")),
    reason="Set VETMIND_DATABASE_URL to run Postgres integration tests.",
)


def test_postgres_case_roundtrip() -> None:
    from app.services.postgres_repository import PostgresCaseRepository

    url = os.getenv("VETMIND_DATABASE_URL") or os.getenv("DATABASE_URL")
    assert url
    repo = PostgresCaseRepository(url)
    case = CaseRecord(
        case_id=f"case-{uuid4().hex[:10]}",
        patient_name="Postgres Demo",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        status=CaseLifecycleStatus.CREATED,
    )
    repo.save_case(case)
    loaded = repo.get_case(case.case_id)
    assert loaded is not None
    assert loaded.patient_name == "Postgres Demo"
    repo.close()
