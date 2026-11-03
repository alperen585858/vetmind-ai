"""Offline, aggregate-only metrics runner. No images or sample cases are bundled."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pydantic import ValidationError
from evaluation.clinical_metrics.classification import assess_binary_observations, assess_count_summary
from evaluation.clinical_metrics.contracts import (
    ClassificationInput, CountEvaluationInput, LocalizationInput,
)
from evaluation.clinical_metrics.localization import assess_localization
from evaluation.reports.export import export_json

MAX_INPUT_BYTES = 8 * 1024 * 1024


def _load(path: Path) -> dict[str, object]:
    if not path.is_file() or path.stat().st_size > MAX_INPUT_BYTES:
        raise ValueError("file_missing_or_size_limit")
    with path.open("r", encoding="utf-8") as stream:
        obj = json.load(stream)
    if not isinstance(obj, dict):
        raise ValueError("top_level_object_required")
    return obj


def _readiness() -> dict[str, object]:
    return {
        "assessment_status": "not_evaluated", "clinical_validation": "not_evaluated",
        "clinical_metrics": None,
        "blockers": ["expert_reference_unavailable", "real_model_output_unavailable"],
        "note": "Evaluation requires explicitly reviewed source data and a complete opportunity universe.",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Offline expert-reference metric evaluation")
    parser.add_argument("--kind", choices=("readiness", "observations", "counts", "localization"), default="readiness")
    parser.add_argument("--input", type=Path, help="Local JSON contract; not required for readiness")
    parser.add_argument("--output", type=Path, help="Aggregate JSON output (never contains unit IDs)")
    args = parser.parse_args(argv)
    try:
        if args.kind == "readiness":
            if args.input is not None:
                raise ValueError("readiness_does_not_accept_input")
            result = _readiness()
        else:
            if args.input is None:
                raise ValueError("input_required")
            raw = _load(args.input)
            if args.kind == "observations":
                data = ClassificationInput.model_validate(raw)
                report = assess_binary_observations(data.scope, data.observations)
            elif args.kind == "counts":
                data = CountEvaluationInput.model_validate(raw)
                report = assess_count_summary(data.scope, data.counts)
            else:
                data = LocalizationInput.model_validate(raw)
                report = assess_localization(data.scope, data.pairs, iou_threshold=data.iou_threshold)
            result = report.model_dump(mode="json")
        if args.output is not None:
            export_json(args.output, result)
            print("Aggregate evaluation report written")
        else:
            print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
        return 0
    except (ValidationError, ValueError, OSError, json.JSONDecodeError, ImportError):
        # No raw schema errors, file contents or potentially identifying values.
        print("Evaluation failed: invalid, unavailable, or incompatible input.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
