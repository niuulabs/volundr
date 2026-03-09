"""Tests for PostgresTokenTracker adapter."""

from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from volundr.adapters.outbound.postgres_tokens import PostgresTokenTracker
from volundr.domain.models import ModelProvider, TokenUsageRecord


@pytest.fixture
def mock_pool() -> MagicMock:
    """Create a mock asyncpg pool."""
    pool = MagicMock()
    pool.acquire = MagicMock()
    return pool


@pytest.fixture
def token_tracker(mock_pool: MagicMock) -> PostgresTokenTracker:
    """Create a token tracker with mock pool."""
    return PostgresTokenTracker(mock_pool)


class TestPostgresTokenTrackerRecordUsage:
    """Tests for PostgresTokenTracker.record_usage."""

    async def test_record_usage_cloud_with_cost(
        self, token_tracker: PostgresTokenTracker, mock_pool: MagicMock
    ) -> None:
        """Test recording cloud usage with cost."""
        mock_conn = AsyncMock()
        mock_context = AsyncMock()
        mock_context.__aenter__.return_value = mock_conn
        mock_context.__aexit__.return_value = None
        mock_pool.acquire.return_value = mock_context

        session_id = uuid4()
        record = await token_tracker.record_usage(
            session_id=session_id,
            tokens=1000,
            provider=ModelProvider.CLOUD,
            model="claude-sonnet-4-20250514",
            cost=0.015,
        )

        assert isinstance(record, TokenUsageRecord)
        assert record.session_id == session_id
        assert record.tokens == 1000
        assert record.provider == ModelProvider.CLOUD
        assert record.model == "claude-sonnet-4-20250514"
        assert record.cost == Decimal("0.015")
        mock_conn.execute.assert_called_once()

    async def test_record_usage_local_no_cost(
        self, token_tracker: PostgresTokenTracker, mock_pool: MagicMock
    ) -> None:
        """Test recording local usage without cost."""
        mock_conn = AsyncMock()
        mock_context = AsyncMock()
        mock_context.__aenter__.return_value = mock_conn
        mock_context.__aexit__.return_value = None
        mock_pool.acquire.return_value = mock_context

        session_id = uuid4()
        record = await token_tracker.record_usage(
            session_id=session_id,
            tokens=500,
            provider=ModelProvider.LOCAL,
            model="llama-3",
        )

        assert record.provider == ModelProvider.LOCAL
        assert record.cost is None

    async def test_record_usage_sql_contains_insert(
        self, token_tracker: PostgresTokenTracker, mock_pool: MagicMock
    ) -> None:
        """Test that SQL query contains INSERT statement."""
        mock_conn = AsyncMock()
        mock_context = AsyncMock()
        mock_context.__aenter__.return_value = mock_conn
        mock_context.__aexit__.return_value = None
        mock_pool.acquire.return_value = mock_context

        await token_tracker.record_usage(
            session_id=uuid4(),
            tokens=1000,
            provider=ModelProvider.CLOUD,
            model="claude-sonnet-4-20250514",
        )

        call_args = mock_conn.execute.call_args[0]
        sql = call_args[0].upper()
        assert "INSERT INTO TOKEN_USAGE" in sql


class TestPostgresTokenTrackerGetSessionUsage:
    """Tests for PostgresTokenTracker.get_session_usage."""

    async def test_get_session_usage_returns_sum(
        self, token_tracker: PostgresTokenTracker, mock_pool: MagicMock
    ) -> None:
        """Test getting total usage returns correct sum."""
        mock_conn = AsyncMock()
        mock_context = AsyncMock()
        mock_context.__aenter__.return_value = mock_conn
        mock_context.__aexit__.return_value = None
        mock_pool.acquire.return_value = mock_context

        mock_conn.fetchval.return_value = 1500

        session_id = uuid4()
        total = await token_tracker.get_session_usage(session_id)

        assert total == 1500

    async def test_get_session_usage_zero(
        self, token_tracker: PostgresTokenTracker, mock_pool: MagicMock
    ) -> None:
        """Test getting usage for session with no records."""
        mock_conn = AsyncMock()
        mock_context = AsyncMock()
        mock_context.__aenter__.return_value = mock_conn
        mock_context.__aexit__.return_value = None
        mock_pool.acquire.return_value = mock_context

        mock_conn.fetchval.return_value = 0

        total = await token_tracker.get_session_usage(uuid4())

        assert total == 0

    async def test_get_session_usage_sql_contains_sum(
        self, token_tracker: PostgresTokenTracker, mock_pool: MagicMock
    ) -> None:
        """Test that SQL query contains SUM."""
        mock_conn = AsyncMock()
        mock_context = AsyncMock()
        mock_context.__aenter__.return_value = mock_conn
        mock_context.__aexit__.return_value = None
        mock_pool.acquire.return_value = mock_context

        mock_conn.fetchval.return_value = 0

        session_id = uuid4()
        await token_tracker.get_session_usage(session_id)

        call_args = mock_conn.fetchval.call_args[0]
        sql = call_args[0]
        assert "SUM" in sql.upper()
        assert "token_usage" in sql.lower()
