"""FastAPI application of the EquiCrew contact API.

Start: ``uvicorn app.main:app --host 0.0.0.0 --port $PORT`` from inside ``backend/``.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import contact
from app.config import Settings, get_settings
from app.errors import install_error_handlers
from app.ratelimit import get_rate_limiter
from app.schemas import HealthStatus

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the API. Without ``settings`` the configuration is read from the env."""
    resolved = settings if settings is not None else get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        current: Settings = app.state.settings
        if current.smtp_configured:
            logger.info("SMTP is configured; contact messages go to the office mailbox")
        else:
            logger.warning(
                "SMTP is not configured (SMTP_HOST/SMTP_FROM missing): "
                "POST /api/contact answers 503"
            )
        if current.cors_origin is None:
            logger.warning("CORS_ORIGIN is not set: no browser origin may call the API")
        yield

    app = FastAPI(title="EquiCrew Kontakt-API", lifespan=lifespan)
    app.state.settings = resolved
    app.state.rate_limiter = get_rate_limiter()

    # Order matters: middleware added later wraps the earlier one. The error
    # handling is installed first so that every error response, a 500 included,
    # passes through CORS and keeps its Access-Control-Allow-Origin header.
    install_error_handlers(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[resolved.cors_origin] if resolved.cors_origin else [],
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @app.get("/api/health", response_model=HealthStatus)
    async def health() -> HealthStatus:
        """Liveness probe; answers 200 with or without SMTP configuration."""
        return HealthStatus()

    app.include_router(contact.router)
    return app


app = create_app()
