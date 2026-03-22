"""Tyr — saga coordinator FastAPI application."""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response

from niuu.adapters.memory_credential_store import MemoryCredentialStore
from niuu.adapters.postgres_integrations import PostgresIntegrationRepository
from niuu.domain.models import IntegrationType
from niuu.ports.credentials import CredentialStorePort
from niuu.ports.integrations import IntegrationRepository
from niuu.utils import import_class
from tyr.api.tracker import create_tracker_router, resolve_trackers
from tyr.config import Settings
from tyr.infrastructure.database import database_pool
from tyr.ports.tracker import TrackerPort

logger = logging.getLogger(__name__)


def _configure_logging(settings: Settings) -> None:
    """Configure structured logging based on settings."""
    logging.basicConfig(
        level=getattr(logging, settings.logging.level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s [%(correlation_id)s] %(message)s"
        if settings.logging.format == "text"
        else "%(message)s",
    )


async def _resolve_tracker_adapters(
    request: Request,
    integration_repo: IntegrationRepository,
    credential_store: CredentialStorePort,
) -> list[TrackerPort]:
    """Resolve TrackerPort adapters from the user's integration credentials.

    Uses dynamic adapter pattern: config specifies fully-qualified class path,
    credentials + config are passed as **kwargs to the constructor.
    """
    user_id = request.headers.get("X-User-ID", "default")

    connections = await integration_repo.list_connections(
        user_id,
        integration_type=IntegrationType.ISSUE_TRACKER,
    )

    adapters: list[TrackerPort] = []
    for conn in connections:
        if not conn.enabled:
            continue
        try:
            cred = await credential_store.get_value(
                "user",
                conn.user_id,
                conn.credential_name,
            )
            if cred is None:
                continue

            cls = import_class(conn.adapter)
            kwargs = {**cred, **conn.config}
            adapter = cls(**kwargs)
            adapters.append(adapter)
        except Exception:
            logger.warning(
                "Failed to create tracker adapter for connection %s",
                conn.id,
                exc_info=True,
            )

    return adapters


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

    # -- Tracker browsing router --
    app.include_router(create_tracker_router())

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        """Manage application lifecycle."""
        settings = app.state.settings
        async with database_pool(settings.database) as pool:
            app.state.pool = pool

            # Wire shared credential/integration infrastructure
            integration_repo = PostgresIntegrationRepository(pool)
            credential_store = MemoryCredentialStore()

            # Override the tracker resolver dependency with real wiring
            async def _resolve(request: Request) -> list[TrackerPort]:
                return await _resolve_tracker_adapters(request, integration_repo, credential_store)

            app.dependency_overrides[resolve_trackers] = _resolve

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
