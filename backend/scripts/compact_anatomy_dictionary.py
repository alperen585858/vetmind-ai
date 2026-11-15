"""Export the fields needed by report generation from the editorial dictionary."""

import argparse
import json
from functools import partial
from pathlib import Path


METADATA_FIELDS = ("Schema_Version", "Count", "Ambiguous_Query_Candidates")
TERM_FIELDS = (
    "Term_ID", "English_Term", "Turkish_Term", "Definition_TR",
    "Aliases", "Search_Labels",
    "Category", "Species", "Uncertain",
)


def compact(source: dict) -> dict:
    metadata = {key: source["metadata"][key] for key in METADATA_FIELDS}
    terms = []
    for entry in source["terms"]:
        term = {key: entry[key] for key in TERM_FIELDS}
        term["Source_Locations"] = [
            {key: location[key] for key in ("pdf_page", "section")}
            for location in entry["Source_Locations"]
        ]
        term["External_Sources"] = [
            {"URL": reference["URL"]} for reference in entry["External_Sources"]
        ]
        terms.append(term)
    if len({term["Term_ID"] for term in terms}) != len(terms) or len(terms) != metadata["Count"]:
        raise ValueError("Dictionary count or term IDs are inconsistent.")
    return {"metadata": metadata, "terms": terms}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Path to the full editorial dictionary")
    parser.add_argument("output", type=Path, help="Path for the compact application dictionary")
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        parser.error("Choose a separate output path to preserve the editorial dictionary.")
    source = json.loads(args.source.read_text(encoding="utf-8-sig"))
    payload = compact(source)
    # One record per line keeps diffs reviewable without retaining indentation overhead.
    encode = partial(json.dumps, ensure_ascii=False, separators=(",", ":"))
    records = ",\n".join(encode(term) for term in payload["terms"])
    output = '{\n"metadata":' + encode(payload["metadata"]) + ',\n"terms":[\n' + records + '\n]\n}\n'
    args.output.write_bytes(output.encode("utf-8"))


if __name__ == "__main__":
    main()
