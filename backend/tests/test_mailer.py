"""Tests of the SMTP mailer with smtplib mocked: nothing leaves the process."""

from __future__ import annotations

import logging
import smtplib
from unittest.mock import MagicMock

import pytest

from app import mailer
from app.config import Settings
from app.mailer import MailNotConfiguredError, MailSendError, send_contact_mail
from app.schemas import ContactMessage

PASSWORD = "s3cret-pass-word"
SMTP_HOST = "smtp.mailhost.example"


def _message() -> ContactMessage:
    return ContactMessage(
        first_name="Erika",
        last_name="Musterfrau",
        email="erika.sender@example.org",
        message="Hallo, ich interessiere mich für den EquiCube.",
    )


def _settings(port: int = 587) -> Settings:
    return Settings(
        smtp_host=SMTP_HOST,
        smtp_port=port,
        smtp_user="mailer-user",
        smtp_password=PASSWORD,
        smtp_from="website@equicrew.com",
    )


@pytest.fixture
def smtp(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    """Replace smtplib.SMTP and SMTP_SSL; return the server mock both hand out."""
    server = MagicMock(name="server")
    server.__enter__.return_value = server
    server.__exit__.return_value = False
    server.has_extn.return_value = True
    factory = MagicMock(name="SMTP", return_value=server)
    ssl_factory = MagicMock(name="SMTP_SSL", return_value=server)
    monkeypatch.setattr(mailer.smtplib, "SMTP", factory)
    monkeypatch.setattr(mailer.smtplib, "SMTP_SSL", ssl_factory)
    server.factory = factory
    server.ssl_factory = ssl_factory
    return server


def test_not_configured_raises_and_sends_nothing(smtp: MagicMock) -> None:
    with pytest.raises(MailNotConfiguredError):
        send_contact_mail(_message(), Settings())
    smtp.factory.assert_not_called()
    smtp.ssl_factory.assert_not_called()


def test_sends_exactly_one_mail_with_reply_to_and_body(smtp: MagicMock) -> None:
    send_contact_mail(_message(), _settings())

    smtp.factory.assert_called_once()
    assert smtp.factory.call_args.kwargs.get("timeout")
    smtp.starttls.assert_called_once()
    smtp.login.assert_called_once_with("mailer-user", PASSWORD)
    smtp.send_message.assert_called_once()
    mail = smtp.send_message.call_args.args[0]
    assert mail["To"] == "office@equicrew.com"
    assert mail["From"] == "website@equicrew.com"
    assert mail["Reply-To"] == "erika.sender@example.org"
    assert "Erika" in mail["Subject"] and "Musterfrau" in mail["Subject"]
    body = mail.get_content()
    for part in ("Erika", "Musterfrau", "erika.sender@example.org", "EquiCube"):
        assert part in body


def test_port_465_uses_implicit_tls(smtp: MagicMock) -> None:
    send_contact_mail(_message(), _settings(port=465))
    smtp.ssl_factory.assert_called_once()
    smtp.factory.assert_not_called()
    smtp.starttls.assert_not_called()
    smtp.send_message.assert_called_once()


def test_no_starttls_when_not_offered_and_no_login_without_credentials(
    smtp: MagicMock,
) -> None:
    smtp.has_extn.return_value = False
    settings = Settings(smtp_host=SMTP_HOST, smtp_from="website@equicrew.com")
    send_contact_mail(_message(), settings)
    smtp.starttls.assert_not_called()
    smtp.login.assert_not_called()
    smtp.send_message.assert_called_once()


@pytest.mark.parametrize(
    "error",
    [
        smtplib.SMTPAuthenticationError(535, b"5.7.8 bad credentials for mailer-user"),
        ConnectionRefusedError(f"cannot reach {SMTP_HOST}"),
    ],
)
def test_smtp_failure_raises_mail_send_error_without_raw_text(
    smtp: MagicMock, error: Exception
) -> None:
    smtp.send_message.side_effect = error
    with pytest.raises(MailSendError) as caught:
        send_contact_mail(_message(), _settings())
    text = str(caught.value)
    assert SMTP_HOST not in text
    assert "credentials" not in text
    assert caught.value.__cause__ is None


@pytest.mark.parametrize("fail", [False, True])
def test_log_lines_contain_no_personal_data_or_password(
    smtp: MagicMock, caplog: pytest.LogCaptureFixture, fail: bool
) -> None:
    if fail:
        smtp.send_message.side_effect = smtplib.SMTPServerDisconnected(
            f"lost {SMTP_HOST} for erika.sender@example.org"
        )
    caplog.set_level(logging.DEBUG, logger="app.mailer")
    if fail:
        with pytest.raises(MailSendError):
            send_contact_mail(_message(), _settings())
    else:
        send_contact_mail(_message(), _settings())

    records = [r for r in caplog.records if r.name == "app.mailer"]
    assert len(records) == 1
    line = records[0].getMessage()
    for secret in (
        "Erika",
        "Musterfrau",
        "erika.sender",
        "example.org",
        "EquiCube",
        PASSWORD,
        "mailer-user",
        SMTP_HOST,
        "office@",
    ):
        assert secret not in line
    assert "equicrew.com" in line
