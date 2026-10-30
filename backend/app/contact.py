"""POST /api/contact — receives one contact form submission.

Skeleton: the rate limit is already consulted; validation, honeypot and sending are
filled by the contact endpoint ticket. Until then the route answers 501.
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from app.errors import ApiError
from app.ratelimit import get_rate_limiter

router = APIRouter()

MESSAGE_RATE_LIMITED = (
    "Zu viele Anfragen. Bitte warte ein paar Minuten und versuche es dann erneut."
)


def client_ip(request: Request) -> str:
    """The address the request came from (the key of the rate limit)."""
    return request.client.host if request.client else "unknown"


@router.post("/api/contact")
async def submit_contact(request: Request) -> dict[str, bool]:
    """Accept a contact form submission and mail it to the office."""
    if not get_rate_limiter().allow(client_ip(request)):
        raise ApiError(429, "rate_limited", MESSAGE_RATE_LIMITED)
    raise ApiError(
        501,
        "not_implemented",
        "Das Kontaktformular ist noch nicht verfügbar. Bitte schreib uns direkt an "
        "office@equicrew.com.",
    )
