"""Tyr — saga coordinator FastAPI application."""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request, Response

from niuu.adapters.pat_revocation_middleware import PATRevocationMiddleware
from niuu.adapters.postgres_integrations import PostgresIntegrationRepository
from niuu.domain.models import Principal
from niuu.domain.services.pat_validator import PATValidator
from niuu.utils import import_class, resolve_secret_kwargs
from tyr.adapters.github_git import GitHubGitAdapter
from tyr.adapters.inbound.rest_integrations import (
    create_integrations_router,
    create_telegram_setup_router,
)
from tyr.adapters.inbound.rest_pats import create_pats_router
from tyr.adapters.inbound.rest_telegram_webhook import create_telegram_webhook_router
from tyr.adapters.notification_channel_factory import NotificationChannelFactory
from tyr.adapters.postgres_dispatcher import PostgresDispatcherRepository
from tyr.adapters.postgres_notification_subscriptions import (
    PostgresNotificationSubscriptionRepository,
)
from tyr.adapters.postgres_sagas import PostgresSagaRepository
from tyr.adapters.tracker_factory import TrackerAdapterFactory
from tyr.adapters.volundr_factory import VolundrAdapterFactory
from tyr.adapters.volundr_http import VolundrHTTPAdapter
from tyr.api.dispatch import create_dispatch_router, resolve_volundr, resolve_volundr_factory
from tyr.api.dispatch import resolve_saga_repo as dispatch_resolve_saga_repo
from tyr.api.dispatcher import create_dispatcher_router, resolve_dispatcher_repo
from tyr.api.dispatcher import resolve_event_bus as dispatcher_resolve_event_bus
from tyr.api.events import create_events_router, resolve_event_bus
from tyr.api.health import create_health_router
from tyr.api.raids import create_raids_router, resolve_git, resolve_raid_repo
from tyr.api.raids import resolve_tracker as resolve_raids_tracker
from tyr.api.raids import resolve_volundr as resolve_raids_volundr
from tyr.api.sagas import create_sagas_router, resolve_llm, resolve_saga_repo
from tyr.api.sagas import resolve_git as sagas_resolve_git
from tyr.api.sagas import resolve_volundr as sagas_resolve_volundr
from tyr.api.tracker import create_tracker_router, resolve_trackers
from tyr.config import Settings
from tyr.domain.services.activity_subscriber import SessionActivitySubscriber
from tyr.domain.services.notification import NotificationService
from tyr.domain.services.review_engine import ReviewEngine
from tyr.infrastructure.database import database_pool
from tyr.ports.dispatcher_repository import DispatcherRepository
from tyr.ports.event_bus import EventBusPort
from tyr.ports.git import GitPort
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
    # Silence noisy loggers
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


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
    app.include_router(create_health_router())
    app.include_router(create_tracker_router())
    app.include_router(create_sagas_router())
    app.include_router(create_raids_router())
    app.include_router(create_dispatch_router())
    app.include_router(create_dispatcher_router())
    app.include_router(create_events_router(settings.events.keepalive_interval))
    from tyr.adapters.inbound.auth import extract_principal as _extract_principal

    app.include_router(create_pats_router(_extract_principal))
    app.include_router(create_integrations_router())
    app.include_router(
        create_telegram_setup_router(
            telegram_bot_username=settings.telegram.bot_username,
            telegram_hmac_key=settings.telegram.hmac_key,
            telegram_hmac_sig_length=settings.telegram.hmac_signature_length,
        )
    )
    app.include_router(create_telegram_webhook_router())

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
            app.state.volundr_factory = VolundrAdapterFactory(
                integration_repo, credential_store, fallback_url=settings.volundr.url
            )
            app.state.tracker_factory = TrackerAdapterFactory(
                integration_repo, credential_store, pool=pool
            )

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
            app.dependency_overrides[resolve_raid_repo] = _resolve_saga_repo

            # Wire notification subscription repository (Telegram webhook auth)
            notification_sub_repo = PostgresNotificationSubscriptionRepository(pool)
            app.state.notification_sub_repo = notification_sub_repo

            # Wire dispatcher repository
            dispatcher_repo = PostgresDispatcherRepository(pool)
            app.state.dispatcher_repo = dispatcher_repo

            async def _resolve_dispatcher_repo() -> DispatcherRepository:
                return dispatcher_repo

            app.dependency_overrides[resolve_dispatcher_repo] = _resolve_dispatcher_repo

            # Wire Volundr adapter — per-user resolution via factory,
            # falling back to the global URL when no per-user connection exists.
            fallback_volundr = VolundrHTTPAdapter(settings.volundr.url, name="default")
            app.state.volundr = fallback_volundr

            async def _resolve_volundr_per_user(
                principal: Principal = Depends(extract_principal),
            ) -> VolundrPort:
                adapter = await app.state.volundr_factory.primary_for_owner(principal.user_id)
                return adapter or fallback_volundr

            app.dependency_overrides[resolve_volundr] = _resolve_volundr_per_user
            app.dependency_overrides[resolve_raids_volundr] = _resolve_volundr_per_user
            app.dependency_overrides[sagas_resolve_volundr] = _resolve_volundr_per_user

            async def _resolve_factory() -> VolundrAdapterFactory:
                return app.state.volundr_factory

            app.dependency_overrides[resolve_volundr_factory] = _resolve_factory

            # Wire Git adapter
            git_adapter = GitHubGitAdapter(settings.git.token)

            async def _resolve_git() -> GitPort:
                return git_adapter

            app.dependency_overrides[resolve_git] = _resolve_git
            app.dependency_overrides[sagas_resolve_git] = _resolve_git

            # Wire tracker for raids (uses first available tracker)
            async def _resolve_raids_tracker_dep(
                principal: Principal = Depends(extract_principal),
            ) -> TrackerPort:
                trackers = await app.state.tracker_factory.for_owner(principal.user_id)
                if not trackers:
                    from fastapi import HTTPException, status

                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="No tracker configured",
                    )
                return trackers[0]

            app.dependency_overrides[resolve_raids_tracker] = _resolve_raids_tracker_dep

            # Wire personal access token service
            from tyr.adapters.postgres_pats import PostgresPATRepository
            from tyr.domain.services.pat import PATService

            pat_repo = PostgresPATRepository(pool)

            # Wire PAT revocation validator
            pat_validator = PATValidator(
                repo=pat_repo,
                cache_ttl=settings.pat.revocation_cache_ttl,
                revoked_cache_ttl=settings.pat.revoked_cache_ttl,
            )
            app.state.pat_validator = pat_validator

            # Resolve the token issuer (IDP adapter) via dynamic import
            token_issuer_cls = import_class(settings.pat.token_issuer_adapter)
            token_issuer = token_issuer_cls(**settings.pat.token_issuer_kwargs)

            pat_service = PATService(
                repo=pat_repo,
                token_issuer=token_issuer,
                ttl_days=settings.pat.ttl_days,
                validator=pat_validator,
            )
            app.state.pat_service = pat_service

            # Wire event bus (dynamic adapter pattern)
            eb_cfg = settings.event_bus
            eb_cls = import_class(eb_cfg.adapter)
            eb_kwargs = {
                "max_clients": settings.events.max_sse_clients,
                "log_size": settings.events.activity_log_size,
                **eb_cfg.kwargs,
            }
            event_bus: EventBusPort = eb_cls(**eb_kwargs)
            app.state.event_bus = event_bus
            logger.info("Event bus: %s", eb_cfg.adapter.rsplit(".", 1)[-1])

            async def _resolve_event_bus() -> EventBusPort:
                return event_bus

            app.dependency_overrides[resolve_event_bus] = _resolve_event_bus
            app.dependency_overrides[dispatcher_resolve_event_bus] = _resolve_event_bus

            # Wire Telegram reply client (shared httpx.AsyncClient)
            from tyr.adapters.inbound.rest_telegram_webhook import (
                TelegramReplyClient,
            )

            telegram_reply_client = TelegramReplyClient(
                bot_token=settings.telegram.bot_token,
                timeout=settings.telegram.reply_timeout,
            )
            app.state.telegram_reply_client = telegram_reply_client

            # Wire LLM adapter (dynamic adapter pattern)
            from tyr.ports.llm import LLMPort as _LLMPort

            llm_cfg = settings.llm
            llm_cls = import_class(llm_cfg.adapter)
            llm_kwargs = resolve_secret_kwargs(llm_cfg.kwargs, llm_cfg.secret_kwargs_env)
            llm_kwargs.setdefault("min_estimate_hours", llm_cfg.min_estimate_hours)
            llm_kwargs.setdefault("max_estimate_hours", llm_cfg.max_estimate_hours)
            llm_adapter = llm_cls(**llm_kwargs)
            logger.info("LLM adapter: %s", llm_cfg.adapter.rsplit(".", 1)[-1])

            async def _resolve_llm() -> _LLMPort:
                return llm_adapter

            app.dependency_overrides[resolve_llm] = _resolve_llm

            # Wire notification service
            channel_factory = NotificationChannelFactory(integration_repo, credential_store)
            app.state.channel_factory = channel_factory

            notification_service = NotificationService(
                event_bus=event_bus,
                channel_factory=channel_factory,
                confidence_threshold=settings.notification.confidence_threshold,
            )
            app.state.notification_service = notification_service
            if settings.notification.enabled:
                await notification_service.start()

            # Wire automated review engine (subscribes to raid.state_changed events)
            review_engine = ReviewEngine(
                tracker_factory=app.state.tracker_factory,
                volundr_factory=app.state.volundr_factory,
                git=git_adapter,
                review_config=settings.review,
                event_bus=event_bus,
            )
            app.state.review_engine = review_engine
            await review_engine.start()

            # Wire event-driven session completion subscriber
            # Uses VolundrAdapterFactory for per-owner authenticated SSE subscriptions
            subscriber = SessionActivitySubscriber(
                volundr_factory=app.state.volundr_factory,
                tracker_factory=app.state.tracker_factory,
                dispatcher_repo=dispatcher_repo,
                event_bus=event_bus,
                config=settings.watcher,
            )
            app.state.subscriber = subscriber
            await subscriber.start()

            logger.info("Tyr started — database pool ready")
            yield

            # Lifecycle cleanup
            await review_engine.stop()
            await notification_service.stop()
            await telegram_reply_client.close()
            if hasattr(llm_adapter, "close"):
                await llm_adapter.close()
            await subscriber.stop()
            logger.info("Tyr shutting down")

    app.router.lifespan_context = lifespan
    app.add_middleware(PATRevocationMiddleware)

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
