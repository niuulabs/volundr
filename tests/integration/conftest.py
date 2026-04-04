"""Shared fixtures for integration tests that hit a real PostgreSQL database.

Fixtures
--------
db_pool       (session) — real asyncpg pool; migrations applied once.
txn_pool      (function) — per-test transactional wrapper; rolled back after each test.
volundr_settings (function) — ``volundr.config.Settings`` pointing at the test DB.
tyr_settings     (function) — ``tyr.config.Settings`` pointing at the test DB.
auth_headers     (function) — factory that returns Envoy-style header dicts.

Environment variables
---------------------
TEST_DATABASE_HOST      (default: localhost)
TEST_DATABASE_PORT      (default: 5432)
TEST_DATABASE_USER      (default: volundr_test)
TEST_DATABASE_PASSWORD  (default: volundr_test)
TEST_DATABASE_NAME      (default: volundr_test)
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Any

import asyncpg
import pytest
import pytest_asyncio

from tests.helpers.migrations import apply_migrations
from tests.integration.pool_wrapper import TransactionalPool

# ---------------------------------------------------------------------------
# Environment helpers
# ---------------------------------------------------------------------------

_DB_HOST = os.environ.get("TEST_DATABASE_HOST", "localhost")
_DB_PORT = int(os.environ.get("TEST_DATABASE_PORT", "5432"))
_DB_USER = os.environ.get("TEST_DATABASE_USER", "volundr_test")
_DB_PASSWORD = os.environ.get("TEST_DATABASE_PASSWORD", "volundr_test")
_DB_NAME = os.environ.get("TEST_DATABASE_NAME", "volundr_test")

_MIGRATIONS_DIR = Path(__file__).resolve().parent.parent.parent / "migrations"

# ---------------------------------------------------------------------------
# Session-scoped real pool (migrations applied once)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def db_pool() -> asyncpg.Pool:
    """Create a real asyncpg pool and apply migrations once per session."""
    pool = await asyncpg.create_pool(
        host=_DB_HOST,
        port=_DB_PORT,
        user=_DB_USER,
        password=_DB_PASSWORD,
        database=_DB_NAME,
        min_size=1,
        max_size=5,
    )
    assert pool is not None

    await apply_migrations(pool, _MIGRATIONS_DIR)

    yield pool

    await pool.close()


# ---------------------------------------------------------------------------
# Per-test transactional wrapper (rollback after each test)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(loop_scope="session")
async def txn_pool(db_pool: asyncpg.Pool) -> TransactionalPool:
    """Acquire a connection, start a transaction, and wrap it.

    After the test, ROLLBACK ensures zero data leakage between tests.
    """
    conn = await db_pool.acquire()
    txn = conn.transaction()
    await txn.start()

    wrapper = TransactionalPool(conn)

    yield wrapper

    await txn.rollback()
    await db_pool.release(conn)


# ---------------------------------------------------------------------------
# Settings fixtures (skip YAML file loading)
# ---------------------------------------------------------------------------


@pytest.fixture
def volundr_settings() -> Any:
    """Return ``volundr.config.Settings`` pointing at the test database.

    Uses AllowAllIdentity and the default (in-memory) PodManager so no
    external services are required.
    """
    from volundr.config import DatabaseConfig, IdentityConfig, PodManagerConfig, Settings

    return Settings(
        database=DatabaseConfig(
            host=_DB_HOST,
            port=_DB_PORT,
            user=_DB_USER,
            password=_DB_PASSWORD,
            name=_DB_NAME,
        ),
        identity=IdentityConfig(
            adapter="volundr.adapters.outbound.identity.AllowAllIdentityAdapter",
        ),
        pod_manager=PodManagerConfig(
            adapter="volundr.adapters.outbound.local_process.LocalProcessManager",
        ),
    )


@pytest.fixture
def tyr_settings() -> Any:
    """Return ``tyr.config.Settings`` pointing at the test database.

    Enables anonymous dev mode so no real IDP is needed.
    """
    from tyr.config import AuthConfig, DatabaseConfig, Settings

    return Settings(
        database=DatabaseConfig(
            host=_DB_HOST,
            port=_DB_PORT,
            user=_DB_USER,
            password=_DB_PASSWORD,
            name=_DB_NAME,
        ),
        auth=AuthConfig(allow_anonymous_dev=True),
    )


# ---------------------------------------------------------------------------
# Auth header factory
# ---------------------------------------------------------------------------


@pytest.fixture
def auth_headers() -> _AuthHeaderFactory:
    """Factory fixture that produces Envoy-style header dicts.

    Usage::

        headers = auth_headers("user-1", "u@example.com", "tenant-a", ["admin"])
    """
    return _AuthHeaderFactory()


class _AuthHeaderFactory:
    """Callable that builds Envoy-style authentication header dicts."""

    def __call__(
        self,
        user_id: str = "test-user",
        email: str = "test@example.com",
        tenant: str = "default",
        roles: list[str] | None = None,
    ) -> dict[str, str]:
        if roles is None:
            roles = ["volundr:developer"]

        # Envoy base64-encodes array claims (e.g. roles)
        roles_b64 = base64.b64encode(json.dumps(roles).encode()).decode()

        return {
            "x-auth-user-id": user_id,
            "x-auth-email": email,
            "x-auth-tenant": tenant,
            "x-auth-roles": roles_b64,
        }
