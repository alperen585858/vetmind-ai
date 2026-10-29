"""Scripted demo cases backed by the real pipeline (synthetic DICOM fixtures only).

Every case created here carries ``demo_seed=True`` so the whole set can be removed
without touching real data. Seeded reviews never reach the expert-feedback dataset.

Entry points:
- ``ensure_demo_seed``: startup hook, gated by ``VETMIND_DEMO_SEED=1``; only runs on an
  empty case store, so it never mixes into real data.
- ``seed_demo_cases`` / ``remove_demo_cases``: used by ``scripts/seed_demo.py``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Callable, Literal, Optional

from app.dicom.fixtures import (
    brain_ct_study_files,
    brain_mri_study_files,
    cervical_mri_study_files,
    thorax_xr_study_files,
)
from app.schemas.case import CaseAssignmentUpdate, CasePriority, ReviewFeedback, StructuredClinicalHistory
from app.schemas.dicom import ConfirmClassificationRequest
from app.schemas.enums import ReviewAction, Species

if TYPE_CHECKING:
    from app.container import AppContainer

log = logging.getLogger(__name__)

DEMO_CLINIC_NAME = ""
DEMO_CLINIC_ID = "clinic-demo-a"
DEMO_VET = "vet@demo.local"
DEMO_EXPERT = "expert@demo.local"
DEMO_OWNER = "owner@demo.local"

Stage = Literal["created", "analyzed", "assigned", "revision", "approved"]

_FIXTURES: dict[str, Callable[[int], list[tuple[str, bytes]]]] = {
    "brain_mri": brain_mri_study_files,
    "cervical_mri": cervical_mri_study_files,
    "brain_ct": brain_ct_study_files,
    "thorax_xr": thorax_xr_study_files,
}


@dataclass(frozen=True)
class DemoPatient:
    patient_name: str
    species: Species
    breed: str
    age_years: float
    fixture: str
    instances: int
    stage: Stage
    days_ago: int
    priority: CasePriority
    history: StructuredClinicalHistory
    exam: str
    owned_by_demo_owner: bool = False
    review_comment: Optional[str] = None
    review_edits: dict[str, str] = field(default_factory=dict)


DEMO_PATIENTS: tuple[DemoPatient, ...] = (
    DemoPatient(
        patient_name="Duman",
        species=Species.FELINE,
        breed="British Shorthair",
        age_years=4,
        fixture="brain_mri",
        instances=12,
        stage="approved",
        days_ago=16,
        priority="normal",
        history=StructuredClinicalHistory(
            complaint="Tekrarlayan jeneralize nöbetler (son 3 ayda 4 kez)",
            onset="Kronik",
            course="Progresif",
            relevant_history="Kapalı ortamda yaşıyor, toksin maruziyeti öyküsü yok.",
            medications="Yok",
        ),
        exam="Nöbetler arası nörolojik muayene normal sınırlarda.",
        review_comment="Öneriler bölümüne doz ve takip planı eklendi.",
        review_edits={
            "edited_recommendations": (
                "Fenobarbital 2.5 mg/kg BID ile antiepileptik tedavi başlanması; 14. günde serum "
                "fenobarbital düzeyi ve karaciğer enzimleri kontrolü. Nöbet günlüğü tutulması. "
                "Nöbet sıklığı artarsa BOS analizi."
            ),
        },
    ),
    DemoPatient(
        patient_name="Zeytin",
        species=Species.CANINE,
        breed="Alman Kurdu",
        age_years=10,
        fixture="thorax_xr",
        instances=1,
        stage="approved",
        days_ago=23,
        priority="normal",
        history=StructuredClinicalHistory(
            complaint="Kronik öksürük ve egzersiz intoleransı",
            onset="Kronik",
            course="Progresif",
            relevant_history="Kalça displazisi öyküsü. Arka bacaklarda yavaş ilerleyen dengesizlik ayrıca izleniyor.",
            medications="Omega-3 takviyesi",
        ),
        exam="Solunum sesleri bilateral hafif sertleşmiş; kardiyak üfürüm duyulmadı.",
        owned_by_demo_owner=True,
        review_comment="Taslak uygun bulundu.",
    ),
    DemoPatient(
        patient_name="Tarçın",
        species=Species.CANINE,
        breed="Fransız Bulldog",
        age_years=3,
        fixture="cervical_mri",
        instances=12,
        stage="revision",
        days_ago=10,
        priority="high",
        history=StructuredClinicalHistory(
            complaint="Boyun ağrısı, başını aşağıda tutma, dokunulunca bağırma",
            onset="Akut",
            course="Stabil",
            relevant_history="Bilinen hastalık yok.",
            medications="Tramadol (2 gün)",
        ),
        exam="Servikal hiperestezi. Yürüyüş ve postural reaksiyonlar normal.",
        review_comment=(
            "Steroid yanıtlı menenjit-arterit ayırıcı tanısı daha ayrıntılı tartışılmalı; "
            "BOS analizi önerisi ve vücut ısısı bilgisi eklenmeli."
        ),
    ),
    DemoPatient(
        patient_name="Paşa",
        species=Species.CANINE,
        breed="Dachshund",
        age_years=6,
        fixture="cervical_mri",
        instances=12,
        stage="assigned",
        days_ago=7,
        priority="urgent",
        history=StructuredClinicalHistory(
            complaint="Ani başlayan boyun ağrısı, dört bacakta güçsüzlük, başını kaldırmakta isteksizlik",
            onset="Akut",
            course="Progresif",
            relevant_history="Daha önce nörolojik şikâyet öyküsü yok. Aşıları güncel. Hafif kilolu.",
            medications="Meloksikam 0.1 mg/kg/gün (1 gündür)",
        ),
        exam="Tetraparezi, servikal hiperestezi; pelvik reflekslerde artış. Derin ağrı değerlendirilmedi.",
        owned_by_demo_owner=True,
    ),
    DemoPatient(
        patient_name="Karamel",
        species=Species.CANINE,
        breed="Golden Retriever",
        age_years=9,
        fixture="brain_ct",
        instances=12,
        stage="analyzed",
        days_ago=6,
        priority="high",
        history=StructuredClinicalHistory(
            complaint="Ani başlayan baş eğikliği, gözlerde istemsiz hareket, dengesizlik",
            onset="Akut",
            course="Stabil",
            relevant_history="Hipotiroidi şüphesi (tetkik edilmedi).",
            medications="Yok",
        ),
        exam="Ataksi (dört bacak), baş eğikliği, nistagmus.",
    ),
    DemoPatient(
        patient_name="Pamuk",
        species=Species.FELINE,
        breed="Tekir",
        age_years=12,
        fixture="brain_mri",
        instances=12,
        stage="created",
        days_ago=6,
        priority="normal",
        history=StructuredClinicalHistory(
            complaint="Davranış değişikliği, sürekli aynı yöne dönme",
            onset="Kronik",
            course="Progresif",
            relevant_history="Hipertiroidi tedavisi altında.",
            medications="Metimazol",
        ),
        exam="Bilinç depresif; sola doğru dönme davranışı.",
    ),
)


def _history_text(p: DemoPatient) -> str:
    h = p.history
    return (
        f"Şikâyet: {h.complaint}. Başlangıç: {h.onset}, seyir: {h.course}. "
        f"Öykü: {h.relevant_history} İlaçlar: {h.medications}. "
        f"Nörolojik muayene: {p.exam}"
    )


def demo_case_ids(container: AppContainer) -> list[str]:
    return [c.case_id for c in container.repo.list_cases() if c.demo_seed]


def _seed_one(container: AppContainer, p: DemoPatient, now: datetime) -> str:
    repo = container.repo
    upload = container.dicom.upload(
        files=_FIXTURES[p.fixture](p.instances),
        patient_name=p.patient_name,
        species=p.species,
        breed=p.breed,
        clinical_history=_history_text(p),
        referring_clinic=DEMO_CLINIC_NAME,
    )
    case = container.dicom.confirm(
        upload.ingest_id,
        ConfirmClassificationRequest(
            imaging_source_permission_verified=True,
            imaging_analysis_consent_verified=True,
        ),
    )
    # Flag before any review so feedback hooks can skip the case.
    case.demo_seed = True
    case.created_at = now - timedelta(days=p.days_ago)
    case.patient_age_years = p.age_years
    case.priority = p.priority
    case.clinical_history_structured = p.history
    case.owner_subject = DEMO_VET
    case.clinic_id = DEMO_CLINIC_ID
    if p.owned_by_demo_owner:
        case.pet_owner_subject = DEMO_OWNER
    repo.save_case(case)
    case_id = case.case_id

    if p.stage == "created":
        return case_id
    container.cases.analyze(case_id)

    if p.stage == "assigned":
        container.cases.update_assignment(
            case_id, CaseAssignmentUpdate(assigned_reviewer_id=DEMO_EXPERT, priority=p.priority)
        )
    elif p.stage in ("revision", "approved"):
        action = ReviewAction.APPROVE if p.stage == "approved" else ReviewAction.REQUEST_REVISION
        container.cases.submit_review(
            case_id,
            ReviewFeedback(
                reviewer_id=DEMO_EXPERT,
                action=action,
                comment=p.review_comment,
                **p.review_edits,
            ),
        )
    return case_id


def seed_demo_cases(container: AppContainer) -> list[str]:
    """Create the demo set. Caller decides whether existing demo cases should go first."""
    now = datetime.now(timezone.utc)
    return [_seed_one(container, p, now) for p in DEMO_PATIENTS]


def remove_demo_cases(container: AppContainer) -> int:
    """Delete every ``demo_seed`` case plus its jobs, ingests, quarantine bytes,
    notifications and support threads. Real cases are never touched."""
    repo = container.repo
    doomed = [c for c in repo.list_cases() if c.demo_seed]
    ids = {c.case_id for c in doomed}
    for case in doomed:
        ingest_ids = {ref.ingest_id for ref in case.attachment_refs}
        if case.dicom_ingest_id:
            ingest_ids.add(case.dicom_ingest_id)
        if case.document_context is not None:
            ingest_ids.add(case.document_context.document_ingest_id)
            ingest_ids.update(case.document_context.additional_ingest_ids)
        for ingest_id in ingest_ids:
            repo.delete_ingestion(ingest_id)
            container.quarantine.remove_ingest(ingest_id)
        repo.delete_case(case.case_id)
    if ids:
        container.notification_store.delete_for_cases(ids)
        for thread in container.messaging_store.list_threads():
            if thread.related_case_id in ids:
                container.messaging_store.delete_thread(thread.thread_id)
    return len(doomed)


def ensure_demo_seed(container: AppContainer) -> list[str]:
    """Startup hook: seed only when enabled and the case store is completely empty."""
    if not container.settings.demo_seed:
        return []
    if container.repo.list_cases():
        return []
    ids = seed_demo_cases(container)
    log.info("VETMIND_DEMO_SEED: created %d demo cases", len(ids))
    return ids
