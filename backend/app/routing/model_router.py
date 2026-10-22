from dataclasses import dataclass

from app.routing.capabilities import ModelCapability, default_capabilities
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, Modality, Species

MANUAL_REVIEW_MODEL = "manual-review"


@dataclass(frozen=True)
class RouteDecision:
    supported: bool
    model_ids: list[str]
    reason: str
    rule_id: str | None = None
    matched_capabilities: tuple[str, ...] = ()


class ModelRouter:
    """Capability-based router. No LLM. No MockScenario. No concrete adapter imports.

    Matches case modality, anatomical region, and species against ModelCapability entries.
    """

    def __init__(self, capabilities: list[ModelCapability] | None = None) -> None:
        self._capabilities = list(capabilities if capabilities is not None else default_capabilities())

    def replace_capabilities(self, capabilities: list[ModelCapability]) -> None:
        self._capabilities = list(capabilities)

    def list_capabilities(self) -> list[ModelCapability]:
        return list(self._capabilities)

    def route(self, case: CaseRecord) -> RouteDecision:
        matches = [cap for cap in self._capabilities if self._matches(cap, case)]
        matches.sort(key=lambda c: (c.priority, c.model_id))

        if not matches:
            return RouteDecision(
                supported=False,
                model_ids=[MANUAL_REVIEW_MODEL],
                reason=(
                    f"No enabled model capability for "
                    f"{case.modality.value} + {case.anatomical_region.value} + {case.species.value}. "
                    "Routed to manual review."
                ),
                rule_id="fallback.manual_review",
            )

        model_ids = list(dict.fromkeys(c.model_id for c in matches))
        return RouteDecision(
            supported=True,
            model_ids=model_ids,
            reason=(
                f"Matched {len(model_ids)} model(s) for "
                f"{case.modality.value} + {case.anatomical_region.value} + {case.species.value}."
            ),
            rule_id=f"capability.{case.modality.value}.{case.anatomical_region.value}",
            matched_capabilities=tuple(c.model_id for c in matches),
        )

    @staticmethod
    def _matches(cap: ModelCapability, case: CaseRecord) -> bool:
        if not cap.enabled:
            return False
        if case.modality not in cap.modalities:
            return False
        if case.anatomical_region not in cap.regions:
            return False
        if cap.species is not None and case.species not in cap.species:
            return False
        return True


# Backward-compatible alias used by older tests/docs naming.
def RouteRule(*, modality: Modality, region: AnatomicalRegion, model_ids: tuple[str, ...], description: str = "") -> ModelCapability:
    """Deprecated helper: builds a ModelCapability from the old RouteRule shape."""
    return ModelCapability(
        model_id=model_ids[0],
        modalities=frozenset({modality}),
        regions=frozenset({region}),
        species=None,
        priority=10,
        description=description or f"{modality.value}+{region.value}",
    )
