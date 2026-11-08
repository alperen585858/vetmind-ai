"""Case ID display/canonical mapping (VM- ↔ case-)."""

from __future__ import annotations

from app.services.case_ids import canonicalize_case_id


def test_canonicalize_case_id_lowercases_hex() -> None:
    assert canonicalize_case_id("case-408194147E09") == "case-408194147e09"
    assert canonicalize_case_id("CASE-408194147E09") == "case-408194147e09"


def test_canonicalize_case_id_accepts_display_vm_prefix() -> None:
    assert canonicalize_case_id("VM-408194147E09") == "case-408194147e09"
    assert canonicalize_case_id("vm-408194147e09") == "case-408194147e09"


def test_canonicalize_case_id_preserves_empty() -> None:
    assert canonicalize_case_id("") == ""
    assert canonicalize_case_id("   ") == ""
