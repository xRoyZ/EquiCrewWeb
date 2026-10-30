"""Sending a contact message as an email via SMTP.

Skeleton: the SMTP ticket fills ``send_contact_mail``. Until then every call reports
that sending is not configured, which the contact route answers with 503.
"""

from __future__ import annotations

from app.config import Settings
from app.schemas import ContactMessage


class MailError(Exception):
    """Base class of every mail sending failure."""


class MailNotConfiguredError(MailError):
    """SMTP is not configured (SMTP_HOST / SMTP_FROM missing): no mail can be sent."""


class MailSendError(MailError):
    """The SMTP server could not be reached or refused the message."""


def send_contact_mail(message: ContactMessage, settings: Settings) -> None:
    """Send ``message`` as one email to ``settings.contact_to``.

    Raises MailNotConfiguredError when SMTP is not configured and MailSendError when
    sending fails.
    """
    raise MailNotConfiguredError("SMTP sending is not implemented yet")
