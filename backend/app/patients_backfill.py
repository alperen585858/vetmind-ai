"""Create patient records for cases that predate them (issue #108).

Cases are grouped by clinic + name + species (accent/case-insensitive). A group becomes one
patient only when it is unambiguous: if the same name and species in a clinic come with
different breeds, it may be two animals, so the group is reported and left alone. Nothing is
merged into an *existing* patient record either; those links stay a vet's decision.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from app.schemas.case import CaseRecord
from app.schemas.patient import PatientRecord
from app.services.patient_service import fold


@dataclass
class BackfillReport:
    created: int = 0
    linked_cases: int = 0
    # (clinic_id, patient name, species, breeds seen) for groups left alone.
    ambiguous: list[tuple[str | None, str, str, list[str]]] = field(default_factory=list)


def _group_key(case: CaseRecord) -> tuple[str | None, str, str]:
    species = case.species.value if hasattr(case.species, "value") else str(case.species)
    return (case.clinic_id, fold(case.patient_name), species)


def backfill_patients(cases_repo, patient_store, *, dry_run: bool = False) -> BackfillReport:
    report = BackfillReport()
    groups: dict[tuple[str | None, str, str], list[CaseRecord]] = defaultdict(list)
    for case in cases_repo.list_cases():
        if case.patient_id or not fold(case.patient_name):
            continue
        groups[_group_key(case)].append(case)

    for (clinic_id, _name, species), cases in sorted(groups.items(), key=lambda kv: str(kv[0])):
        breeds = sorted({fold(c.breed) for c in cases if fold(c.breed)})
        if len(breeds) > 1:
            report.ambiguous.append((clinic_id, cases[0].patient_name, species, breeds))
            continue
        first = min(cases, key=lambda c: c.created_at)
        dicom_ids = list(
            dict.fromkeys(
                c.dicom_study.patient_id_synthetic.strip()
                for c in cases
                if c.dicom_study and c.dicom_study.patient_id_synthetic and c.dicom_study.patient_id_synthetic.strip()
            )
        )[-20:]
        patient = PatientRecord(
            clinic_id=clinic_id,
            owner_subject=first.owner_subject,
            name=" ".join(first.patient_name.split())[:120],
            species=first.species,
            breed=next((c.breed for c in cases if c.breed), None),
            dicom_patient_ids=dicom_ids,
            created_at=first.created_at,
        )
        report.created += 1
        report.linked_cases += len(cases)
        if dry_run:
            continue
        patient_store.save(patient)
        for case in cases:
            cases_repo.save_case(case.model_copy(update={"patient_id": patient.patient_id}))
    return report
