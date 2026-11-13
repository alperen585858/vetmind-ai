"""Outgoing mail adapters (issue #31 step 4).

- ``SmtpMailer`` when ``VETMIND_SMTP_HOST`` is set.
- ``LogMailer`` otherwise. In demo mode it writes the whole message (including reset links)
  to the server log so the flow works without a mail server. In protected mode it never logs
  the body, because a log line with a live reset link is as good as the password.

Every mailer also keeps the last messages in ``outbox`` (memory only) for tests.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from collections import deque
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class OutgoingMail:
    to: str
    subject: str
    body: str


class Mailer(Protocol):
    outbox: deque[OutgoingMail]

    def send(self, mail: OutgoingMail) -> None: ...


class LogMailer:
    def __init__(self, *, log_body: bool) -> None:
        self._log_body = log_body
        self.outbox: deque[OutgoingMail] = deque(maxlen=50)

    def send(self, mail: OutgoingMail) -> None:
        self.outbox.append(mail)
        if self._log_body:
            log.warning(
                "[DEMO MAIL — no SMTP configured]\nTo: %s\nSubject: %s\n\n%s", mail.to, mail.subject, mail.body
            )
        else:
            log.error(
                "Mail to %s (%s) was NOT delivered: set VETMIND_SMTP_HOST to send email.",
                mail.to,
                mail.subject,
            )


class SmtpMailer:
    def __init__(
        self,
        *,
        host: str,
        port: int,
        sender: str,
        username: str | None,
        password: str | None,
        starttls: bool,
        timeout_s: float = 10.0,
    ) -> None:
        self._host = host
        self._port = port
        self._sender = sender
        self._username = username
        self._password = password
        self._starttls = starttls
        self._timeout = timeout_s
        self.outbox: deque[OutgoingMail] = deque(maxlen=50)

    def send(self, mail: OutgoingMail) -> None:
        self.outbox.append(mail)
        msg = EmailMessage()
        msg["From"] = self._sender
        msg["To"] = mail.to
        msg["Subject"] = mail.subject
        msg.set_content(mail.body)
        try:
            with smtplib.SMTP(self._host, self._port, timeout=self._timeout) as smtp:
                if self._starttls:
                    smtp.starttls(context=ssl.create_default_context())
                if self._username:
                    smtp.login(self._username, self._password or "")
                smtp.send_message(msg)
        except (OSError, smtplib.SMTPException):
            # Never fail the HTTP request (that would reveal whether the account exists).
            log.exception("Could not send mail to %s via %s:%s", mail.to, self._host, self._port)


def build_mailer(settings) -> Mailer:
    if settings.smtp_host:
        return SmtpMailer(
            host=settings.smtp_host,
            port=settings.smtp_port,
            sender=settings.smtp_from,
            username=settings.smtp_username,
            password=settings.smtp_password,
            starttls=settings.smtp_starttls,
        )
    return LogMailer(log_body=settings.deployment_mode != "protected")
