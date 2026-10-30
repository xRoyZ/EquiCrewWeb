"""Tests of POST /api/contact with the mail sender overridden."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import contact
from app.config import Settings
from app.contact import get_mail_sender
from app.mailer import MailNotConfiguredError, MailSendError
from app.main import create_app
from app.ratelimit import RateLimiter
from app.schemas import ContactMessage

SMTP_SETTINGS = Settings(
    smtp_host="smtp.internal.example",
    smtp_user="mailer-user",
    smtp_password="very-secret-password",
    smtp_from="web@equicrew.example",
)
RAW_SMTP_ERROR = "535 5.7.8 auth failed for mailer-user at smtp.internal.example"

VALID_FORM = {
    "first_name": "Erika",
    "last_name": "Muster",
    "email": "erika@example.com",
    "message": "Hallo EquiCrew, ich interessiere mich für den EquiCube.",
    "website": "",
}


class RecordingSender:
    """A mail sender that records its calls and optionally raises."""

    def __init__(self, error: Exception | None = None) -> None:
        self.calls: list[tuple[ContactMessage, Settings]] = []
        self.error = error

    def __call__(self, message: ContactMessage, settings: Settings) -> None:
        self.calls.append((message, settings))
        if self.error is not None:
            raise self.error


def make_client(
    sender: RecordingSender | None, settings: Settings = SMTP_SETTINGS
) -> Iterator[TestClient]:
    app: FastAPI = create_app(settings)
    if sender is not None:
        app.dependency_overrides[get_mail_sender] = lambda: sender
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def generous_rate_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    """Give every test its own limiter so the many posts here are never throttled."""
    limiter = RateLimiter(max_requests=1_000_000)
    monkeypatch.setattr(contact, "get_rate_limiter", lambda: limiter)


@pytest.fixture
def sender() -> RecordingSender:
    return RecordingSender()


@pytest.fixture
def client(sender: RecordingSender) -> Iterator[TestClient]:
    yield from make_client(sender)


def assert_error(response, status: int, code: str) -> dict:
    assert response.status_code == status
    body = response.json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == code
    assert body["error"]["message"]
    return body["error"]


def test_valid_submission_sends_once_with_the_submitted_values(
    client: TestClient, sender: RecordingSender
) -> None:
    response = client.post("/api/contact", json=VALID_FORM)

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert len(sender.calls) == 1
    message, settings = sender.calls[0]
    assert message.first_name == "Erika"
    assert message.last_name == "Muster"
    assert message.email == "erika@example.com"
    assert message.message == VALID_FORM["message"]
    assert settings.contact_to == "office@equicrew.com"


def test_message_of_exactly_5000_characters_is_accepted(
    client: TestClient, sender: RecordingSender
) -> None:
    response = client.post("/api/contact", json={**VALID_FORM, "message": "a" * 5000})

    assert response.status_code == 200
    assert len(sender.calls) == 1


@pytest.mark.parametrize("field", ["first_name", "last_name", "email", "message"])
def test_missing_field_answers_422_with_german_message(
    client: TestClient, sender: RecordingSender, field: str
) -> None:
    form = {key: value for key, value in VALID_FORM.items() if key != field}

    error = assert_error(client.post("/api/contact", json=form), 422, "validation_error")

    assert set(error["fields"]) == {field}
    assert error["fields"][field].startswith("Bitte gib")
    assert sender.calls == []


@pytest.mark.parametrize("field", ["first_name", "last_name", "message"])
def test_blank_field_answers_422(client: TestClient, sender: RecordingSender, field: str) -> None:
    error = assert_error(
        client.post("/api/contact", json={**VALID_FORM, field: "   "}), 422, "validation_error"
    )

    assert field in error["fields"]
    assert sender.calls == []


def test_missing_email_names_the_field_in_german(client: TestClient) -> None:
    form = {key: value for key, value in VALID_FORM.items() if key != "email"}

    error = assert_error(client.post("/api/contact", json=form), 422, "validation_error")

    assert error["fields"] == {"email": "Bitte gib deine E-Mail-Adresse ein."}


@pytest.mark.parametrize("email", ["keine-adresse", "erika@", "@example.com", "erika example.com"])
def test_invalid_email_answers_422(client: TestClient, sender: RecordingSender, email: str) -> None:
    error = assert_error(
        client.post("/api/contact", json={**VALID_FORM, "email": email}), 422, "validation_error"
    )

    assert error["fields"] == {"email": "Bitte gib eine gültige E-Mail-Adresse ein."}
    assert sender.calls == []


def test_message_over_5000_characters_answers_422(
    client: TestClient, sender: RecordingSender
) -> None:
    error = assert_error(
        client.post("/api/contact", json={**VALID_FORM, "message": "a" * 5001}),
        422,
        "validation_error",
    )

    assert "5000" in error["fields"]["message"]
    assert sender.calls == []


@pytest.mark.parametrize("field", ["first_name", "last_name"])
def test_name_over_100_characters_answers_422(
    client: TestClient, sender: RecordingSender, field: str
) -> None:
    error = assert_error(
        client.post("/api/contact", json={**VALID_FORM, field: "a" * 101}),
        422,
        "validation_error",
    )

    assert "100" in error["fields"][field]
    assert sender.calls == []


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("first_name", "Erika\r\nBcc: victim@example.com"),
        ("last_name", "Muster\nBcc: victim@example.com"),
        ("email", "erika@example.com\r\nBcc: victim@example.com"),
        ("email", "erika@example.com\n"),
        ("first_name", "Erika\r"),
    ],
)
def test_line_breaks_in_header_fields_answer_422(
    client: TestClient, sender: RecordingSender, field: str, value: str
) -> None:
    error = assert_error(
        client.post("/api/contact", json={**VALID_FORM, field: value}), 422, "validation_error"
    )

    assert field in error["fields"]
    assert sender.calls == []


def test_line_breaks_in_the_message_are_allowed(
    client: TestClient, sender: RecordingSender
) -> None:
    response = client.post("/api/contact", json={**VALID_FORM, "message": "Zeile 1\r\nZeile 2"})

    assert response.status_code == 200
    assert len(sender.calls) == 1


@pytest.mark.parametrize("body", [b"not json", b"[1, 2]", b"\xff\xfe"])
def test_unparseable_body_answers_422(
    client: TestClient, sender: RecordingSender, body: bytes
) -> None:
    response = client.post(
        "/api/contact", content=body, headers={"Content-Type": "application/json"}
    )

    assert_error(response, 422, "validation_error")
    assert sender.calls == []


def test_filled_honeypot_answers_success_without_sending(
    client: TestClient, sender: RecordingSender
) -> None:
    response = client.post("/api/contact", json={**VALID_FORM, "website": "https://spam.example"})

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert sender.calls == []


def test_oversized_body_answers_413_without_sending(
    client: TestClient, sender: RecordingSender
) -> None:
    response = client.post("/api/contact", json={**VALID_FORM, "message": "a" * 70_000})

    assert_error(response, 413, "payload_too_large")
    assert sender.calls == []


def test_oversized_streamed_body_without_content_length_answers_413(
    client: TestClient, sender: RecordingSender
) -> None:
    def chunks() -> Iterator[bytes]:
        for _ in range(20):
            yield b"a" * 8192

    response = client.post(
        "/api/contact", content=chunks(), headers={"Content-Type": "application/json"}
    )

    assert "content-length" not in response.request.headers
    assert_error(response, 413, "payload_too_large")
    assert sender.calls == []


def test_without_smtp_config_answers_503() -> None:
    # The real mail sender runs: the settings carry no SMTP configuration at all.
    for test_client in make_client(None, Settings()):
        response = test_client.post("/api/contact", json=VALID_FORM)

        error = assert_error(response, 503, "mail_unavailable")
        assert "office@equicrew.com" in error["message"]
        assert "fields" not in error


def test_sender_reporting_missing_config_answers_503() -> None:
    sender = RecordingSender(MailNotConfiguredError("SMTP_HOST missing"))
    for test_client in make_client(sender):
        response = test_client.post("/api/contact", json=VALID_FORM)

        assert_error(response, 503, "mail_unavailable")
        assert "SMTP_HOST" not in response.text


def test_send_failure_answers_500_without_raw_error_text() -> None:
    sender = RecordingSender(MailSendError(RAW_SMTP_ERROR))
    for test_client in make_client(sender):
        response = test_client.post("/api/contact", json=VALID_FORM)

        assert_error(response, 500, "mail_failed")
        assert len(sender.calls) == 1
        for secret in (
            RAW_SMTP_ERROR,
            "535",
            "smtp.internal.example",
            "mailer-user",
            "very-secret-password",
            "Traceback",
            "MailSendError",
        ):
            assert secret not in response.text
