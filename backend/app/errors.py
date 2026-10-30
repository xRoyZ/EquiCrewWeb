"""The API's shared error body and the handlers that produce it.

Every non-2xx answer of the API has exactly this shape::

    {"error": {"code": str, "message": str, "fields": {str: str}}}

``message`` is German and meant for the user; ``fields`` appears only on 422 and maps
``first_name | last_name | email | message`` to a German message per field. No handler
ever puts an exception's text, a traceback or configuration into a response: what went
wrong internally is logged server-side only.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger(__name__)

FORM_FIELDS = ("first_name", "last_name", "email", "message")

MESSAGE_INTERNAL_ERROR = (
    "Es ist ein unerwarteter Fehler aufgetreten. Bitte versuche es später erneut "
    "oder schreib uns direkt an office@equicrew.com."
)
MESSAGE_VALIDATION_ERROR = "Bitte überprüfe deine Eingaben."

_HTTP_ERRORS: dict[int, tuple[str, str]] = {
    400: ("bad_request", "Die Anfrage ist ungültig."),
    404: ("not_found", "Die angeforderte Adresse existiert nicht."),
    405: ("method_not_allowed", "Diese Methode ist für diese Adresse nicht erlaubt."),
    413: ("payload_too_large", "Die Anfrage ist zu groß."),
    415: ("unsupported_media_type", "Das Format der Anfrage wird nicht unterstützt."),
    422: ("validation_error", MESSAGE_VALIDATION_ERROR),
    429: (
        "rate_limited",
        "Zu viele Anfragen. Bitte warte ein paar Minuten und versuche es dann erneut.",
    ),
    501: ("not_implemented", "Diese Funktion ist noch nicht verfügbar."),
    503: ("service_unavailable", "Der Dienst ist vorübergehend nicht verfügbar."),
}


class ApiError(Exception):
    """An error the API answers deliberately, rendered in the shared error body."""

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        fields: dict[str, str] | None = None,
    ) -> None:
        super().__init__(f"{status} {code}")
        self.status = status
        self.code = code
        self.message = message
        self.fields = fields


def error_body(code: str, message: str, fields: dict[str, str] | None = None) -> dict[str, Any]:
    """Build the shared error body."""
    error: dict[str, Any] = {"code": code, "message": message}
    if fields is not None:
        error["fields"] = fields
    return {"error": error}


def error_response(
    status: int,
    code: str,
    message: str,
    fields: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    """Render the shared error body as a JSON response."""
    return JSONResponse(
        status_code=status, content=error_body(code, message, fields), headers=headers
    )


def _field_message(error_type: str, field: str) -> str:
    if error_type == "missing" or error_type == "string_too_short":
        return "Dieses Feld ist erforderlich."
    if error_type == "string_too_long":
        return "Die Eingabe ist zu lang."
    if field == "email":
        return "Bitte gib eine gültige E-Mail-Adresse ein."
    return "Die Eingabe ist ungültig."


def validation_fields(errors: Sequence[Any]) -> dict[str, str]:
    """Translate pydantic/FastAPI validation errors into German per-field messages.

    Only the four form fields are reported; the first error of a field wins.
    """
    fields: dict[str, str] = {}
    for error in errors:
        if not isinstance(error, dict):
            continue
        location = error.get("loc") or ()
        field = next((part for part in location if part in FORM_FIELDS), None)
        if field is None or field in fields:
            continue
        fields[field] = _field_message(str(error.get("type", "")), field)
    return fields


async def _handle_api_error(_request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, ApiError)
    fields = exc.fields if exc.status == 422 else None
    if exc.status == 422 and fields is None:
        fields = {}
    return error_response(exc.status, exc.code, exc.message, fields)


async def _handle_http_exception(_request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    code, message = _HTTP_ERRORS.get(
        exc.status_code, ("http_error", "Die Anfrage konnte nicht verarbeitet werden.")
    )
    fields: dict[str, str] | None = {} if exc.status_code == 422 else None
    return error_response(exc.status_code, code, message, fields, headers=exc.headers)


async def _handle_validation_error(_request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    return error_response(
        422, "validation_error", MESSAGE_VALIDATION_ERROR, validation_fields(exc.errors())
    )


async def _handle_unhandled(request: Request, _exc: Exception) -> JSONResponse:
    # The traceback is logged by UnhandledErrorMiddleware or by Starlette itself;
    # the client only ever sees the generic German message.
    logger.error("unhandled error on %s %s", request.method, request.url.path)
    return error_response(500, "internal_error", MESSAGE_INTERNAL_ERROR)


class UnhandledErrorMiddleware:
    """Pure ASGI middleware turning any unhandled exception into the shared 500 body.

    It sits INSIDE the CORS middleware, so a 500 keeps its CORS headers and the browser
    can read the error instead of reporting a network failure. The exception and its
    traceback are logged server-side only.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def send_wrapper(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            logger.exception(
                "unhandled error on %s %s", scope.get("method", "?"), scope.get("path", "?")
            )
            if response_started:
                raise
            response = error_response(500, "internal_error", MESSAGE_INTERNAL_ERROR)
            await response(scope, receive, send)


def install_error_handlers(app: FastAPI) -> None:
    """Register every handler of the shared error body on ``app``.

    Call this BEFORE adding the CORS middleware: middleware added later wraps the
    earlier one, so the catch-all stays inside CORS.
    """
    app.add_exception_handler(ApiError, _handle_api_error)
    app.add_exception_handler(StarletteHTTPException, _handle_http_exception)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)
    app.add_exception_handler(Exception, _handle_unhandled)
    app.add_middleware(UnhandledErrorMiddleware)
