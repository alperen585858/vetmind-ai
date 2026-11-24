"""LLM output schemas are generated from the Pydantic parsing models (structured_output.py)."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.llm.json_schema import strict_llm_schema
from app.llm.structured_output import (
    DIFFERENTIALS_JSON_SCHEMA,
    REPORT_JSON_SCHEMA,
    parse_differentials_payload,
    parse_report_payload,
    report_json_schema,
)

# The hand-written schema the providers received before it was generated. Pinned here
# so a model change that alters what the LLM is asked for is a deliberate, visible diff.
DIFFERENTIAL_ITEM = {
    "type": "object",
    "additionalProperties": False,
    "required": ["name", "likelihood", "supporting", "against", "citations"],
    "properties": {
        "name": {"type": "string"},
        "likelihood": {"type": "string", "enum": ["high", "moderate", "low"]},
        "supporting": {"type": "array", "items": {"type": "string"}},
        "against": {"type": "array", "items": {"type": "string"}},
        "citations": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Markers such as F1 or S2 that support this differential.",
        },
    },
}
DIFFERENTIALS_FIELD = {
    "type": "array",
    "description": "2-5 ranked differential diagnoses; empty when there are no findings.",
    "items": DIFFERENTIAL_ITEM,
}
EXPECTED_REPORT = {
    "type": "object",
    "additionalProperties": False,
    "required": ["technique", "findings", "impression", "recommendations", "differentials"],
    "properties": {
        "technique": {"type": "string", "description": "Species, modality, region, analysis status."},
        "findings": {"type": "string", "description": "One line per imaging finding, each cited [F#]."},
        "impression": {"type": "string", "description": "Ranked interpretation and differentials, cited."},
        "recommendations": {"type": "string", "description": "Next steps; ends with radiologist review."},
        "differentials": DIFFERENTIALS_FIELD,
    },
}


def test_report_schema_matches_the_contract():
    assert REPORT_JSON_SCHEMA == EXPECTED_REPORT
    assert list(REPORT_JSON_SCHEMA["required"]) == list(REPORT_JSON_SCHEMA["properties"])


def test_differentials_schema_matches_the_contract():
    assert DIFFERENTIALS_JSON_SCHEMA == {
        "type": "object",
        "additionalProperties": False,
        "required": ["differentials"],
        "properties": {"differentials": DIFFERENTIALS_FIELD},
    }


def test_text_only_schema_drops_differentials():
    schema = report_json_schema(with_differentials=False)
    assert "differentials" not in schema["properties"]
    assert schema["required"] == ["technique", "findings", "impression", "recommendations"]


def test_schema_is_self_contained_for_providers():
    text = str(REPORT_JSON_SCHEMA)
    for key in ("$ref", "$defs", "'title'", "'default'"):
        assert key not in text


def test_parser_stays_lenient_while_schema_is_strict():
    # Missing fields and synonyms are repaired by the parser, even though the schema requires them.
    wire = parse_report_payload({"findings": "Disk ekstrüzyonu [F1].", "differentials": [
        {"name": "IVDD", "likelihood": "yüksek", "citations": "F1"},
        {"name": "", "likelihood": "low"},  # dropped, not fatal
    ]})
    assert wire.technique == ""
    assert [(d.name, d.likelihood, d.citations) for d in wire.differentials] == [("IVDD", "high", ["F1"])]
    assert [d.name for d in parse_differentials_payload('{"differentials": [{"name": "FKE"}]}')] == ["FKE"]


def test_strict_llm_schema_inlines_nested_models():
    class Inner(BaseModel):
        value: int = 0

    class Outer(BaseModel):
        """Docstrings become a top-level description."""

        inner: Inner = Field(default_factory=Inner)
        items: list[Inner] = Field(default_factory=list)

    schema = strict_llm_schema(Outer)
    assert schema["required"] == ["inner", "items"] and schema["additionalProperties"] is False
    assert schema["properties"]["inner"]["required"] == ["value"]
    assert schema["properties"]["items"]["items"]["properties"]["value"] == {"type": "integer"}
