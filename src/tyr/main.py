"""Tyr — saga coordinator FastAPI application."""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response

from tyr.config import Settings
from tyr.infrastructure.database import database_pool

logger = logging.getLogger(__name__)


def _configure_logging(settings: Settings) -> None:
    """Configure structured logging based on settings."""
    logging.basicConfig(
        level=getattr(logging, settings.logging.level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s [%(correlation_id)s] %(message)s"
        if settings.logging.format == "text"
        else "%(message)s",
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create and configure the FastAPI application."""
    if settings is None:
        settings = Settings()

    _configure_logging(settings)

    app = FastAPI(
        title="Tyr — Saga Coordinator",
        description="Decomposes specs into sagas, phases, and raids.",
        version="0.1.0",
    )

    app.state.settings = settings

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        """Manage application lifecycle."""
        settings = app.state.settings
        async with database_pool(settings.database) as pool:
            app.state.pool = pool
            logger.info("Tyr started — database pool ready")
            yield
            logger.info("Tyr shutting down")

    app.router.lifespan_context = lifespan

    @app.middleware("http")
    async def correlation_id_middleware(request: Request, call_next):  # noqa: ANN001
        """Attach a correlation ID to every request."""
        correlation_id = request.headers.get("X-Correlation-ID", str(uuid.uuid4()))
        request.state.correlation_id = correlation_id
        response: Response = await call_next(request)
        response.headers["X-Correlation-ID"] = correlation_id
        return response

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()


def main() -> None:
    """Run the Tyr API server."""
    import uvicorn

    uvicorn.run("tyr.main:app", host="0.0.0.0", port=8001, reload=True)  # noqa: S104


if __name__ == "__main__":
    main()
