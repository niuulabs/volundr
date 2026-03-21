"""Tests for Tyr infrastructure layer."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tyr.config import DatabaseConfig
from tyr.infrastructure.database import create_pool, database_pool, init_db


class TestCreatePool:
    @pytest.mark.asyncio
    async def test_create_pool_calls_asyncpg(self) -> None:
        config = DatabaseConfig(
            host="db-host",
            port=5433,
            user="tyr_user",
            password="secret",
            name="tyr_db",
            min_pool_size=2,
            max_pool_size=10,
        )
        mock_pool = MagicMock()

        with patch("tyr.infrastructure.database.asyncpg.create_pool", new_callable=AsyncMock) as m:
            m.return_value = mock_pool
            result = await create_pool(config)

        assert result is mock_pool
        m.assert_called_once_with(
            host="db-host",
            port=5433,
            user="tyr_user",
            password="secret",
            database="tyr_db",
            min_size=2,
            max_size=10,
        )


class TestInitDb:
    @pytest.mark.asyncio
    async def test_init_db_is_noop(self) -> None:
        mock_pool = MagicMock()
        # Should not raise
        await init_db(mock_pool)


class TestDatabasePool:
    @pytest.mark.asyncio
    async def test_lifecycle(self) -> None:
        config = DatabaseConfig()
        mock_pool = AsyncMock()
        mock_pool.close = AsyncMock()

        with patch("tyr.infrastructure.database.create_pool", new_callable=AsyncMock) as m_create:
            m_create.return_value = mock_pool
            async with database_pool(config) as pool:
                assert pool is mock_pool

        mock_pool.close.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_pool_closes_on_exception(self) -> None:
        config = DatabaseConfig()
        mock_pool = AsyncMock()
        mock_pool.close = AsyncMock()

        with (
            patch("tyr.infrastructure.database.create_pool", new_callable=AsyncMock) as m_create,
            pytest.raises(RuntimeError, match="boom"),
        ):
            m_create.return_value = mock_pool
            async with database_pool(config):
                raise RuntimeError("boom")

        mock_pool.close.assert_awaited_once()
