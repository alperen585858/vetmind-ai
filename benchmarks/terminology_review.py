"""Offline Clinical Terminology terminology review planning (never activates medical vocabulary).

Commands:
  python benchmarks/terminology_review.py plan
  python benchmarks/terminology_review.py plan --output artifacts/terminology_review_plan.json
  python benchmarks/terminology_review.py check --submission path/to/review_decisions.json

The command reads only the static repository corpus, never case/image data.
All output is metadata and controlled codes, not clinical narrative.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict
import json
import os
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from evaluation.clinical_terminology.catalog import TermCatalog  # noqa: E402
from evaluation.clinical_terminology.corpus_candidates import read_corpus, CorpusReviewQueue  # noqa: E402
from evaluation.clinical_terminology.review_decisions import (  # noqa: E402
    ReviewSubmission, validate_review_submission,
)
from evaluation.clinical_terminology.review_plan import build_review_plan  # noqa: E402

DEFAULT_SOURCE = ROOT / "backend/app/rag/corpus/breed_morphotypes.json"
DEFAULT_CATALOG = ROOT / "knowledge_base/terminology/cranial_catalog.json"
MAX_BYTES = 2_000_000


def read_json_file(path: Path, contract: type) -> object:
    if not path.is_file() or path.is_symlink():
        raise ValueError("missing_or_unsafe_file")
    if not 0 < path.stat().st_size <= MAX_BYTES:
        raise ValueError("file_size_invalid")
    return contract.model_validate_json(path.read_bytes())


def _write_once(path: Path, data: bytes) -> None:
    if path.exists() or path.is_symlink() or not path.parent.is_dir() or path.parent.is_symlink():
        raise ValueError("invalid_output_destination")
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", dir=path.parent, prefix=".term-review-", delete=False) as file:
            temp_path = Path(file.name)
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        os.link(temp_path, path)  # exclusive create; never overwrite existing file
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def make_report(
    *, mode: str, source: Path, catalog_file: Path,
    queue_file: Path | None = None, submission_file: Path | None = None,
) -> dict[str, object]:
    queue = read_corpus(source)
    if queue_file is not None:
        prior = read_json_file(queue_file, CorpusReviewQueue)
        if prior.source_sha256 != queue.source_sha256 or prior.candidates != queue.candidates:
            raise ValueError("stale_review_queue")
    catalog = read_json_file(catalog_file, TermCatalog)
    plan = build_review_plan(queue, catalog)
    if mode == "plan":
        return {**asdict(plan), "status": "pending_expert_review"}
    if mode != "check" or submission_file is None:
        raise ValueError("invalid_mode")
    review = read_json_file(submission_file, ReviewSubmission)
    summary = validate_review_submission(queue, review)
    return {**asdict(summary), "catalog_version": catalog.catalog_version,
            "source_sha256": queue.source_sha256}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="VetMind Clinical Terminology human-review workflow (NOT clinical approval)")
    parser.add_argument("command", choices=("plan", "check"))
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--queue", type=Path)
    parser.add_argument("--submission", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    if args.command == "check" and args.submission is None:
        parser.error("check requires --submission")
    try:
        result = make_report(
            mode=args.command, source=args.source, catalog_file=args.catalog,
            queue_file=args.queue, submission_file=args.submission,
        )
        payload = (json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
        if args.output:
            _write_once(args.output, payload)
            print(json.dumps({"status": "saved", "clinical_validation": "not_evaluated"}))
        else:
            sys.stdout.buffer.write(payload)
    except (OSError, TypeError, ValueError) as error:
        # Intentionally no exception text; source may be untrusted.
        print(json.dumps({"status": "error", "code": "invalid_input_or_output"}), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
