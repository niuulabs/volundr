"""Tyr — saga coordinator FastAPI application."""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response

from tyr.api.tracker import create_tracker_router
from tyr.config import Settings
from tyr.infrastructure.database import database_pool
from tyr.ports.tracker import TrackerPort

logger = logging.getLogger(__name__)


def _create_tracker_adapter(settings: Settings) -> TrackerPort | None:
    """Create a tracker adapter from config using dynamic import.

    Returns None if no adapter is configured (e.g. no team_id).
    """
    cfg = settings.tracker
    if not cfg.team_id:
        logger.info("No tracker team_id configured, tracker browsing disabled")
        return None

    try:
        import importlib

        module_path, class_name = cfg.adapter.rsplit(".", 1)
        module = importlib.import_module(module_path)
        cls = getattr(module, class_name)

        # api_key comes from env for now (TRACKER__API_KEY would need
        # to be added to config, or resolved from credential store)
        import os

        api_key = os.environ.get("LINEAR_API_KEY", "")
        if not api_key:
            logger.warning("LINEAR_API_KEY not set, tracker adapter may fail")

        return cls(
            api_key=api_key,
            team_id=cfg.team_id,
            cache_ttl=cfg.cache_ttl_seconds,
            max_retries=cfg.rate_limit_max_retries,
        )
    except Exception:
        logger.exception("Failed to create tracker adapter")
        return None


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

    # -- Wire tracker adapter --
    tracker_adapter = _create_tracker_adapter(settings)
    if tracker_adapter:
        app.include_router(create_tracker_router(tracker_adapter))

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        """Manage application lifecycle."""
        settings = app.state.settings
        async with database_pool(settings.database) as pool:
            app.state.pool = pool
            logger.info("Tyr started — database pool ready")
            yield
            if tracker_adapter and hasattr(tracker_adapter, "close"):
                await tracker_adapter.close()
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


def main() -> None:  # pragma: no cover
    """Run the Tyr API server."""
    import os

    import uvicorn

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8081"))
    workers = int(os.environ.get("WORKERS", "4"))

    uvicorn.run(
        "tyr.main:app",
        host=host,
        port=port,
        workers=workers,
        access_log=False,
    )


if __name__ == "__main__":  # pragma: no cover
    main()
