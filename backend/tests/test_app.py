"""Tests of the API skeleton: boot, health, routing, CORS and the shared error body."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app import contact
from app.config import DEFAULT_CONTACT_TO, Settings, get_settings, load_settings
from app.errors import ApiError
from app.main import create_app
from app.ratelimit import get_rate_limiter
from app.schemas import ContactMessage

from .conftest import WEB_ORIGIN

FOREIGN_ORIGIN = "https://evil.example"
SECRET_TEXT = "smtp.internal.example password=do-not-leak"

VALID_FORM = {
    "first_name": "Erika",
    "last_name": "Muster",
    "email": "erika@example.com",
    "message": "Hallo EquiCrew!",
    "website": "",
}


def assert_shared_error(body: dict, code: str) -> None:
    assert set(body) == {"error"}
    assert body["error"]["code"] == code
    assert isinstance(body["error"]["message"], str)
    assert body["error"]["message"]


def test_health_answers_200_without_smtp_config(client: TestClient) -> None:
    settings: Settings = client.app.state.settings
    assert settings.smtp_configured is False

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_module_app_boots_without_smtp_config(clean_env: pytest.MonkeyPatch) -> None:
    from app.main import app

    with TestClient(app) as test_client:
        assert test_client.get("/api/health").status_code == 200


def test_contact_route_is_registered_as_post(client: TestClient) -> None:
    app: FastAPI = client.app
    # Read from the route table and the OpenAPI schema, never from a response.
    contact_routes = [
        route
        for route in contact.router.routes
        if isinstance(route, APIRoute) and route.path == "/api/contact"
    ]
    assert contact_routes, "the contact router declares no /api/contact route"
    assert "POST" in contact_routes[0].methods
    assert app.url_path_for(contact_routes[0].name) == "/api/contact"
    assert "post" in app.openapi()["paths"]["/api/contact"]


def test_app_state_holds_settings_and_shared_rate_limiter(client: TestClient) -> None:
    assert isinstance(client.app.state.settings, Settings)
    assert client.app.state.rate_limiter is get_rate_limiter()


def test_foreign_origin_gets_no_cors_allow_header(client: TestClient) -> None:
    response = client.get("/api/health", headers={"Origin": FOREIGN_ORIGIN})

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_foreign_origin_preflight_is_refused(client: TestClient) -> None:
    response = client.options(
        "/api/contact",
        headers={
            "Origin": FOREIGN_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert "access-control-allow-origin" not in response.headers


def test_configured_origin_is_allowed_without_credentials(client: TestClient) -> None:
    response = client.get("/api/health", headers={"Origin": WEB_ORIGIN})

    assert response.headers["access-control-allow-origin"] == WEB_ORIGIN
    assert "access-control-allow-credentials" not in response.headers

    preflight = client.options(
        "/api/contact",
        headers={
            "Origin": WEB_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == WEB_ORIGIN
    assert preflight.headers.get("access-control-allow-origin") != "*"


def test_without_cors_origin_no_origin_is_allowed() -> None:
    app = create_app(Settings())
    with TestClient(app) as test_client:
        response = test_client.get("/api/health", headers={"Origin": WEB_ORIGIN})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_unhandled_exception_yields_error_body_without_traceback(
    clean_env: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    app = create_app(get_settings())

    @app.get("/api/boom")
    async def boom() -> None:
        raise RuntimeError(SECRET_TEXT)

    with TestClient(app, raise_server_exceptions=False) as test_client:
        response = test_client.get("/api/boom", headers={"Origin": WEB_ORIGIN})

    assert response.status_code == 500
    body = response.json()
    assert_shared_error(body, "internal_error")
    assert "fields" not in body["error"]
    assert "Traceback" not in response.text
    assert "RuntimeError" not in response.text
    assert SECRET_TEXT not in response.text
    # The error keeps its CORS header, so the browser can read it.
    assert response.headers["access-control-allow-origin"] == WEB_ORIGIN
    # ... and the cause is logged on the server.
    assert SECRET_TEXT in caplog.text


def test_api_error_is_rendered_in_shared_body(clean_env: pytest.MonkeyPatch) -> None:
    app = create_app(get_settings())

    @app.get("/api/unavailable")
    async def unavailable() -> None:
        raise ApiError(503, "mail_unavailable", "Der Versand ist gerade nicht möglich.")

    with TestClient(app) as test_client:
        response = test_client.get("/api/unavailable")

    assert response.status_code == 503
    assert response.json() == {
        "error": {"code": "mail_unavailable", "message": "Der Versand ist gerade nicht möglich."}
    }


def test_unknown_path_answers_shared_404(client: TestClient) -> None:
    response = client.get("/api/does-not-exist")

    assert response.status_code == 404
    assert_shared_error(response.json(), "not_found")


def test_request_validation_error_has_german_field_messages(
    clean_env: pytest.MonkeyPatch,
) -> None:
    app = create_app(get_settings())

    @app.post("/api/validate")
    async def validate(payload: ContactMessage) -> dict[str, bool]:
        return {"ok": True}

    invalid = {**VALID_FORM, "first_name": "", "email": "no-mail"}
    del invalid["message"]
    with TestClient(app) as test_client:
        response = test_client.post("/api/validate", json=invalid)
        accepted = test_client.post("/api/validate", json=VALID_FORM)

    assert response.status_code == 422
    body = response.json()
    assert_shared_error(body, "validation_error")
    assert set(body["error"]["fields"]) == {"first_name", "email", "message"}
    assert all(isinstance(text, str) and text for text in body["error"]["fields"].values())
    assert accepted.status_code == 200


@pytest.mark.parametrize("field", ["first_name", "last_name", "email"])
def test_contact_message_rejects_line_breaks_in_header_fields(field: str) -> None:
    value = "erika@example.com\r\nBcc: x@example.com" if field == "email" else "Erika\nBcc: x"
    with pytest.raises(ValueError):
        ContactMessage(**{**VALID_FORM, field: value})


def test_contact_message_limits_message_length() -> None:
    assert ContactMessage(**{**VALID_FORM, "message": "a" * 5000}).message == "a" * 5000
    with pytest.raises(ValueError):
        ContactMessage(**{**VALID_FORM, "message": "a" * 5001})


def test_refused_rate_limit_answers_429(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_rate_limiter(), "allow", lambda key: False)

    response = client.post("/api/contact", json=VALID_FORM)

    assert response.status_code == 429
    body = response.json()
    assert_shared_error(body, "rate_limited")
    assert "zu viele anfragen" in body["error"]["message"].lower()


def test_load_settings_defaults_and_env_names() -> None:
    empty = load_settings({})
    assert empty.smtp_configured is False
    assert empty.contact_to == DEFAULT_CONTACT_TO
    assert empty.smtp_port == 587
    assert empty.cors_origin is None
    assert empty.max_body_bytes >= 65536

    full = load_settings(
        {
            "SMTP_HOST": "mail.example.com",
            "SMTP_PORT": "465",
            "SMTP_USER": "user",
            "SMTP_PASSWORD": "pw",
            "SMTP_FROM": "web@example.com",
            "CONTACT_TO": "inbox@example.com",
            "CORS_ORIGIN": WEB_ORIGIN,
        }
    )
    assert full.smtp_configured is True
    assert full.smtp_port == 465
    assert full.contact_to == "inbox@example.com"
    assert full.cors_origin == WEB_ORIGIN


def test_invalid_smtp_port_names_the_variable() -> None:
    with pytest.raises(ValueError, match="SMTP_PORT"):
        load_settings({"SMTP_PORT": "not-a-port"})
