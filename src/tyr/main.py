"""Tyr — saga coordinator FastAPI application."""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request, Response

from niuu.adapters.postgres_integrations import PostgresIntegrationRepository
from niuu.domain.models import Principal
from niuu.utils import import_class, resolve_secret_kwargs
from tyr.adapters.inbound.rest_integrations import (
    create_integrations_router,
    create_telegram_setup_router,
)
from tyr.adapters.inbound.rest_pats import create_pats_router
from tyr.adapters.postgres_dispatcher import PostgresDispatcherRepository
from tyr.adapters.postgres_sagas import PostgresSagaRepository
from tyr.adapters.tracker_factory import TrackerAdapterFactory
from tyr.adapters.volundr_factory import VolundrAdapterFactory
from tyr.adapters.volundr_http import VolundrHTTPAdapter
from tyr.api.dispatch import create_dispatch_router, resolve_volundr
from tyr.api.dispatch import resolve_saga_repo as dispatch_resolve_saga_repo
from tyr.api.dispatcher import create_dispatcher_router, resolve_dispatcher_repo
from tyr.api.sagas import create_sagas_router, resolve_saga_repo
from tyr.api.tracker import create_tracker_router, resolve_trackers
from tyr.config import Settings
from tyr.infrastructure.database import database_pool
from tyr.ports.dispatcher_repository import DispatcherRepository
from tyr.ports.saga_repository import SagaRepository
from tyr.ports.tracker import TrackerPort
from tyr.ports.volundr import VolundrPort

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

    # -- Routers --
    app.include_router(create_tracker_router())
    app.include_router(create_sagas_router())
    app.include_router(create_dispatch_router())
    app.include_router(create_dispatcher_router())
    app.include_router(create_pats_router())
    app.include_router(create_integrations_router())
    app.include_router(
        create_telegram_setup_router(
            telegram_bot_username=settings.telegram.bot_username,
            telegram_hmac_key=settings.telegram.hmac_key,
        )
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        """Manage application lifecycle."""
        settings = app.state.settings
        async with database_pool(settings.database) as pool:
            app.state.pool = pool

            # Wire shared credential/integration infrastructure
            integration_repo = PostgresIntegrationRepository(pool)

            cs_cfg = settings.credential_store
            cs_cls = import_class(cs_cfg.adapter)
            cs_kwargs = resolve_secret_kwargs(cs_cfg.kwargs, cs_cfg.secret_kwargs_env)
            credential_store = cs_cls(**cs_kwargs)
            logger.info("Credential store: %s", cs_cfg.adapter.rsplit(".", 1)[-1])

            # Expose shared infrastructure on app.state for REST routers
            app.state.integration_repo = integration_repo
            app.state.credential_store = credential_store

            # Wire adapter factories (used by autonomous dispatcher)
            app.state.volundr_factory = VolundrAdapterFactory(integration_repo, credential_store)
            app.state.tracker_factory = TrackerAdapterFactory(integration_repo, credential_store)

            # Override the tracker resolver dependency with factory delegation
            from tyr.adapters.inbound.auth import extract_principal

            async def _resolve(
                principal: Principal = Depends(extract_principal),
            ) -> list[TrackerPort]:
                return await app.state.tracker_factory.for_owner(principal.user_id)

            app.dependency_overrides[resolve_trackers] = _resolve

            # Wire saga repository
            saga_repo = PostgresSagaRepository(pool)
            app.state.saga_repo = saga_repo

            async def _resolve_saga_repo() -> SagaRepository:
                return saga_repo

            app.dependency_overrides[resolve_saga_repo] = _resolve_saga_repo
            app.dependency_overrides[dispatch_resolve_saga_repo] = _resolve_saga_repo

            # Wire dispatcher repository
            dispatcher_repo = PostgresDispatcherRepository(pool)

            async def _resolve_dispatcher_repo() -> DispatcherRepository:
                return dispatcher_repo

            app.dependency_overrides[resolve_dispatcher_repo] = _resolve_dispatcher_repo

            # Wire Volundr adapter
            volundr_adapter = VolundrHTTPAdapter(settings.volundr.url)

            async def _resolve_volundr() -> VolundrPort:
                return volundr_adapter

            app.dependency_overrides[resolve_volundr] = _resolve_volundr

            # Wire personal access token service
            from tyr.adapters.postgres_pats import PostgresPATRepository
            from tyr.domain.services.pat import PATService

            pat_repo = PostgresPATRepository(pool)
            pat_service = PATService(
                repo=pat_repo,
                signing_key=settings.auth.pat_signing_key,
                ttl_days=settings.auth.pat_ttl_days,
            )
            app.state.pat_service = pat_service

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
