"""Structural audit for a versioned VetMind Clinical Terminology terminology catalog.

Usage (from the repository root):
    python benchmarks/check_terminology.py --catalog knowledge_base/terminology/cranial_catalog.json
    python benchmarks/check_terminology.py --schema

Never prints clinical source text or raw parser exceptions.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Works as a script from the repository root, consistently with Evaluation Core CLI tools.
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from evaluation.clinical_terminology.catalog import TermCatalog  # noqa: E402

MAX_CATALOG_BYTES = 2_000_000


def inspect_catalog(path: Path) -> dict[str, object]:
    if not path.is_file():
        raise FileNotFoundError("catalog not found")
    if path.stat().st_size > MAX_CATALOG_BYTES:
        raise ValueError("catalog exceeds allowed size")
    # Strict parsing and version validation is owned by Pydantic contracts.
    catalog = TermCatalog.model_validate_json(path.read_bytes())
    return {
        "status": "empty_catalog" if not catalog.terms else "schema_valid",
        "catalog_id": catalog.catalog_id,
        "catalog_version": catalog.catalog_version,
        "entry_count": len(catalog.terms),
        "expert_reviewed_entries": catalog.reviewed_count,
        "pending_entries": len(catalog.terms) - catalog.reviewed_count,
        "clinical_validation": "not_evaluated",
        "clinical_metrics": None,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Audit the Clinical Terminology terminology catalog")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--catalog", type=Path)
    source.add_argument("--schema", action="store_true")
    args = parser.parse_args(argv)
    if args.schema:
        result: dict[str, object] = TermCatalog.model_json_schema()
    else:
        try:
            result = inspect_catalog(args.catalog)
        except (ValueError, OSError) as error:
            # Never echo potentially sensitive source text via Pydantic exceptions.
            code = "not_found" if isinstance(error, FileNotFoundError) else "invalid_catalog"
            print(json.dumps({"status": "error", "code": code}), file=sys.stderr)
            return 2
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
