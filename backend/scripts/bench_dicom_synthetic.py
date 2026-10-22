#!/usr/bin/env python3
"""Bounded synthetic DICOM micro-benchmark (no PHI, no fabricated clinical claims).

Measures upload+ingest path latency and peak RSS for demo fixtures.
Results are printed as JSON for inclusion in Phase 5 docs when actually run.
"""

from __future__ import annotations

import json
import resource
import time
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.dicom.fixtures import brain_mri_study_files  # noqa: E402
from app.dicom.ingest import ingest_dicom_files  # noqa: E402
from app.storage.quarantine import QuarantineStore  # noqa: E402


def rss_mb() -> float:
    # macOS: ru_maxrss is bytes; Linux: kilobytes
    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if sys.platform == "darwin":
        return usage / (1024 * 1024)
    return usage / 1024


def main() -> None:
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / ".bench_tmp"
    out_dir.mkdir(parents=True, exist_ok=True)
    store = QuarantineStore(out_dir / "q")

    files = brain_mri_study_files(4)
    t0 = time.perf_counter()
    parse = ingest_dicom_files(files)
    t_parse = time.perf_counter() - t0

    t1 = time.perf_counter()
    store.store_files("dicom-bench01", files, content_kinds=["dicom"] * len(files))
    t_store = time.perf_counter() - t1

    # Case listing proxy: count stored refs (not full API).
    t2 = time.perf_counter()
    refs = store.list_files("dicom-bench01")
    t_list = time.perf_counter() - t2

    result = {
        "fixture": "brain_mri",
        "instances": len(files),
        "total_bytes": sum(len(b) for _, b in files),
        "parse_seconds": round(t_parse, 4),
        "quarantine_store_seconds": round(t_store, 4),
        "list_files_seconds": round(t_list, 4),
        "blocked": parse.blocked,
        "peak_rss_mb": round(rss_mb(), 2),
        "note": "Synthetic fixtures only. Not a production load test.",
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
