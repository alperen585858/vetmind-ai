"""Explicit, fail-closed compatibility policy for versioned VetMind contracts.

Version compatibility here describes the ability of this *adapter* to parse a
schema. It must not be interpreted as clinical/model validation.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Final

_SEMVER: Final[re.Pattern[str]] = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$"
)


@dataclass(frozen=True, order=True)
class SchemaVersion:
    major: int
    minor: int
    patch: int

    def __post_init__(self) -> None:
        for name in ("major", "minor", "patch"):
            value = getattr(self, name)
            if type(value) is not int or value < 0:
                raise ValueError(f"{name} must be a nonnegative integer")

    @classmethod
    def parse(cls, value: str) -> "SchemaVersion":
        if not isinstance(value, str):
            raise TypeError("schema version must be a string")
        match = _SEMVER.fullmatch(value)
        if match is None:
            raise ValueError("schema version must use numeric MAJOR.MINOR.PATCH")
        return cls(*(int(part) for part in match.groups()))

    def __str__(self) -> str:
        return f"{self.major}.{self.minor}.{self.patch}"


class Compatibility(str, Enum):
    SUPPORTED = "supported"
    OLDER = "older_than_supported"
    NEWER = "newer_than_supported"
    INCOMPATIBLE = "incompatible_major"


@dataclass(frozen=True)
class VersionCheck:
    incoming: SchemaVersion
    minimum: SchemaVersion
    maximum: SchemaVersion
    status: Compatibility

    @property
    def supported(self) -> bool:
        return self.status is Compatibility.SUPPORTED


def check_version(
    incoming: str, *, minimum: str, maximum: str
) -> VersionCheck:
    """Accept an explicitly tested inclusive interval, never guess future support."""
    received = SchemaVersion.parse(incoming)
    lower = SchemaVersion.parse(minimum)
    upper = SchemaVersion.parse(maximum)
    if lower > upper or lower.major != upper.major:
        raise ValueError("supported interval must be ordered and within one major")
    if received.major != lower.major:
        status = Compatibility.INCOMPATIBLE
    elif received < lower:
        status = Compatibility.OLDER
    elif received > upper:
        status = Compatibility.NEWER
    else:
        status = Compatibility.SUPPORTED
    return VersionCheck(received, lower, upper, status)


# Deliberately narrow: these reflect the uploaded repository snapshot, not
# a promise to support all future schema revisions.
SUPPORTED_CONTRACTS: Final[dict[str, tuple[str, str]]] = {
    "evaluation_manifest": ("1.0.0", "1.0.0"),
    "evaluation_record": ("1.0.0", "1.0.0"),
    "structured_findings": ("1.3.0", "1.3.0"),
    "model_outputs": ("1.0.0", "1.0.0"),
    "draft_report": ("1.0.0", "1.0.0"),
}


def check_contract(name: str, version: str) -> VersionCheck:
    """Check explicit compatibility for a named contract."""
    try:
        minimum, maximum = SUPPORTED_CONTRACTS[name]
    except KeyError as exc:
        raise ValueError(f"unknown contract: {name}") from exc
    return check_version(version, minimum=minimum, maximum=maximum)
