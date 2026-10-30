"""Shared fixtures: an app booted with no SMTP configuration at all."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app

SMTP_VARIABLES = ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM")
WEB_ORIGIN = "http://localhost:5500"


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    """Clear every SMTP variable and point CORS at a known web origin."""
    for name in SMTP_VARIABLES:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.delenv("CONTACT_TO", raising=False)
    monkeypatch.setenv("CORS_ORIGIN", WEB_ORIGIN)
    return monkeypatch


@pytest.fixture
def client(clean_env: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """A TestClient running the real lifespan of an app read from the cleared env."""
    app = create_app(get_settings())
    with TestClient(app) as test_client:
        yield test_client
