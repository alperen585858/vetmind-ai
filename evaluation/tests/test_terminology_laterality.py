import pytest
from evaluation.clinical_terminology.laterality import detect_laterality, sides_compatible


@pytest.mark.parametrize("text,side", [
    ("left", "LEFT"), ("LEFT side", "LEFT"), ("sol", "LEFT"),
    ("right", "RIGHT"), ("sağ", "RIGHT"), ("sag", "RIGHT"),
    ("midline", "MIDLINE"), ("orta hat", "MIDLINE"),
    ("bilateral", "BILATERAL"), ("iki taraflı", "BILATERAL"),
    ("iki tarafli", "BILATERAL"),
    ("no side", "UNKNOWN"), ("", "UNKNOWN"),
    ("left and right", "AMBIGUOUS"), ("sol veya sağ", "AMBIGUOUS"),
    ("bilateral, left dominant", "AMBIGUOUS"),
    ("midline right", "AMBIGUOUS"),
])
def test_literal_side(text, side):
    assert detect_laterality(text).side == side


def test_no_substring_guess():
    assert detect_laterality("alrightly").side == "UNKNOWN"
    assert detect_laterality("solenoid").side == "UNKNOWN"


def test_unknown_never_matches():
    assert not sides_compatible("UNKNOWN", "UNKNOWN")


def test_ambiguous_never_matches():
    assert not sides_compatible("AMBIGUOUS", "AMBIGUOUS")


def test_equal_known_matches():
    for side in ("LEFT", "RIGHT", "MIDLINE", "BILATERAL"):
        assert sides_compatible(side, side)


def test_different_known_mismatches():
    assert not sides_compatible("LEFT", "RIGHT")
    assert not sides_compatible("MIDLINE", "BILATERAL")


def test_conflicting_signal():
    result = detect_laterality("left right")
    assert result.explicit and result.conflicting


def test_missing_signal():
    result = detect_laterality("no information")
    assert not result.explicit and not result.conflicting


def test_bad_type():
    with pytest.raises(TypeError):
        detect_laterality(None)
