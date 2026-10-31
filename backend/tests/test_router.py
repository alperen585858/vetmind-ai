from app.routing.capabilities import ModelCapability
from app.routing.model_router import ModelRouter
from app.routing.scenario_policy import ScenarioRoutingPolicy
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, MockScenario, Modality, Species


def _case(**kwargs) -> CaseRecord:
    base = dict(
        case_id="case-1",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
    )
    base.update(kwargs)
    return CaseRecord(**base)


def test_routes_brain_mr_to_mock_brain() -> None:
    decision = ModelRouter().route(_case())
    assert decision.supported is True
    assert decision.model_ids == ["mock-brain-mri-v1"]
    assert "mock-brain-mri-alt-v1" not in decision.model_ids


def test_routes_cervical_mr_to_mock_cervical() -> None:
    decision = ModelRouter().route(_case(anatomical_region=AnatomicalRegion.CERVICAL))
    assert decision.model_ids == ["mock-cervical-mri-v1"]


def test_ct_brain_routes_to_mock_ct() -> None:
    decision = ModelRouter().route(_case(modality=Modality.CT, anatomical_region=AnatomicalRegion.BRAIN))
    assert decision.supported is True
    assert decision.model_ids == ["mock-ct-3d-v1"]


def test_xr_thorax_routes_to_mock_xr() -> None:
    decision = ModelRouter().route(
        _case(modality=Modality.XR, anatomical_region=AnatomicalRegion.THORAX)
    )
    assert decision.supported is True
    assert decision.model_ids == ["mock-xr-vision-v1"]


def test_xr_cr_style_unknown_region_routes_to_mock_xr() -> None:
    """SendToPACS CR/DX often lacks thorax tags; CR maps to XR and must still route."""
    for region in (AnatomicalRegion.UNKNOWN, AnatomicalRegion.OTHER):
        decision = ModelRouter().route(_case(modality=Modality.XR, anatomical_region=region))
        assert decision.supported is True, region
        assert decision.model_ids == ["mock-xr-vision-v1"]


def test_router_ignores_mock_scenario() -> None:
    """Production router must not branch on MockScenario."""
    decision = ModelRouter().route(_case(scenario=MockScenario.CONFLICTING))
    assert decision.model_ids == ["mock-brain-mri-v1"]
    assert decision.rule_id and decision.rule_id.startswith("capability.")


def test_scenario_policy_expands_conflicting_outside_router() -> None:
    base = ModelRouter().route(_case(scenario=MockScenario.CONFLICTING))
    adjusted = ScenarioRoutingPolicy().apply(_case(scenario=MockScenario.CONFLICTING), base)
    assert adjusted.model_ids == ["mock-brain-mri-v1", "mock-brain-mri-alt-v1"]
    assert adjusted.rule_id == "scenario.conflicting"


def test_capabilities_can_be_replaced_without_rewriting_router() -> None:
    router = ModelRouter()
    router.replace_capabilities(
        [
            ModelCapability(
                model_id="future-ct-brain-v1",
                modalities=frozenset({Modality.CT}),
                regions=frozenset({AnatomicalRegion.BRAIN}),
                species=None,
                priority=5,
                description="placeholder real model",
            )
        ]
    )
    decision = router.route(_case(modality=Modality.CT))
    assert decision.model_ids == ["future-ct-brain-v1"]
    still_unsupported = router.route(_case(modality=Modality.MR, anatomical_region=AnatomicalRegion.CERVICAL))
    assert still_unsupported.supported is False


def test_species_filter_excludes_other() -> None:
    decision = ModelRouter().route(_case(species=Species.OTHER))
    assert decision.supported is False
    assert decision.model_ids == ["manual-review"]
