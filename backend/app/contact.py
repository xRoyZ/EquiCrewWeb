"""POST /api/contact — receives one contact form submission.

The steps, in this order:

1. the per-IP rate limit (429 rate_limited);
2. the body size limit, enforced before the whole body is read (413 payload_too_large);
3. JSON parsing and validation against ``ContactMessage`` (422 validation_error with a
   German message per field; CR/LF in names or email is rejected, so no submission can
   add a mail header or a recipient);
4. the honeypot: a filled ``website`` field answers success and sends nothing;
5. sending through the mail sender dependency (503 mail_unavailable without SMTP
   configuration, 500 mail_failed when sending fails, else 200 ``{"ok": true}``).

No answer ever carries an exception text, a traceback or SMTP configuration.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Sequence
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from app import mailer
from app.config import Settings
from app.errors import FORM_FIELDS, MESSAGE_VALIDATION_ERROR, ApiError
from app.mailer import MailNotConfiguredError, MailSendError
from app.ratelimit import get_rate_limiter
from app.schemas import MAX_MESSAGE_LENGTH, MAX_NAME_LENGTH, ContactMessage

logger = logging.getLogger(__name__)

router = APIRouter()

MailSender = Callable[[ContactMessage, Settings], None]

MESSAGE_RATE_LIMITED = (
    "Zu viele Anfragen. Bitte warte ein paar Minuten und versuche es dann erneut."
)
MESSAGE_PAYLOAD_TOO_LARGE = "Deine Nachricht ist zu groß. Bitte kürze sie und versuche es erneut."
MESSAGE_INVALID_BODY = "Die Anfrage konnte nicht gelesen werden. Bitte versuche es erneut."
MESSAGE_MAIL_UNAVAILABLE = (
    "Das Kontaktformular ist gerade nicht verfügbar. Bitte schreib uns direkt an "
    "office@equicrew.com."
)
MESSAGE_MAIL_FAILED = (
    "Deine Nachricht konnte nicht gesendet werden. Bitte versuche es später erneut "
    "oder schreib uns direkt an office@equicrew.com."
)

_REQUIRED_MESSAGES = {
    "first_name": "Bitte gib deinen Vornamen ein.",
    "last_name": "Bitte gib deinen Nachnamen ein.",
    "email": "Bitte gib deine E-Mail-Adresse ein.",
    "message": "Bitte gib eine Nachricht ein.",
}
_TOO_LONG_MESSAGES = {
    "first_name": f"Der Vorname darf höchstens {MAX_NAME_LENGTH} Zeichen lang sein.",
    "last_name": f"Der Nachname darf höchstens {MAX_NAME_LENGTH} Zeichen lang sein.",
    "email": "Die E-Mail-Adresse ist zu lang.",
    "message": f"Die Nachricht darf höchstens {MAX_MESSAGE_LENGTH} Zeichen lang sein.",
}
_INVALID_MESSAGES = {
    "first_name": "Der Vorname darf keine Zeilenumbrüche oder ungültigen Zeichen enthalten.",
    "last_name": "Der Nachname darf keine Zeilenumbrüche oder ungültigen Zeichen enthalten.",
    "email": "Bitte gib eine gültige E-Mail-Adresse ein.",
    "message": "Bitte gib eine gültige Nachricht ein.",
}


def client_ip(request: Request) -> str:
    """The address the request came from (the key of the rate limit)."""
    return request.client.host if request.client else "unknown"


def get_mail_sender() -> MailSender:
    """The function that mails a validated message; tests override this dependency."""
    return mailer.send_contact_mail


def _field_message(field: str, error_type: str) -> str:
    if error_type in ("missing", "string_too_short"):
        return _REQUIRED_MESSAGES[field]
    if error_type == "string_too_long":
        return _TOO_LONG_MESSAGES[field]
    return _INVALID_MESSAGES[field]


def contact_fields(errors: Sequence[Any]) -> dict[str, str]:
    """German per-field messages for the validation errors of a submission."""
    fields: dict[str, str] = {}
    for error in errors:
        location = error.get("loc") or ()
        field = next((part for part in location if part in FORM_FIELDS), None)
        if field is None or field in fields:
            continue
        fields[field] = _field_message(field, str(error.get("type", "")))
    return fields


async def read_limited_body(request: Request, max_bytes: int) -> bytes:
    """Read the request body, refusing with 413 as soon as it exceeds ``max_bytes``.

    A declared Content-Length over the limit is refused without reading anything; a
    body without (or with a false) Content-Length is read only up to the limit.
    """
    declared = request.headers.get("content-length", "").strip()
    # A malformed header is not trusted either way: the capped read below decides.
    if declared.isdigit() and int(declared) > max_bytes:
        raise ApiError(413, "payload_too_large", MESSAGE_PAYLOAD_TOO_LARGE)

    chunks: list[bytes] = []
    received = 0
    async for chunk in request.stream():
        received += len(chunk)
        if received > max_bytes:
            raise ApiError(413, "payload_too_large", MESSAGE_PAYLOAD_TOO_LARGE)
        chunks.append(chunk)
    return b"".join(chunks)


def parse_payload(body: bytes) -> dict[str, Any]:
    """Decode the body as one JSON object, else 422 validation_error."""
    try:
        payload = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise ApiError(422, "validation_error", MESSAGE_INVALID_BODY, {}) from None
    if not isinstance(payload, dict):
        raise ApiError(422, "validation_error", MESSAGE_INVALID_BODY, {})
    return payload


def is_honeypot_filled(payload: dict[str, Any]) -> bool:
    """True when the hidden ``website`` field carries anything (a bot filled it)."""
    value = payload.get("website")
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True


@router.post("/api/contact")
async def submit_contact(
    request: Request,
    send_mail: Annotated[MailSender, Depends(get_mail_sender)],
) -> dict[str, bool]:
    """Accept a contact form submission and mail it to the office."""
    if not get_rate_limiter().allow(client_ip(request)):
        raise ApiError(429, "rate_limited", MESSAGE_RATE_LIMITED)

    settings: Settings = request.app.state.settings
    body = await read_limited_body(request, settings.max_body_bytes)
    payload = parse_payload(body)

    if is_honeypot_filled(payload):
        # Answer like a success so the bot learns nothing; nothing is sent.
        logger.info("contact submission discarded: honeypot field was filled")
        return {"ok": True}

    try:
        message = ContactMessage.model_validate(payload)
    except ValidationError as exc:
        raise ApiError(
            422, "validation_error", MESSAGE_VALIDATION_ERROR, contact_fields(exc.errors())
        ) from None

    try:
        await run_in_threadpool(send_mail, message, settings)
    except MailNotConfiguredError:
        logger.warning("contact submission refused: SMTP is not configured")
        raise ApiError(503, "mail_unavailable", MESSAGE_MAIL_UNAVAILABLE) from None
    except MailSendError:
        logger.exception("contact submission could not be sent")
        raise ApiError(500, "mail_failed", MESSAGE_MAIL_FAILED) from None

    return {"ok": True}
