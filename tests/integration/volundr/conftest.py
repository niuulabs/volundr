"""Volundr-specific integration test fixtures.

Provides ``volundr_app`` and ``volundr_client`` fixtures that stand up the
full FastAPI application backed by the transactional pool from the shared
conftest.  The ``database_pool`` context manager is monkeypatched so the
app lifespan re-uses the per-test wrapped connection instead of creating
its own pool.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

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
from volundr.main import create_app

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from tests.integration.pool_wrapper import TransactionalPool


@pytest_asyncio.fixture
async def volundr_app(
    txn_pool: TransactionalPool,
    monkeypatch: pytest.MonkeyPatch,
):
    """Create a fully-wired Volundr FastAPI app backed by the txn pool."""
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

    app = create_app(settings)
    return app


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
