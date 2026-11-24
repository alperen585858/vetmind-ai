"""Report-ready email to the submitting veterinarian (issue #90).

When a radiologist approves a report, the vet who opened the case gets one email that the
report is ready, with a link into VetMind. Rules:

- Only the vet who submitted the case (``case.owner_subject``) is emailed. Pet owners are
  never emailed (B2B).
- The link opens the report page inside the app, so the normal sign-in and case-access
  checks apply. No PDF or health data is attached.
- One email per approved report version: a repeated call for the same version is a no-op.
- SMTP failures are retried a few times, then recorded on the case. They never undo or
  block the approval.
- Logs carry the case id and outcome, never the recipient address or the patient name.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Callable

from app.auth.mailer import OutgoingMail
from app.schemas.case import CaseRecord
from app.services.activity import append_activity

log = logging.getLogger(__name__)

_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")

MAX_ATTEMPTS = 3
RETRY_BACKOFF_S = (0.2, 0.5)

SUBJECT = "VetMind AI — Radyoloji Raporunuz Hazır"


def report_link(public_base_url: str, case_id: str) -> str:
    return f"{public_base_url.rstrip('/')}/raporlar/{case_id}"


def build_vet_report_email(*, to: str, link: str) -> OutgoingMail:
    body = (
        "Merhaba,\n\n"
        "Göndermiş olduğunuz radyoloji vakasının raporu uzman radyolog tarafından onaylanmıştır.\n\n"
        "Raporu görüntülemek veya PDF olarak indirmek için VetMind AI hesabınıza giriş yapabilirsiniz.\n\n"
        f"Raporu Görüntüle: {link}\n\n"
        "VetMind AI\n\n"
        "---\n"
        "Bu e-posta otomatik olarak gönderilmiştir. Bağlantı yalnızca bu vakaya erişim yetkisi "
        "olan hesaplarla açılır; e-postada rapor veya sağlık verisi eki bulunmaz.\n"
    )
    return OutgoingMail(to=to, subject=SUBJECT, body=body)


def submitting_vet_email(case: CaseRecord) -> str | None:
    subject = (case.owner_subject or "").strip().lower()
    if not subject or not _EMAIL_RE.match(subject):
        return None
    return subject


def deliver_vet_report_email(
    case: CaseRecord,
    *,
    report_version: int,
    mailer: object | None,
    smtp_configured: bool,
    public_base_url: str,
    sleep: Callable[[float], None] = time.sleep,
) -> str:
    """Email the submitting vet once per approved version. Returns the delivery status."""
    if report_version in case.vet_email_sent_versions:
        return case.vet_email_delivery_status or "sent"

    to = submitting_vet_email(case)
    if to is None:
        case.vet_email_delivery_status = "skipped_no_recipient"
        case.vet_email_delivery_detail = "Case has no submitting vet account with an email address."
        log.info("report email skipped (no recipient) case=%s v%s", case.case_id, report_version)
        return case.vet_email_delivery_status
    if mailer is None:
        case.vet_email_delivery_status = "not_configured"
        case.vet_email_delivery_detail = "Mailer is not configured."
        return case.vet_email_delivery_status

    mail = build_vet_report_email(to=to, link=report_link(public_base_url, case.case_id))

    if not smtp_configured:
        # Demo/dev: the log mailer keeps the message in its outbox (and the dev log) so the
        # flow can be checked, but nothing leaves the machine.
        mailer.send(mail)  # type: ignore[attr-defined]
        case.vet_email_delivery_status = "not_configured"
        case.vet_email_delivery_detail = "SMTP is not configured (VETMIND_SMTP_HOST); email was not delivered."
        case.vet_email_sent_versions = [*case.vet_email_sent_versions, report_version]
        log.warning("report email not delivered (no SMTP) case=%s v%s", case.case_id, report_version)
        return case.vet_email_delivery_status

    last_error = ""
    for attempt in range(1, MAX_ATTEMPTS + 1):
        case.vet_email_delivery_attempts += 1
        try:
            mailer.send(mail, raise_on_error=True)  # type: ignore[attr-defined]
        except Exception as exc:  # noqa: BLE001 — retry, then record; approval stands
            last_error = type(exc).__name__
            log.warning(
                "report email attempt %s/%s failed case=%s v%s: %s",
                attempt,
                MAX_ATTEMPTS,
                case.case_id,
                report_version,
                last_error,
            )
            if attempt < MAX_ATTEMPTS:
                sleep(RETRY_BACKOFF_S[min(attempt - 1, len(RETRY_BACKOFF_S) - 1)])
            continue
        case.vet_email_delivery_status = "sent"
        case.vet_email_delivery_detail = f"Report-ready email sent (v{report_version})."
        case.vet_email_sent_versions = [*case.vet_email_sent_versions, report_version]
        append_activity(case, kind="vet_report_email_sent", actor_subject="system", detail=f"v{report_version}")
        log.info("report email sent case=%s v%s", case.case_id, report_version)
        return case.vet_email_delivery_status

    case.vet_email_delivery_status = "failed"
    case.vet_email_delivery_detail = f"Email could not be sent after {MAX_ATTEMPTS} attempts ({last_error})."
    log.error("report email failed case=%s v%s after %s attempts", case.case_id, report_version, MAX_ATTEMPTS)
    return case.vet_email_delivery_status
