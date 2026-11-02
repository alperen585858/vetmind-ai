"""Optional score calibration artifacts (temperature scaling).

Calibration never invents scores. When no artifact is registered, callers must
leave ``calibrated=false`` and treat scores as raw model outputs.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence


@dataclass(frozen=True)
class CalibrationArtifact:
    model_id: str
    version: str
    method: str  # temperature | none
    temperature: float = 1.0
    label_names: tuple[str, ...] = ()

    def apply_temperature(self, logits: Sequence[float]) -> list[float]:
        """Apply T-scaling to logits then sigmoid. T must be > 0."""
        import math

        t = self.temperature if self.temperature > 0 else 1.0
        out: list[float] = []
        for z in logits:
            out.append(1.0 / (1.0 + math.exp(-float(z) / t)))
        return out


def load_calibration_artifact(path: str | Path | None) -> CalibrationArtifact | None:
    if not path:
        return None
    p = Path(path)
    if not p.is_file():
        return None
    raw = json.loads(p.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        return None
    return CalibrationArtifact(
        model_id=str(raw.get("model_id") or ""),
        version=str(raw.get("version") or ""),
        method=str(raw.get("method") or "temperature"),
        temperature=float(raw.get("temperature") or 1.0),
        label_names=tuple(str(x) for x in (raw.get("label_names") or [])),
    )
