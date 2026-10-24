from app.llm.gateway import build_generation_input
from app.llm.prompts import build_aliases, build_user_prompt
from app.llm.privacy import redact_personal_data
from app.models.mock_vision import MockBrainMriModel
from app.schemas.case import CaseRecord, StructuredClinicalHistory
from app.schemas.enums import AnatomicalRegion, MockScenario, Modality, Species

HISTORY = (
    "Hasta sahibi: Mehmet Yılmaz (0532 123 45 67, mehmet.yilmaz@mail.com) TC 12345678901. "
    "Sahibi Ayşe Kaya Hanım aradı. Tel: +90 212 555 12 34. IBAN TR33 0006 1005 1978 6457 8413 26. "
    "Karamel 8 yaşında; 3 haftadır nöbet, L1-L2 ağrı, ALT 245 U/L, kilo 12.5 kg, "
    "fenobarbital 2.5 mg/kg 2x1, tarih 12.03.2026. Sahibi belirtti ki sola dönüyor. "
    "Pati Veteriner Kliniği'nden sevk."
)


def test_redacts_identifiers_and_keeps_clinical_numbers() -> None:
    r = redact_personal_data(
        HISTORY, known=[("Karamel", "[HASTA]"), ("Pati Veteriner Kliniği", "[KLİNİK]")]
    )
    for secret in ("Mehmet", "Yılmaz", "Ayşe", "0532", "mail.com", "12345678901", "555 12 34", "TR33", "Karamel", "Pati Veteriner"):
        assert secret not in r.text, secret
    for kept in ("3 haftadır", "L1-L2", "ALT 245 U/L", "12.5 kg", "2.5 mg/kg", "12.03.2026", "Sahibi belirtti ki", "(["):
        assert kept in r.text, kept
    assert r.counts == {
        "hasta": 1, "klinik": 1, "email": 1, "iban": 1, "tc_kimlik": 1, "phone": 2, "owner": 2,
    }


def test_short_or_empty_known_values_are_ignored() -> None:
    r = redact_personal_data("Bo kediyi getirdi.", known=[("Bo", "[HASTA]"), (None, "[KLİNİK]")])
    assert r.text == "Bo kediyi getirdi." and r.counts == {}
    assert redact_personal_data(None).text == ""


def test_generation_input_is_redacted_and_includes_structured_history() -> None:
    case = CaseRecord(
        case_id="c-priv",
        patient_name="Karamel",
        species=Species.FELINE,
        breed="British Shorthair",
        patient_age_years=8,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        scenario=MockScenario.BRAIN_MRI_SUSPECTED,
        clinical_history=HISTORY,
        clinical_history_structured=StructuredClinicalHistory(
            complaint="Karamel'de nöbet", medications="Fenobarbital", handoff_notes="Sahibi Ali Demir arar"
        ),
        referring_clinic="Pati Veteriner Kliniği",
    )
    gen = build_generation_input(case, MockBrainMriModel().analyze(case))
    assert "Karamel" not in gen.model_dump_json()
    assert "Şikâyet: [HASTA]'de nöbet" in gen.clinical_history
    assert "İlaçlar: Fenobarbital" in gen.clinical_history
    assert "Ali Demir" not in gen.clinical_history  # handoff notes are internal, never sent
    assert gen.redaction_counts["phone"] == 2

    user = build_user_prompt(gen, build_aliases(gen))
    assert "breed: British Shorthair, age: 8 years" in user
    assert "redacted personal data" in user
