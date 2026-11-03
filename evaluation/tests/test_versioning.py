"""Contract-version policy tests, independent of clinical assets."""
import pytest

from evaluation.versioning import (
    Compatibility, SchemaVersion, check_contract, check_version,
)


def test_parse_round_trip():
    version = SchemaVersion.parse("1.3.12")
    assert version == SchemaVersion(1, 3, 12)
    assert str(version) == "1.3.12"


@pytest.mark.parametrize("bad", ["", "1", "1.2", "1.2.3.4", "01.2.3", "1.02.3",
                                 "1.2.3-alpha", "v1.2.3", " 1.2.3", "-1.0.0"])
def test_invalid_version_strings(bad):
    with pytest.raises(ValueError):
        SchemaVersion.parse(bad)


@pytest.mark.parametrize("value", [None, 100, 1.0, []])
def test_invalid_version_types(value):
    with pytest.raises(TypeError):
        SchemaVersion.parse(value)


@pytest.mark.parametrize("status, incoming", [
    (Compatibility.SUPPORTED, "1.0.0"),
    (Compatibility.SUPPORTED, "1.1.0"),
    (Compatibility.SUPPORTED, "1.1.2"),
    (Compatibility.OLDER, "1.0.0-ignored"),
])
def test_version_ranges(status, incoming):
    if incoming.endswith("-ignored"):
        with pytest.raises(ValueError):
            check_version(incoming, minimum="1.0.1", maximum="1.1.2")
    else:
        assert check_version(incoming, minimum="1.0.0", maximum="1.1.2").status is status


def test_unsupported_versions_fail_closed():
    assert check_version("1.0.0", minimum="1.1.0", maximum="1.2.0").status is Compatibility.OLDER
    assert check_version("1.3.0", minimum="1.1.0", maximum="1.2.0").status is Compatibility.NEWER
    assert check_version("2.0.0", minimum="1.1.0", maximum="1.2.0").status is Compatibility.INCOMPATIBLE
    assert not check_contract("structured_findings", "1.4.0").supported
    assert check_contract("structured_findings", "1.3.0").supported


@pytest.mark.parametrize("minimum,maximum", [("2.0.0", "1.0.0"), ("1.0.0", "2.0.0")])
def test_bad_supported_ranges(minimum, maximum):
    with pytest.raises(ValueError):
        check_version("1.0.0", minimum=minimum, maximum=maximum)


def test_unknown_contract_name():
    with pytest.raises(ValueError):
        check_contract("made_up", "1.0.0")


def test_version_dataclass_rejects_bool():
    with pytest.raises(ValueError):
        SchemaVersion(True, 0, 0)
