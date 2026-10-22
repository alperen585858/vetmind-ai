"""Mock-scenario routing overrides.

Production ModelRouter never reads MockScenario. Synthetic demo/test scenarios that
need non-capability routing (unsupported force, multi-model conflict demo) are applied
here after the capability-based decision.
"""

from app.routing.model_router import MANUAL_REVIEW_MODEL, RouteDecision
from app.schemas.case import CaseRecord
from app.schemas.enums import MockScenario

# Demo-only secondary adapter id (must exist in the injected model registry).
CONFLICT_DEMO_EXTRA_MODEL_IDS: tuple[str, ...] = ("mock-brain-mri-alt-v1",)


class ScenarioRoutingPolicy:
    """Adjusts a capability-based RouteDecision for synthetic MockScenario values only."""

    def apply(self, case: CaseRecord, decision: RouteDecision) -> RouteDecision:
        if case.scenario is None:
            return decision

        if case.scenario == MockScenario.UNSUPPORTED:
            return RouteDecision(
                supported=False,
                model_ids=[MANUAL_REVIEW_MODEL],
                reason="Mock scenario=unsupported forced manual review (not a capability miss).",
                rule_id="scenario.unsupported",
            )

        if case.scenario == MockScenario.CONFLICTING:
            base = decision.model_ids if decision.supported and decision.model_ids else ["mock-brain-mri-v1"]
            model_ids = list(dict.fromkeys([*base, *CONFLICT_DEMO_EXTRA_MODEL_IDS]))
            return RouteDecision(
                supported=True,
                model_ids=model_ids,
                reason=(
                    "Mock scenario=conflicting expanded routing to multiple brain adapters "
                    "for conflict-preservation demos."
                ),
                rule_id="scenario.conflicting",
            )

        # NO_FINDINGS / MODEL_FAILURE / *_SUSPECTED: adapters interpret scenario; router unchanged.
        return decision
