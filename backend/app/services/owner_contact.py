"""Resolve and validate pet-owner contact on case create / update."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException, status

from app.http_errors import api_error

_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")


@dataclass(frozen=True)
class OwnerContactResolved:
    owner_contact_name: str
    owner_contact_email: str
    owner_email_consent: bool
    pet_owner_subject: Optional[str]


def normalize_email(value: str) -> str:
    return value.strip().lower()


def validate_owner_contact(
    *,
    owner_name: str | None,
    owner_email: str | None,
    owner_email_consent: bool = False,
    pet_owner_subject: str | None = None,
    require: bool = True,
) -> OwnerContactResolved | None:
    """Validate owner fields. When ``require`` is True, name+email are mandatory."""
    name = (owner_name or "").strip()
    email_raw = (owner_email or "").strip()
    subject = (pet_owner_subject or "").strip() or None

    if not require and not name and not email_raw and not subject:
        return None

    if require and not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=api_error("owner_name_required", "Pet owner name is required."),
        )
    if require and not email_raw and not subject:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=api_error(
                "owner_email_required",
                "Pet owner email is required (or select a registered owner account).",
            ),
        )

    email = ""
    if email_raw:
        email = normalize_email(email_raw)
        if not _EMAIL_RE.match(email):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=api_error("invalid_owner_email", "Enter a valid owner email address."),
            )

    return OwnerContactResolved(
        owner_contact_name=name or (subject.split("@")[0] if subject else ""),
        owner_contact_email=email or (subject or ""),
        owner_email_consent=bool(owner_email_consent),
        pet_owner_subject=subject,
    )


def resolve_owner_account(
    *,
    email: str,
    auth_users: dict | None,
    workflow_get_user=None,
) -> Optional[str]:
    """If email belongs to an active owner (or any) account, return that subject."""
    if not email:
        return None
    key = normalize_email(email)
    if auth_users and key in auth_users:
        entry = auth_users[key]
        role = getattr(entry, "role", None)
        if role in {"owner", "vet", "clinic_owner", "expert", "admin"}:
            # Prefer linking pet owners; still link if the email is a known account.
            return key
    if workflow_get_user is not None:
        user = workflow_get_user(key)
        if user is not None and getattr(user, "active", True):
            return key
    return None
