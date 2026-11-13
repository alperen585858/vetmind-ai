"""The case repository is shared by FastAPI's threadpool (one sqlite connection).

The radiologist workspace fires several API calls at once; without a lock, parallel
reads on the shared connection raised ``sqlite3.InterfaceError: bad parameter or other
API misuse`` and /dicom/files returned 500 (viewer stuck on "Seri yükleniyor…").
Found by the Playwright annotation test (issue #36).
"""

from __future__ import annotations

import threading
from pathlib import Path

from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, Modality, Species
from app.services.sqlite_repository import SqliteCaseRepository


def test_parallel_reads_and_writes_do_not_break_the_shared_connection(tmp_path: Path) -> None:
    repo = SqliteCaseRepository(tmp_path / "cases.sqlite3")
    ids = []
    for i in range(5):
        case = CaseRecord(
            case_id=f"case-{i}",
            patient_name=f"Pax {i}",
            species=Species.CANINE,
            modality=Modality.MR,
            anatomical_region=AnatomicalRegion.BRAIN,
            clinical_history="x" * 2000,
        )
        repo.save_case(case)
        ids.append(case.case_id)

    errors: list[BaseException] = []
    start = threading.Barrier(12)

    def worker(n: int) -> None:
        try:
            start.wait()
            for j in range(150):
                cid = ids[(n + j) % len(ids)]
                case = repo.get_case(cid)
                assert case is not None
                if j % 10 == 0:
                    repo.save_case(case)
                if j % 25 == 0:
                    assert len(repo.list_cases()) == len(ids)
        except BaseException as exc:  # noqa: BLE001 - collect for the assertion below
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(n,)) for n in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    repo.close()
    assert errors == [], f"{len(errors)} thread(s) failed, first: {errors[0]!r}"
