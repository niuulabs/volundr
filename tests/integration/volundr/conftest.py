"""Volundr-specific integration test fixtures.

Provides ``volundr_app`` and ``volundr_client`` fixtures that spin up the
full FastAPI application backed by a real PostgreSQL database with
per-test transaction rollback.

The database pool created by the lifespan is replaced with the shared
``txn_pool`` fixture so every test runs inside a single transaction
that is automatically rolled back.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

import httpx
import pytest_asyncio

from tests.integration.pool_wrapper import TransactionalPool
from volundr.config import (
    DatabaseConfig,
    IdentityConfig,
    PodManagerConfig,
    Settings,
)
from volundr.domain.models import Session, SessionSpec, SessionStatus
from volundr.domain.ports import PodManager, PodStartResult

# ---------------------------------------------------------------------------
# Stub PodManager — avoids spawning real processes during integration tests
# ---------------------------------------------------------------------------


class _StubPodManager(PodManager):
    """No-op pod manager that immediately returns fake endpoints."""

    async def start(self, session: Session, spec: SessionSpec) -> PodStartResult:
        return PodStartResult(
            chat_endpoint="http://stub:9100/chat",
            code_endpoint="http://stub:9100/code",
            pod_name=f"stub-{session.id}",
        )

    async def stop(self, session: Session) -> bool:
        return True

    async def status(self, session: Session) -> SessionStatus:
        return SessionStatus.RUNNING

    async def wait_for_ready(self, session: Session, timeout: float) -> SessionStatus:
        return SessionStatus.RUNNING

    async def close(self) -> None:
        pass


# ---------------------------------------------------------------------------
# App & client fixtures
# ---------------------------------------------------------------------------


def _test_settings() -> Settings:
    """Build ``Settings`` for integration tests.

    Uses ``EnvoyHeaderIdentityAdapter`` so that the ``auth_headers``
    factory fixture controls which principal each request impersonates.
    """
    import os

    host = os.environ.get("TEST_DATABASE_HOST", "localhost")
    port = int(os.environ.get("TEST_DATABASE_PORT", "5432"))
    user = os.environ.get("TEST_DATABASE_USER", "volundr_test")
    password = os.environ.get("TEST_DATABASE_PASSWORD", "volundr_test")
    name = os.environ.get("TEST_DATABASE_NAME", "volundr_test")

    return Settings(
        database=DatabaseConfig(
            host=host,
            port=port,
            user=user,
            password=password,
            name=name,
        ),
        identity=IdentityConfig(
            adapter="volundr.adapters.outbound.identity.EnvoyHeaderIdentityAdapter",
        ),
        pod_manager=PodManagerConfig(
            adapter="volundr.adapters.outbound.local_process.LocalProcessManager",
        ),
    )


@pytest_asyncio.fixture
async def volundr_app(
    txn_pool: TransactionalPool,
    monkeypatch: Any,
) -> AsyncGenerator:
    """Create a fully wired FastAPI app with the txn_pool as the database.

    The lifespan is triggered manually so that all routers and services
    are wired before HTTP requests are made.
    """

    @asynccontextmanager
    async def _patched_pool(_config: Any) -> AsyncGenerator:
        yield txn_pool

    monkeypatch.setattr("volundr.main.database_pool", _patched_pool)

    # Stub the pod manager factory so no real processes are spawned
    monkeypatch.setattr(
        "volundr.main._create_pod_manager",
        lambda _settings: _StubPodManager(),
    )

    from volundr.main import create_app

    settings = _test_settings()
    app = create_app(settings)

    # Manually trigger the lifespan so that all routes, services, and
    # adapters are wired up (they are registered inside the lifespan).
    async with app.router.lifespan_context(app):
        yield app


@pytest_asyncio.fixture
async def volundr_client(volundr_app: Any) -> AsyncGenerator[httpx.AsyncClient, None]:
    """httpx.AsyncClient wired to the Volundr ASGI app."""
    transport = httpx.ASGITransport(app=volundr_app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
    ) as client:
        yield client
