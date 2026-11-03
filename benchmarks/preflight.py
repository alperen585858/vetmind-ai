"""Privacy-conservative offline contract preflight CLI (no clinical scoring).

No DICOM ingestion, report text processing, network calls or database writes.
Never echo raw Pydantic validation errors: these can include patient values.
Input file names are intentionally excluded from error messages/output JSON.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from evaluation.configuration import EvaluationConfiguration
from evaluation.contracts import EvaluationManifest, EvaluationRecord
from evaluation.preflight import run_preflight
from evaluation.reports.export import export_json

MAX_INPUT_BYTES = 8 * 1024 * 1024
MAX_RECORDS = 100_000
MAX_JSON_DEPTH = 30


class InputRejected(Exception):
    """Payload failure with intentionally generic, non-identifying message."""


def _strict_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for name, value in pairs:
        if name in result:
            raise InputRejected("Duplicate JSON keys are not supported")
        result[name] = value
    return result


def _reject_constant(value: str) -> None:
    raise InputRejected("Nonfinite numeric constants are not supported")


def _check_depth(value: Any, *, depth: int = 0) -> None:
    if depth > MAX_JSON_DEPTH:
        raise InputRejected("JSON nesting limit exceeded")
    if isinstance(value, dict):
        if len(value) > 1024:
            raise InputRejected("Too many JSON object members")
        for member in value.values():
            _check_depth(member, depth=depth+1)
    elif isinstance(value, list):
        if len(value) > MAX_RECORDS:
            raise InputRejected("JSON list limit exceeded")
        for member in value:
            _check_depth(member, depth=depth+1)


def _load_bounded_json(path: Path) -> Any:
    try:
        if path.stat().st_size > MAX_INPUT_BYTES:
            raise InputRejected("Input exceeds byte limit")
        # Read at most one byte beyond limit to avoid races where files grow.
        with path.open("rb") as stream:
            data = stream.read(MAX_INPUT_BYTES + 1)
        if len(data) > MAX_INPUT_BYTES:
            raise InputRejected("Input exceeds byte limit")
        parsed = json.loads(
            data.decode("utf-8-sig"), object_pairs_hook=_strict_pairs,
            parse_constant=_reject_constant,
        )
        _check_depth(parsed)
        return parsed
    except (OSError, UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise InputRejected("Input JSON is not readable or valid") from exc


def _parse(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="VetMind Evaluation Core structural preflight (no clinical scoring)")
    parser.add_argument("--manifest", type=Path, help="Optional contract manifest JSON")
    parser.add_argument("--records", type=Path, help="Optional array of structural records")
    parser.add_argument("--config", type=Path, help="Optional strict run configuration JSON")
    parser.add_argument("--output", type=Path, help="Optional PHI-free report destination")
    parser.add_argument("--check-backend", action="store_true", help="Check local backend schemas")
    return parser.parse_args(argv)


def run(argv: list[str] | None = None) -> int:
    args = _parse(argv)
    try:
        configuration_payload = _load_bounded_json(args.config) if args.config else {}
        if not isinstance(configuration_payload, dict):
            raise InputRejected("Configuration must be an object")
        if args.check_backend:
            # Explicit CLI request overrides only this non-clinical switch.
            configuration_payload["check_backend_contracts"] = True
        config = EvaluationConfiguration.model_validate(configuration_payload)
        if config.check_backend_contracts:
            # Standalone CLI entrypoints put the repository root on sys.path,
            # but not the adjacent backend/app package. Add that local path
            # explicitly; this does not edit or initialize backend services.
            backend = ROOT / "backend"
            if backend.is_dir() and str(backend) not in sys.path:
                sys.path.insert(0, str(backend))
        raw_manifest = (_load_bounded_json(args.manifest) if args.manifest else {
            "evaluation_id": "infrastructure", "task": "report",
            "model_id": "unassigned", "model_version": "unassigned",
        })
        manifest = EvaluationManifest.model_validate(raw_manifest)
        raw_records = _load_bounded_json(args.records) if args.records else []
        if not isinstance(raw_records, list):
            raise InputRejected("Records input must be an array")
        if len(raw_records) > min(config.max_records, MAX_RECORDS):
            raise InputRejected("Record limit exceeded")
        records = [EvaluationRecord.model_validate(item) for item in raw_records]
        report = run_preflight(manifest, records, config=config)
        payload = report.model_dump(mode="json")
        if args.output is not None:
            export_json(args.output, payload)
            print("Preflight report written", file=sys.stdout)
        else:
            print(json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2))
        return 2 if report.structural_status == "blocked" else 0
    except (InputRejected, OSError, ValueError, TypeError, RecursionError):
        # Deliberately do not echo filenames, field values, or Pydantic input.
        print("Preflight input rejected; check local schema/configuration", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(run())
