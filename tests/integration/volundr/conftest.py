"""Volundr-specific integration test fixtures.

Provides ``volundr_app`` and ``volundr_client`` fixtures that stand up the
full FastAPI application backed by the transactional pool from the shared
conftest.  The ``database_pool`` context manager is monkeypatched so the
app lifespan re-uses the per-test wrapped connection instead of creating
its own pool.

httpx.ASGITransport does NOT send ASGI lifespan events, so we invoke
the lifespan context manager explicitly before handing the app to the
test client.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio

from volundr.config import (
    DatabaseConfig,
    IdentityConfig,
    PodManagerConfig,
    ProvisioningConfig,
    Settings,
)
from volundr.domain.models import Session, SessionSpec, SessionStatus
from volundr.domain.ports import PodManager, PodStartResult
from volundr.main import create_app

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
    """Create a Volundr FastAPI app, run the lifespan, and yield.

    The lifespan registers routers, so it must run before requests.
    """
    settings = Settings(
        database=DatabaseConfig(
            host="localhost",
            port=5432,
            user="volundr_test",
            password="volundr_test",
            name="volundr_test",
        ),
        identity=IdentityConfig(
            adapter="volundr.adapters.outbound.identity.EnvoyHeaderIdentityAdapter",
        ),
        pod_manager=PodManagerConfig(
            adapter="volundr.adapters.outbound.local_process.LocalProcessPodManager",
        ),
        provisioning=ProvisioningConfig(
            timeout_seconds=2.0,
            initial_delay_seconds=0.0,
        ),
    )

    pool_ref = [txn_pool]

    @asynccontextmanager
    async def _patched_database_pool(config=None):
        yield pool_ref[0]

    monkeypatch.setattr(
        "volundr.infrastructure.database.database_pool",
        _patched_database_pool,
    )
    monkeypatch.setattr(
        "volundr.main.database_pool",
        _patched_database_pool,
    )
    monkeypatch.setattr(
        "volundr.main._create_pod_manager",
        lambda settings: NoOpPodManager(),
    )

    app = create_app(settings)

    # Manually invoke the ASGI lifespan so all routers are registered.
    async with app.router.lifespan_context(app):
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
