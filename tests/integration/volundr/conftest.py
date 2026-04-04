"""Volundr-specific integration test fixtures.

Provides ``volundr_app`` and ``volundr_client`` fixtures that stand up a
minimal FastAPI application with the specific routers under test, wired to
the transactional pool from the shared conftest.

Unlike the full ``create_app()`` lifespan (which starts background tasks,
spawns pods, etc.), this fixture manually constructs only the services and
routers needed for testing sessions, stats, prompts, and auth.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI

from volundr.adapters.inbound.rest import create_router as create_session_router
from volundr.adapters.inbound.rest_prompts import create_prompts_router
from volundr.adapters.outbound.broadcaster import InMemoryEventBroadcaster
from volundr.adapters.outbound.identity import EnvoyHeaderIdentityAdapter
from volundr.adapters.outbound.postgres import PostgresSessionRepository
from volundr.adapters.outbound.postgres_prompts import PostgresPromptRepository
from volundr.adapters.outbound.postgres_stats import PostgresStatsRepository
from volundr.adapters.outbound.postgres_tenants import PostgresTenantRepository
from volundr.adapters.outbound.postgres_tokens import PostgresTokenTracker
from volundr.adapters.outbound.postgres_users import PostgresUserRepository
from volundr.adapters.outbound.pricing import HardcodedPricingProvider
from volundr.domain.models import Session, SessionSpec, SessionStatus
from volundr.domain.ports import PodManager, PodStartResult
from volundr.domain.services import (
    PromptService,
    SessionService,
    StatsService,
    TenantService,
    TokenService,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from tests.integration.pool_wrapper import TransactionalPool


class NoOpPodManager(PodManager):
    """Stub pod manager that returns immediately without spawning anything."""

    async def start(self, session: Session, spec: SessionSpec) -> PodStartResult:
        return PodStartResult(
            chat_endpoint=f"ws://test:0/s/{session.id}/session",
            code_endpoint=None,
            pod_name=f"test-{uuid4().hex[:8]}",
        )

    async def stop(self, session: Session) -> bool:
        return True

    async def status(self, session: Session) -> SessionStatus:
        return SessionStatus.STOPPED

    async def wait_for_ready(self, session: Session, timeout: float) -> SessionStatus:
        return SessionStatus.RUNNING

    async def close(self) -> None:
        pass


@pytest_asyncio.fixture
async def volundr_app(
    txn_pool: TransactionalPool,
    monkeypatch: pytest.MonkeyPatch,
):
    """Build a minimal FastAPI app with session/stats/prompt routers."""
    app = FastAPI()

    # Repositories backed by the transactional pool
    session_repo = PostgresSessionRepository(txn_pool)
    stats_repo = PostgresStatsRepository(txn_pool)
    token_tracker = PostgresTokenTracker(txn_pool)
    prompt_repo = PostgresPromptRepository(txn_pool)
    user_repo = PostgresUserRepository(txn_pool)
    tenant_repo = PostgresTenantRepository(txn_pool)

    # Identity adapter: reads x-auth-* headers
    identity = EnvoyHeaderIdentityAdapter(user_repository=user_repo)
    app.state.identity = identity
    app.state.settings = type("S", (), {"local_mounts": type("L", (), {"mini_mode": False})()})()
    app.state.admin_settings = {"storage": {"home_enabled": True}}

    # Ensure the default tenant exists
    tenant_service = TenantService(tenant_repo, user_repo)
    await tenant_service.ensure_default_tenant()

    # Services
    broadcaster = InMemoryEventBroadcaster()
    pricing = HardcodedPricingProvider()
    pod_manager = NoOpPodManager()

    session_service = SessionService(
        session_repo,
        pod_manager,
        broadcaster=broadcaster,
        provisioning_timeout=2.0,
        provisioning_initial_delay=0.0,
    )
    stats_service = StatsService(stats_repo)
    token_service = TokenService(token_tracker, session_repo, pricing, broadcaster=broadcaster)
    prompt_service = PromptService(prompt_repo)

    # Routers
    session_router = create_session_router(
        session_service,
        stats_service,
        token_service,
        pricing,
        broadcaster=broadcaster,
    )
    app.include_router(session_router)

    prompts_router = create_prompts_router(prompt_service)
    app.include_router(prompts_router)

    # Health endpoint (outside lifespan, like production)
    @app.get("/health")
    async def health_check() -> dict[str, str]:
        return {"status": "healthy"}

    yield app


@pytest_asyncio.fixture
async def volundr_client(
    volundr_app,
) -> AsyncIterator[httpx.AsyncClient]:
    """Async HTTP client wired to the Volundr ASGI app."""
    transport = httpx.ASGITransport(app=volundr_app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
    ) as client:
        yield client
