"""Demo seed: scripted cases on the real pipeline, removable without touching real data."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.demo_seed import DEMO_PATIENTS, demo_case_ids, ensure_demo_seed, remove_demo_cases, seed_demo_cases
from app.llm.feedback import collect_feedback
from app.main import create_app
from app.schemas.case import ReviewFeedback
from app.schemas.enums import CaseLifecycleStatus, ReviewAction
from app.schemas.messaging import SupportThread
from app.services.repository import InMemoryCaseRepository
from app.services.sqlite_repository import SqliteCaseRepository
from tests.conftest import make_payload
from tests.test_phase6_e2e_journey import _demo_upload_confirm_analyze, _mem_settings


def _container(tmp_path: Path, **kwargs) -> AppContainer:
    return AppContainer(repo=InMemoryCaseRepository(), settings=_mem_settings(tmp_path, **kwargs))


def test_seed_reaches_each_scripted_stage(tmp_path: Path) -> None:
    c = _container(tmp_path)
    ids = seed_demo_cases(c)
    assert len(ids) == len(DEMO_PATIENTS)

    by_name = {c.repo.get_case(i).patient_name: c.repo.get_case(i) for i in ids}
    assert all(case.demo_seed for case in by_name.values())
    assert all(case.case_id.startswith("case-") for case in by_name.values())
    assert by_name["Duman"].status == CaseLifecycleStatus.APPROVED
    assert by_name["Duman"].draft_report.immutable is True
    assert by_name["Zeytin"].status == CaseLifecycleStatus.APPROVED
    assert by_name["Zeytin"].pet_owner_subject == "owner@demo.local"
    assert by_name["Tarçın"].status == CaseLifecycleStatus.REVISION_REQUESTED
    assert by_name["Paşa"].status == CaseLifecycleStatus.AWAITING_REVIEW
    assert by_name["Paşa"].assigned_reviewer_id == "expert@demo.local"
    assert by_name["Karamel"].status == CaseLifecycleStatus.AWAITING_REVIEW
    assert by_name["Karamel"].assigned_reviewer_id is None
    assert by_name["Pamuk"].status == CaseLifecycleStatus.CREATED
    assert by_name["Pamuk"].draft_report is None


def test_seeded_reviews_stay_out_of_expert_feedback(tmp_path: Path) -> None:
    c = _container(tmp_path, feedback_log_path=None)
    seed_demo_cases(c)
    assert c.feedback.list_events(limit=100) == []
    assert collect_feedback(c.repo.list_cases()) == []


def test_remove_deletes_only_demo_cases_and_their_traces(tmp_path: Path) -> None:
    c = _container(tmp_path)
    client = TestClient(create_app(c))
    real_id = _demo_upload_confirm_analyze(client)
    real_ingest = c.repo.get_case(real_id).dicom_ingest_id

    ids = seed_demo_cases(c)
    seeded = [c.repo.get_case(i) for i in ids]
    ingest_ids = [s.dicom_ingest_id for s in seeded]
    c.messaging_store.save_thread(
        SupportThread(channel="radiologist", owner_subject="owner@demo.local", subject="Soru", related_case_id=ids[0])
    )
    assert c.notification_store.list_for("expert@demo.local")

    assert remove_demo_cases(c) == len(ids)

    assert [x.case_id for x in c.repo.list_cases()] == [real_id]
    assert demo_case_ids(c) == []
    for ingest_id in ingest_ids:
        assert c.repo.get_ingestion(ingest_id) is None
        assert not (c.quarantine.root / ingest_id).exists()
    assert all(n.case_id not in ids for n in c.notification_store.list_for("expert@demo.local"))
    assert all(n.case_id not in ids for n in c.notification_store.list_for("vet@demo.local"))
    assert c.messaging_store.list_threads() == []
    # Real case keeps its ingest, quarantine bytes and stays reviewable.
    assert c.repo.get_ingestion(real_ingest) is not None
    assert (c.quarantine.root / real_ingest).is_dir()
    approved = c.cases.submit_review(real_id, ReviewFeedback(reviewer_id="expert-demo", action=ReviewAction.APPROVE))
    assert approved.status == CaseLifecycleStatus.APPROVED


def test_auto_seed_only_when_enabled_and_empty(tmp_path: Path) -> None:
    assert ensure_demo_seed(_container(tmp_path / "off")) == []

    on = _container(tmp_path / "on", demo_seed=True)
    assert len(ensure_demo_seed(on)) == len(DEMO_PATIENTS)
    # Second boot: store is no longer empty, so nothing is added.
    assert ensure_demo_seed(on) == []

    # A store that already holds real data is never seeded, even with the flag on.
    real = _container(tmp_path / "real", demo_seed=True)
    real.cases.create_case(make_payload())
    create_app(real)
    assert demo_case_ids(real) == []


def test_sqlite_delete_case_removes_jobs_and_ingestions(tmp_path: Path) -> None:
    repo = SqliteCaseRepository(tmp_path / "db.sqlite3")
    c = AppContainer(repo=repo, settings=_mem_settings(tmp_path))
    ids = seed_demo_cases(c)
    job_id = repo.get_case(ids[0]).latest_job_id
    assert repo.get_job(job_id) is not None

    assert remove_demo_cases(c) == len(ids)
    assert repo.list_cases() == []
    assert repo.get_job(job_id) is None
    repo.close()
