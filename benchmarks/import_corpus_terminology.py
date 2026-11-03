"""VetMind Corpus Intake static-corpus candidate extraction; clinical review REQUIRED.

Run from repository root:
  python benchmarks/import_corpus_terminology.py --dry-run
  python benchmarks/import_corpus_terminology.py

Produces a REVIEW QUEUE and optional DRAFT PENDING catalog. It never updates
cranial_catalog.json and never marks any entry expert-reviewed.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import tempfile

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from evaluation.clinical_terminology.corpus_candidates import (  # noqa: E402
    read_corpus, pending_catalog,
)

DEFAULT_SOURCE = Path("backend/app/rag/corpus/breed_morphotypes.json")
DEFAULT_REVIEW_OUT = Path("knowledge_base/terminology/cranial_review_queue.json")
DEFAULT_DRAFT_OUT = Path("knowledge_base/terminology/cranial_catalog.pending.json")
PROTECTED_CATALOG = Path("knowledge_base/terminology/cranial_catalog.json")


class OutputExistsError(ValueError):
    pass


def _safe_destinations(*, source: Path, review: Path, draft: Path) -> None:
    paths = (source.resolve(), review.resolve(), draft.resolve())
    if len(set(paths)) != 3:
        raise ValueError("source/output path collision")
    if review.resolve() == (_ROOT / PROTECTED_CATALOG).resolve():
        raise ValueError("active catalog must not be overwritten")
    if draft.resolve() == (_ROOT / PROTECTED_CATALOG).resolve():
        raise ValueError("active catalog must not be overwritten")
    for target in (review, draft):
        if target.exists() or target.is_symlink():
            raise OutputExistsError("target already exists")
        if not target.parent.is_dir() or target.parent.is_symlink():
            raise ValueError("output parent must exist and not be a symlink")


def _atomic_new_file(path: Path, payload: bytes) -> None:
    """Exclusive create: never silently replace existing or concurrent output."""
    fd: int | None = None
    temp_path: Path | None = None
    try:
        fd, name = tempfile.mkstemp(prefix=".vetmind-terminology-", dir=path.parent)
        temp_path = Path(name)
        with os.fdopen(fd, "wb") as handle:
            fd = None
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        # Link is an atomic, no-overwrite create on the same filesystem.
        os.link(temp_path, path)
    finally:
        if fd is not None:
            os.close(fd)
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def import_corpus(source: Path, review_output: Path, draft_output: Path, *, dry_run: bool) -> dict[str, object]:
    queue = read_corpus(source)
    draft = pending_catalog(queue)
    if not dry_run:
        _safe_destinations(source=source, review=review_output, draft=draft_output)
        queue_payload = (queue.model_dump_json(indent=2) + "\n").encode("utf-8")
        draft_payload = (draft.model_dump_json(indent=2) + "\n").encode("utf-8")
        _atomic_new_file(review_output, queue_payload)
        try:
            _atomic_new_file(draft_output, draft_payload)
        except (OSError, ValueError):
            review_output.unlink(missing_ok=True)
            raise
    return {
        "status": "dry_run" if dry_run else "pending_review_exported",
        "source_sha256": queue.source_sha256,
        "candidate_counts": queue.counts,
        "pending_catalog_entries": len(draft.terms),
        "expert_reviewed_entries": 0,
        "clinical_validation": "not_evaluated",
        "clinical_metrics": None,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Extract source terms for human review (NOT clinical validation)")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--review-output", type=Path, default=DEFAULT_REVIEW_OUT)
    parser.add_argument("--draft-output", type=Path, default=DEFAULT_DRAFT_OUT)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    try:
        result = import_corpus(args.source, args.review_output, args.draft_output, dry_run=args.dry_run)
    except (OSError, ValueError, TypeError) as exc:
        code = "output_exists" if isinstance(exc, OutputExistsError) or isinstance(exc, FileExistsError) else "invalid_source_or_destination"
        print(json.dumps({"status": "error", "code": code}), file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
