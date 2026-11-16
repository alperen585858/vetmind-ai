"""Every AnatomicalRegion needs a label wherever regions are shown or spelled out (#49).

Several of these maps are read with ``REGION_TR[region]`` (no default), so a new region
missing from one of them crashes classification / report rendering at runtime.
"""

from __future__ import annotations

from app.dicom.classifier import REGION_TR
from app.llm.mock_provider import _REGION as MOCK_REPORT_REGION
from app.models.mock_vision import _REGION_TR as MOCK_VISION_REGION
from app.schemas.enums import AnatomicalRegion
from app.services.pdf_report import _REGION_UI

ALL = set(AnatomicalRegion)
ALL_VALUES = {r.value for r in AnatomicalRegion}


def test_thoracolumbar_region_exists() -> None:
    assert AnatomicalRegion("THORACOLUMBAR") is AnatomicalRegion.THORACOLUMBAR


def test_every_region_has_a_label_in_each_map() -> None:
    assert set(REGION_TR) == ALL
    assert set(_REGION_UI) == ALL
    assert set(MOCK_REPORT_REGION["tr"]) == ALL_VALUES
    assert set(MOCK_REPORT_REGION["en"]) == ALL_VALUES
    assert set(MOCK_VISION_REGION) == ALL_VALUES


def test_thoracolumbar_labels() -> None:
    assert REGION_TR[AnatomicalRegion.THORACOLUMBAR] == "torakolomber"
    assert _REGION_UI[AnatomicalRegion.THORACOLUMBAR] == "Torakolomber"
    assert MOCK_REPORT_REGION["en"]["THORACOLUMBAR"] == "thoracolumbar spine"
