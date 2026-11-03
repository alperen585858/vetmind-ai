"""These checks are run against the existing project when it is available."""
from pathlib import Path
import sys
import pytest

from evaluation.adapters.compatibility import check_backend_contracts

BACKEND = Path(__file__).resolve().parents[2] / "backend"
if not BACKEND.is_dir():
    pytest.skip("Full VetMind backend unavailable in isolated package", allow_module_level=True)
sys.path.insert(0, str(BACKEND))


def test_uploaded_backend_has_supported_contract_versions():
    checks = check_backend_contracts()
    assert len(checks) == 3
    assert {c.contract for c in checks} == {
        "structured_findings", "model_outputs", "draft_report"
    }
    assert all(c.status == "compatible" for c in checks), checks


def test_report_contract_uses_existing_four_sections():
    report = next(c for c in check_backend_contracts() if c.contract == "draft_report")
    assert report.version == "1.0.0"
    assert report.missing_fields == ()
