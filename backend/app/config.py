"""Runtime configuration, read from the environment.

Everything here is read lazily (inside ``load_settings``), never at import time, and
every value has a working default: the API boots without any SMTP variable and then
answers contact submissions with 503 instead of crashing.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass

DEFAULT_CONTACT_TO = "office@equicrew.com"
DEFAULT_SMTP_PORT = 587
DEFAULT_MAX_BODY_BYTES = 65536


@dataclass(frozen=True)
class Settings:
    """The API's configuration. ``smtp_*`` values are external and may be missing."""

    smtp_host: str | None = None
    smtp_port: int = DEFAULT_SMTP_PORT
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None
    contact_to: str = DEFAULT_CONTACT_TO
    cors_origin: str | None = None
    max_body_bytes: int = DEFAULT_MAX_BODY_BYTES

    @property
    def smtp_configured(self) -> bool:
        """True when enough SMTP configuration exists to attempt sending a mail."""
        return bool(self.smtp_host and self.smtp_from)


def _optional(env: Mapping[str, str], name: str) -> str | None:
    """Return the stripped value of ``name``, or None when it is unset or blank."""
    value = env.get(name)
    if value is None:
        return None
    value = value.strip()
    return value or None


def _port(env: Mapping[str, str], name: str, default: int) -> int:
    raw = _optional(env, name)
    if raw is None:
        return default
    try:
        port = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a whole number between 1 and 65535") from exc
    if not 1 <= port <= 65535:
        raise ValueError(f"{name} must be a whole number between 1 and 65535")
    return port


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    """Build ``Settings`` from the environment (or the given mapping, for tests)."""
    source: Mapping[str, str] = os.environ if env is None else env
    return Settings(
        smtp_host=_optional(source, "SMTP_HOST"),
        smtp_port=_port(source, "SMTP_PORT", DEFAULT_SMTP_PORT),
        smtp_user=_optional(source, "SMTP_USER"),
        smtp_password=_optional(source, "SMTP_PASSWORD"),
        smtp_from=_optional(source, "SMTP_FROM"),
        contact_to=_optional(source, "CONTACT_TO") or DEFAULT_CONTACT_TO,
        cors_origin=_optional(source, "CORS_ORIGIN"),
    )


def get_settings() -> Settings:
    """Read the current settings from the process environment."""
    return load_settings()
