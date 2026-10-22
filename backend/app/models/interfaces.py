from typing import Protocol, runtime_checkable

from app.schemas.case import CaseRecord
from app.schemas.findings import StructuredFindings


class ImagingAdapterError(RuntimeError):
    """Shared failure type for imaging adapters (mock or real).

    Orchestrator catches this type. Adapters must not require MockVisionError in callers.
    """


@runtime_checkable
class ImagingModel(Protocol):
    """Replaceable imaging adapter. Real Vision AI / VLM implementations use this contract.

    Adapters should read ``case.model_input`` (ImagingModelInput) when present — that is the
    AI-facing study package. Do not parse arbitrary uploaded folders inside adapters.
    """

    model_id: str
    version: str

    def analyze(self, case: CaseRecord) -> StructuredFindings:
        """Return structured findings. Must not mutate the case record.

        Raise ImagingAdapterError (or a subclass) for deterministic/expected adapter failures.
        Prefer ``case.model_input`` for modality/series/frame references.
        """
        ...
