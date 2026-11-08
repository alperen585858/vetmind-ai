"""Canonical case ID helpers.

UI display numbers look like ``VM-408194147E09`` (uppercase). Persisted primary
keys are always ``case-`` + lowercase hex (``case-408194147e09``). Accepting
only the exact stored form made DICOM / case GETs return ``Case not found.``
whenever a display id or mixed-case variant leaked into the path.
"""

from __future__ import annotations


def canonicalize_case_id(case_id: str) -> str:
    """Map display / mixed-case ids onto the stored ``case-…`` primary key form.

    Examples:
    - ``case-408194147E09`` → ``case-408194147e09``
    - ``VM-408194147E09`` → ``case-408194147e09``
    - ``vm-408194147e09`` → ``case-408194147e09``
    """
    raw = (case_id or "").strip()
    if not raw:
        return raw
    lower = raw.lower()
    if lower.startswith("vm-"):
        return f"case-{lower[3:]}"
    if lower.startswith("case-"):
        return f"case-{lower[5:]}"
    return lower
