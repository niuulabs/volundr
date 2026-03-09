"""Tests for PostgreSQL timeline repository adapter."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from volundr.adapters.outbound.postgres_timeline import PostgresTimelineRepository
from volundr.domain.models import TimelineEvent, TimelineEventType


@pytest.fixture
def mock_pool():
    """Create a mock asyncpg pool."""
    pool = MagicMock()
    pool.execute = AsyncMock()
    pool.fetchrow = AsyncMock()
    pool.fetch = AsyncMock()
    return pool


@pytest.fixture
def repository(mock_pool) -> PostgresTimelineRepository:
    """Create a repository with mock pool."""
    return PostgresTimelineRepository(mock_pool)


@pytest.fixture
def sample_event() -> TimelineEvent:
    """Create a sample timeline event for testing."""
    return TimelineEvent(
        id=uuid4(),
        chronicle_id=uuid4(),
        session_id=uuid4(),
        t=10,
        type=TimelineEventType.MESSAGE,
        label="Review code",
        tokens=2400,
        action=None,
        ins=None,
        del_=None,
        hash=None,
        exit_code=None,
        created_at=datetime.now(UTC),
    )


@pytest.fixture
def sample_row(sample_event: TimelineEvent) -> dict:
    """Create a sample database row matching sample_event."""
    return {
        "id": sample_event.id,
        "chronicle_id": sample_event.chronicle_id,
        "session_id": sample_event.session_id,
        "t": sample_event.t,
        "type": sample_event.type.value,
        "label": sample_event.label,
        "tokens": sample_event.tokens,
        "action": sample_event.action,
        "ins": sample_event.ins,
        "del": sample_event.del_,
        "hash": sample_event.hash,
        "exit_code": sample_event.exit_code,
        "created_at": sample_event.created_at,
    }


class TestPostgresTimelineRepositoryAddEvent:
    """Tests for add_event method."""

    async def test_add_event_executes_insert(
        self,
        repository: PostgresTimelineRepository,
        mock_pool,
        sample_event: TimelineEvent,
    ):
        """Test that add_event executes INSERT statement."""
        await repository.add_event(sample_event)

        mock_pool.execute.assert_called_once()
        call_args = mock_pool.execute.call_args
        sql = call_args[0][0]
        assert "INSERT INTO chronicle_events" in sql
        assert call_args[0][1] == sample_event.id
        assert call_args[0][4] == sample_event.t
        assert call_args[0][5] == sample_event.type.value

    async def test_add_event_returns_event(
        self,
        repository: PostgresTimelineRepository,
        sample_event: TimelineEvent,
    ):
        """Test that add_event returns the event."""
        result = await repository.add_event(sample_event)
        assert result == sample_event


class TestPostgresTimelineRepositoryGetEvents:
    """Tests for get_events method."""

    async def test_get_events_returns_list(
        self,
        repository: PostgresTimelineRepository,
        mock_pool,
        sample_row,
    ):
        """Test that get_events returns list of events."""
        mock_pool.fetch.return_value = [sample_row]

        result = await repository.get_events(sample_row["chronicle_id"])

        assert len(result) == 1
        assert result[0].t == sample_row["t"]
        assert result[0].type == TimelineEventType(sample_row["type"])

    async def test_get_events_orders_by_t(
        self,
        repository: PostgresTimelineRepository,
        mock_pool,
    ):
        """Test that get_events queries with ORDER BY t ASC."""
        mock_pool.fetch.return_value = []
        chronicle_id = uuid4()

        await repository.get_events(chronicle_id)

        call_args = mock_pool.fetch.call_args
        sql = call_args[0][0]
        assert "ORDER BY t ASC" in sql
        assert call_args[0][1] == chronicle_id

    async def test_get_events_returns_empty(
        self, repository: PostgresTimelineRepository, mock_pool
    ):
        """Test that get_events returns empty list when no results."""
        mock_pool.fetch.return_value = []

        result = await repository.get_events(uuid4())

        assert result == []


class TestPostgresTimelineRepositoryGetBySession:
    """Tests for get_events_by_session method."""

    async def test_get_events_by_session_queries_session_id(
        self,
        repository: PostgresTimelineRepository,
        mock_pool,
    ):
        """Test that get_events_by_session queries with session_id."""
        mock_pool.fetch.return_value = []
        session_id = uuid4()

        await repository.get_events_by_session(session_id)

        call_args = mock_pool.fetch.call_args
        sql = call_args[0][0]
        assert "session_id = $1" in sql
        assert call_args[0][1] == session_id


class TestPostgresTimelineRepositoryDelete:
    """Tests for delete_by_chronicle method."""

    async def test_delete_returns_count(self, repository: PostgresTimelineRepository, mock_pool):
        """Test that delete_by_chronicle returns count of deleted rows."""
        mock_pool.execute.return_value = "DELETE 5"

        result = await repository.delete_by_chronicle(uuid4())

        assert result == 5

    async def test_delete_returns_zero_when_nothing_deleted(
        self, repository: PostgresTimelineRepository, mock_pool
    ):
        """Test that delete returns 0 when nothing to delete."""
        mock_pool.execute.return_value = "DELETE 0"

        result = await repository.delete_by_chronicle(uuid4())

        assert result == 0


class TestRowToEvent:
    """Tests for _row_to_event helper."""

    async def test_converts_row_to_event(self, repository: PostgresTimelineRepository, sample_row):
        """Test that row is correctly converted to TimelineEvent."""
        result = repository._row_to_event(sample_row)

        assert result.id == sample_row["id"]
        assert result.chronicle_id == sample_row["chronicle_id"]
        assert result.session_id == sample_row["session_id"]
        assert result.t == sample_row["t"]
        assert result.type == TimelineEventType.MESSAGE
        assert result.label == sample_row["label"]
        assert result.tokens == sample_row["tokens"]

    async def test_handles_naive_datetime(self, repository: PostgresTimelineRepository, sample_row):
        """Test that naive datetimes get UTC timezone."""
        sample_row["created_at"] = datetime(2024, 1, 1, 12, 0, 0)

        result = repository._row_to_event(sample_row)

        assert result.created_at.tzinfo == UTC

    async def test_handles_file_event_fields(
        self, repository: PostgresTimelineRepository, sample_row
    ):
        """Test that file event fields are preserved."""
        sample_row["type"] = "file"
        sample_row["action"] = "modified"
        sample_row["ins"] = 45
        sample_row["del"] = 23

        result = repository._row_to_event(sample_row)

        assert result.type == TimelineEventType.FILE
        assert result.action == "modified"
        assert result.ins == 45
        assert result.del_ == 23

    async def test_handles_git_event_fields(
        self, repository: PostgresTimelineRepository, sample_row
    ):
        """Test that git event hash is preserved."""
        sample_row["type"] = "git"
        sample_row["hash"] = "a1d3e47"

        result = repository._row_to_event(sample_row)

        assert result.type == TimelineEventType.GIT
        assert result.hash == "a1d3e47"

    async def test_handles_terminal_event_fields(
        self, repository: PostgresTimelineRepository, sample_row
    ):
        """Test that terminal event exit_code is preserved."""
        sample_row["type"] = "terminal"
        sample_row["exit_code"] = 0

        result = repository._row_to_event(sample_row)

        assert result.type == TimelineEventType.TERMINAL
        assert result.exit_code == 0
