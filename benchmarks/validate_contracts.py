"""Validate evaluation contracts offline without running a clinical benchmark.

Supports machine-readable JSON diagnostics and JSON Schema export. Inputs are
local JSON only. Never upload or print identifying patient case payloads.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pydantic import ValidationError
from evaluation.contracts import EvaluationManifest, EvaluationRecord
from evaluation.integrity import IntegrityPolicy, validate_inputs
from evaluation.reports.export import export_json


CONTRACTS = {"manifest": EvaluationManifest, "record": EvaluationRecord}


def _read_json(path: Path) -> object:
    with path.open("r", encoding="utf-8") as stream:
        return json.load(stream)


def _safe_error(error: Exception) -> str:
    """Never print a Pydantic ValidationError containing patient-supplied input."""
    if isinstance(error, ValidationError):
        return f"Contract rejected: {error.error_count()} validation error(s)"
    if isinstance(error, (OSError, ValueError, json.JSONDecodeError)):
        return "Invalid or unreadable input file"
    return "Input validation failed"


def run(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="VetMind offline Evaluation Core contract validation")
    parser.add_argument("--manifest", type=Path, help="Manifest JSON path")
    parser.add_argument("--records", type=Path,
                        help="JSON array of evaluation records; optional")
    parser.add_argument("--output", type=Path,
                        help="Write JSON diagnostics (default stdout)")
    parser.add_argument("--schema", choices=tuple(CONTRACTS),
                        help="Print the selected contract's JSON Schema")
    parser.add_argument("--require-cases", action="store_true")
    parser.add_argument("--require-complete-execution", action="store_true")
    parser.add_argument("--require-priority-scope", action="store_true")
    args = parser.parse_args(argv)
    if args.schema is not None:
        if args.manifest is not None or args.records is not None:
            parser.error("--schema cannot be combined with manifest/records")
        payload = CONTRACTS[args.schema].model_json_schema()
        _emit(payload, args.output)
        return 0
    if args.manifest is None:
        parser.error("--manifest required unless --schema is supplied")
    try:
        manifest = EvaluationManifest.model_validate(_read_json(args.manifest))
        incoming_records = [] if args.records is None else _read_json(args.records)
        if not isinstance(incoming_records, list):
            raise ValueError("records must be a list")
        if len(incoming_records) > 100_000:
            raise ValueError("records exceeds limit")
        records = [EvaluationRecord.model_validate(record) for record in incoming_records]
        policy = IntegrityPolicy(
            require_cases_for_batch=args.require_cases,
            require_complete_execution=args.require_complete_execution,
            require_kranium_neuro_scope=args.require_priority_scope,
        )
        report = validate_inputs(manifest, records, policy=policy)
    except (OSError, ValueError, TypeError, ValidationError, json.JSONDecodeError) as exc:
        print(_safe_error(exc), file=sys.stderr)
        return 2
    _emit(report.model_dump(mode="json"), args.output)
    return 1 if not report.valid else 0


def _emit(payload: dict, output: Path | None) -> None:
    if output is None:
        print(json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2))
    else:
        export_json(output, payload)
        print(f"Diagnostic JSON written: {output}")


if __name__ == "__main__":
    raise SystemExit(run())
