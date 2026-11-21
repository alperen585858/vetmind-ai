"""Shared lookup so bounded-context services can use the facade's state."""

from __future__ import annotations


class HostBound:
    """Methods on the subclass run with this instance as ``self``.

    Attributes and methods that were not moved (repository, locks, audit,
    cross-calls back into the facade) resolve on the host object.
    Instance attributes must stay on the host; these services do not copy them.
    """

    def __init__(self, host: object) -> None:
        object.__setattr__(self, "_host", host)

    def __getattr__(self, name: str) -> object:
        if name.startswith("__"):
            raise AttributeError(name)
        host = object.__getattribute__(self, "_host")
        return getattr(host, name)
