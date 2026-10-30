#!/usr/bin/env python3
"""Load integration fixtures and print wire contract keys (no network)."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "fixtures" / "integration"


def main() -> None:
    for name in (
        "vision_request.example.json",
        "vision_response.example.json",
        "llm_request.example.json",
        "llm_response.example.json",
    ):
        path = FIX / name
        data = json.loads(path.read_text(encoding="utf-8"))
        print(f"\n== {name} ==")
        print("top-level keys:", sorted(data.keys()))
        if name.startswith("vision_response"):
            print("finding keys:", sorted((data.get("findings") or [{}])[0].keys()))
        if name.startswith("llm_response"):
            print("used_passage_ids:", data.get("used_passage_ids"))


if __name__ == "__main__":
    main()
