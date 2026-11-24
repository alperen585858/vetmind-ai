"""Optional pet-owner name on cases (B2B).

Pet owners are not platform users: they have no account, are never emailed and are not
linked to cases. A case may carry the owner's name for the vet's own records; everything
else (email, KVKK email consent, account linking) was removed from the create flow.

Legacy rows keep whatever owner fields they already have; new writes never add them.
"""

from __future__ import annotations

OWNER_NAME_MAX = 120


def clean_owner_name(owner_name: str | None) -> str | None:
    """Trim the optional owner name; blank → ``None``."""
    name = " ".join((owner_name or "").split())
    if not name:
        return None
    return name[:OWNER_NAME_MAX]
