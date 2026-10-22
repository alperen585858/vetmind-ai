"""Model execution policy: exclusive real vs explicit mixed real/mock.

Capability routing stays unchanged. This policy filters a RouteDecision so that
configuring a remote (REAL) adapter never silently co-runs overlapping mocks.
"""

from __future__ import annotations

from enum import Enum

from app.routing.capabilities import ModelCapability
from app.routing.model_router import RouteDecision
from app.schemas.enums import SourceKind


class VisionExecutionMode(str, Enum):
    """How overlapping REAL and MOCK capability matches are executed."""

    EXCLUSIVE_REAL = "exclusive_real"
    MIXED = "mixed"


def parse_vision_execution_mode(raw: str | None) -> VisionExecutionMode:
    text = (raw or VisionExecutionMode.EXCLUSIVE_REAL.value).strip().lower()
    if text in {"mixed", "allow_mixed", "real_and_mock"}:
        return VisionExecutionMode.MIXED
    return VisionExecutionMode.EXCLUSIVE_REAL


class ModelExecutionPolicy:
    """Filters routed model_ids according to REAL/MOCK provenance of capabilities."""

    def __init__(
        self,
        *,
        mode: VisionExecutionMode = VisionExecutionMode.EXCLUSIVE_REAL,
        capabilities: list[ModelCapability] | None = None,
    ) -> None:
        self._mode = mode
        self._capabilities = list(capabilities or [])

    @property
    def mode(self) -> VisionExecutionMode:
        return self._mode

    def replace_capabilities(self, capabilities: list[ModelCapability]) -> None:
        self._capabilities = list(capabilities)

    def apply(self, decision: RouteDecision) -> RouteDecision:
        if not decision.supported or not decision.model_ids:
            return decision

        by_id = {c.model_id: c for c in self._capabilities}
        real_ids: list[str] = []
        mock_ids: list[str] = []
        unknown_ids: list[str] = []
        for mid in decision.model_ids:
            cap = by_id.get(mid)
            if cap is None:
                unknown_ids.append(mid)
                continue
            if cap.source_kind == SourceKind.REAL:
                real_ids.append(mid)
            else:
                mock_ids.append(mid)

        if self._mode == VisionExecutionMode.MIXED or not real_ids:
            return decision

        # Exclusive real: when any REAL capability matched, drop MOCK overlaps.
        filtered = list(dict.fromkeys([*real_ids, *unknown_ids]))
        dropped = [m for m in mock_ids if m not in filtered]
        reason = decision.reason
        if dropped:
            reason = (
                f"{decision.reason} Execution policy=exclusive_real retained "
                f"real model(s) {real_ids} and excluded overlapping mock(s) {dropped}."
            )
        return RouteDecision(
            supported=True,
            model_ids=filtered,
            reason=reason,
            rule_id=decision.rule_id,
            matched_capabilities=tuple(filtered),
        )
