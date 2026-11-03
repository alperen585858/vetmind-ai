"""Run infrastructure readiness checks; no sample cases or invented clinical scores."""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0,str(ROOT))

from pydantic import ValidationError
from evaluation.contracts import EvaluationManifest
from evaluation.reports.readiness import assess

def main() -> int:
    parser=argparse.ArgumentParser(description="VetMind evaluation infrastructure readiness")
    parser.add_argument("--manifest",type=Path,help="Optional evaluation manifest JSON")
    parser.add_argument("--output",type=Path,help="Optional output JSON file")
    args=parser.parse_args()
    try:
        if args.manifest:
            data=json.loads(args.manifest.read_text(encoding="utf-8"))
            manifest=EvaluationManifest.model_validate(data)
        else:
            manifest=EvaluationManifest(evaluation_id="infrastructure",task="report",
                model_id="unassigned",model_version="unassigned")
        result=assess(manifest)
        payload=result.model_dump_json(indent=2)
        if args.output:
            args.output.parent.mkdir(parents=True,exist_ok=True)
            args.output.write_text(payload+"\n",encoding="utf-8")
        print(payload)
        return 0
    except (OSError,ValueError,ValidationError) as exc:
        print(f"Error: {exc}",file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
