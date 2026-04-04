"""Unit tests for TransactionalPool wrapper."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from tests.integration.pool_wrapper import TransactionalPool


@pytest.fixture
def mock_conn() -> AsyncMock:
    """Return a mock asyncpg connection."""
    conn = AsyncMock()
    conn.execute = AsyncMock(return_value="INSERT 0 1")
    conn.fetch = AsyncMock(return_value=[{"id": 1}])
    conn.fetchrow = AsyncMock(return_value={"id": 1, "name": "test"})
    conn.fetchval = AsyncMock(return_value=42)
    return conn


@pytest.fixture
def pool(mock_conn: AsyncMock) -> TransactionalPool:
    return TransactionalPool(mock_conn)


class TestAcquire:
    async def test_acquire_yields_underlying_connection(
        self, pool: TransactionalPool, mock_conn: AsyncMock
    ) -> None:
        async with pool.acquire() as conn:
            assert conn is mock_conn

    async def test_acquire_returns_same_connection_every_time(
        self, pool: TransactionalPool, mock_conn: AsyncMock
    ) -> None:
        async with pool.acquire() as conn1:
            pass
        async with pool.acquire() as conn2:
            pass
        assert conn1 is conn2 is mock_conn


class TestDirectDelegation:
    async def test_execute_delegates(self, pool: TransactionalPool, mock_conn: AsyncMock) -> None:
        result = await pool.execute("INSERT INTO t VALUES ($1)", 1)
        assert result == "INSERT 0 1"
        mock_conn.execute.assert_awaited_once_with("INSERT INTO t VALUES ($1)", 1, timeout=None)

    async def test_fetch_delegates(self, pool: TransactionalPool, mock_conn: AsyncMock) -> None:
        result = await pool.fetch("SELECT * FROM t")
        assert result == [{"id": 1}]
        mock_conn.fetch.assert_awaited_once_with("SELECT * FROM t", timeout=None)

    async def test_fetchrow_delegates(self, pool: TransactionalPool, mock_conn: AsyncMock) -> None:
        result = await pool.fetchrow("SELECT * FROM t WHERE id = $1", 1)
        assert result == {"id": 1, "name": "test"}
        mock_conn.fetchrow.assert_awaited_once_with(
            "SELECT * FROM t WHERE id = $1", 1, timeout=None
        )

    async def test_fetchval_delegates(self, pool: TransactionalPool, mock_conn: AsyncMock) -> None:
        result = await pool.fetchval("SELECT count(*) FROM t")
        assert result == 42
        mock_conn.fetchval.assert_awaited_once_with("SELECT count(*) FROM t", timeout=None)

    async def test_execute_with_timeout(
        self, pool: TransactionalPool, mock_conn: AsyncMock
    ) -> None:
        await pool.execute("SELECT 1", timeout=5.0)
        mock_conn.execute.assert_awaited_once_with("SELECT 1", timeout=5.0)


class TestLifecycle:
    async def test_close_is_noop(self, pool: TransactionalPool, mock_conn: AsyncMock) -> None:
        await pool.close()
        # Should not call anything on the connection
        mock_conn.close.assert_not_awaited()
