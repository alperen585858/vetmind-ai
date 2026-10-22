#!/usr/bin/env python3
"""Local mock remote Vision HTTP server for VetMind adapter demos.

Run:
  cd backend && source .venv/bin/activate
  python scripts/mock_vision_server.py
  # listens on http://127.0.0.1:8090/infer

Wire the main API:
  export VETMIND_VISION_ENDPOINT=http://127.0.0.1:8090/infer
  uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

from typing import Any

import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="VetMind Mock Vision Server", version="0.1.0")


class InferRequest(BaseModel):
    model_id: str | None = None
    case_id: str | None = None
    modality: str | None = None
    anatomical_region: str | None = None
    species: str | None = None
    clinical_history: str | None = None
    model_input: dict[str, Any] = Field(default_factory=dict)
    note: str | None = None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "mock-vision", "note": "Synthetic findings only."}


@app.post("/infer")
def infer(payload: InferRequest) -> dict[str, Any]:
    modality = (payload.modality or "MR").upper()
    region = (payload.anatomical_region or "BRAIN").upper()
    case_id = payload.case_id or "case-unknown"
    code = f"REMOTE-{modality}-{region}"
    return {
        "execution_status": "success",
        "source_kind": "real",
        "warnings": [
            "Mock remote Vision HTTP server — not a trained model.",
            "Pixels were not analyzed clinically.",
        ],
        "findings": [
            {
                "finding_id": f"{case_id}-remote-01",
                "finding_code": code,
                "description": (
                    f"REMOTE SYNTHETIC FINDING: {modality}/{region} stub from mock Vision server. "
                    "Replace this service with a real inference endpoint."
                ),
                "anatomical_location": f"{region.lower()} (remote stub)",
                "finding_status": "suspected",
                "uncertainty_note": "Remote mock confidence undefined.",
                "synthetic": True,
                "evidence_references": [
                    {
                        "evidence_id": f"{case_id}-remote-ev-01",
                        "description": "Remote stub evidence; quarantine paths may be listed in model_input.",
                        "series_hint": "remote-series",
                        "note": "Not pixel-grounded.",
                    }
                ],
            }
        ],
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8090, log_level="info")
