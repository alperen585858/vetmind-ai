"""Report language: actor's saved choice → case owner's saved choice → deployment default."""

from app.auth.principal import AuthPrincipal
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, Modality, Species
from app.schemas.user_settings import UserSettingsUpdate
from app.services.case_service import CaseService
from app.services.repository import InMemoryCaseRepository
from app.services.user_settings_store import InMemoryUserSettingsStore


class _Orch:
    validator = None


def _service(store, default: str) -> CaseService:
    return CaseService(
        InMemoryCaseRepository(), orchestrator=_Orch(), user_settings=store, default_report_language=default  # type: ignore[arg-type]
    )


CASE = CaseRecord(
    case_id="c", patient_name="P", species=Species.CANINE, modality=Modality.MR,
    anatomical_region=AnatomicalRegion.BRAIN, owner_subject="vet@x",
)
EXPERT = AuthPrincipal(subject="expert@x", role="expert", via="jwt")


def test_unsaved_users_fall_back_to_deployment_default() -> None:
    assert _service(InMemoryUserSettingsStore(), "en")._resolve_report_language(CASE, principal=EXPERT) == "en"


def test_case_owner_choice_used_when_actor_never_saved_settings() -> None:
    store = InMemoryUserSettingsStore()
    store.update("vet@x", UserSettingsUpdate(language="en"))
    assert _service(store, "tr")._resolve_report_language(CASE, principal=EXPERT) == "en"


def test_actor_choice_wins() -> None:
    store = InMemoryUserSettingsStore()
    store.update("vet@x", UserSettingsUpdate(language="en"))
    store.update("expert@x", UserSettingsUpdate(language="tr"))
    assert _service(store, "en")._resolve_report_language(CASE, principal=EXPERT) == "tr"


def test_settings_api_does_not_invent_a_language(tmp_path) -> None:
    from tests.test_phase6_e2e_journey import _auth_client, _hdr, _token

    c = _auth_client(tmp_path)
    token = _token(c, "expert@demo.local")
    assert c.get("/api/v1/settings/me", headers=_hdr(token)).json()["language"] is None
    assert c.put("/api/v1/settings/me", json={"language": "en"}, headers=_hdr(token)).json()["language"] == "en"
    assert c.get("/api/v1/settings/me", headers=_hdr(token)).json()["language"] == "en"
