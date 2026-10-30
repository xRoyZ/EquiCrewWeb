"""Sending a contact message as an email via SMTP.

``send_contact_mail`` builds one plain-text email to the office mailbox with the
sender's address as Reply-To and hands it to the configured SMTP server. Port 465
uses implicit TLS (``SMTP_SSL``); every other port uses plain SMTP upgraded with
STARTTLS whenever the server offers it.

Privacy: each attempt logs exactly one line naming the outcome and, at most, the
recipient's domain. The message body, the sender's names and address, the SMTP
credentials and the raw SMTP error text are never logged and never leave this module
inside an exception message.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from email.message import EmailMessage

from app.config import Settings
from app.schemas import ContactMessage

logger = logging.getLogger(__name__)

SMTP_TIMEOUT_SECONDS = 15.0
IMPLICIT_TLS_PORT = 465


class MailError(Exception):
    """Base class of every mail sending failure."""


class MailNotConfiguredError(MailError):
    """SMTP is not configured (SMTP_HOST / SMTP_FROM missing): no mail can be sent."""


class MailSendError(MailError):
    """The SMTP server could not be reached or refused the message."""


def _domain_of(address: str) -> str:
    """Return the domain part of ``address`` (never the local part)."""
    _, _, domain = address.rpartition("@")
    return domain or "unknown"


def build_contact_mail(message: ContactMessage, settings: Settings) -> EmailMessage:
    """Build the email for ``message`` using the header API only."""
    mail = EmailMessage()
    mail["From"] = settings.smtp_from or ""
    mail["To"] = settings.contact_to
    mail["Reply-To"] = str(message.email)
    mail["Subject"] = f"Neue Kontaktanfrage von {message.first_name} {message.last_name}"
    body = (
        "Neue Nachricht über das Kontaktformular auf equicrew.com\n"
        "\n"
        f"Vorname: {message.first_name}\n"
        f"Nachname: {message.last_name}\n"
        f"E-Mail: {message.email}\n"
        "\n"
        "Nachricht:\n"
        f"{message.message}\n"
    )
    mail.set_content(body)
    return mail


def _deliver(mail: EmailMessage, settings: Settings) -> None:
    """Hand ``mail`` to the configured SMTP server."""
    host = settings.smtp_host or ""
    port = settings.smtp_port
    context = ssl.create_default_context()
    if port == IMPLICIT_TLS_PORT:
        server: smtplib.SMTP = smtplib.SMTP_SSL(
            host, port, timeout=SMTP_TIMEOUT_SECONDS, context=context
        )
    else:
        server = smtplib.SMTP(host, port, timeout=SMTP_TIMEOUT_SECONDS)
    with server:
        if port != IMPLICIT_TLS_PORT:
            server.ehlo()
            if server.has_extn("starttls"):
                server.starttls(context=context)
                server.ehlo()
        if settings.smtp_user and settings.smtp_password:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(mail)


def send_contact_mail(message: ContactMessage, settings: Settings) -> None:
    """Send ``message`` as one email to ``settings.contact_to``.

    Raises MailNotConfiguredError when SMTP is not configured and MailSendError when
    sending fails. Neither exception carries the raw SMTP error text.
    """
    recipient_domain = _domain_of(settings.contact_to)
    if not settings.smtp_configured:
        logger.warning(
            "contact mail not sent: SMTP is not configured (recipient domain %s)",
            recipient_domain,
        )
        raise MailNotConfiguredError("SMTP is not configured")

    mail = build_contact_mail(message, settings)
    try:
        _deliver(mail, settings)
    except (smtplib.SMTPException, OSError) as exc:
        logger.error(
            "contact mail failed: %s (recipient domain %s)",
            type(exc).__name__,
            recipient_domain,
        )
        raise MailSendError("the contact mail could not be sent") from None
    logger.info("contact mail sent (recipient domain %s)", recipient_domain)
