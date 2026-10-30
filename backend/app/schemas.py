"""Request and response models of the contact API."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

MAX_NAME_LENGTH = 100
MAX_EMAIL_LENGTH = 254
MAX_MESSAGE_LENGTH = 5000


class ContactMessage(BaseModel):
    """One contact form submission.

    Names and email end up in mail headers, so a CR or LF in them is rejected: a
    submission can never add a header (e.g. Bcc) or another recipient.
    ``website`` is the honeypot field; real visitors never fill it.
    """

    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    first_name: str = Field(min_length=1, max_length=MAX_NAME_LENGTH)
    last_name: str = Field(min_length=1, max_length=MAX_NAME_LENGTH)
    email: EmailStr = Field(max_length=MAX_EMAIL_LENGTH)
    message: str = Field(min_length=1, max_length=MAX_MESSAGE_LENGTH)
    website: str = ""

    @field_validator("first_name", "last_name", "email", mode="before")
    @classmethod
    def _reject_line_breaks(cls, value: object) -> object:
        if isinstance(value, str) and ("\r" in value or "\n" in value):
            raise ValueError("line breaks are not allowed in this field")
        return value


class ContactAccepted(BaseModel):
    """The success answer of POST /api/contact."""

    ok: bool = True


class HealthStatus(BaseModel):
    """The answer of GET /api/health."""

    status: str = "ok"
