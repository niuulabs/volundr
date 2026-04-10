"""Tests for PostgresThreadAdapter (NIU-555).

Helper tests cover pure Python functions without a real DB.
Adapter tests mock asyncpg connection pool per project rules.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ravn.adapters.thread.postgres import (
    PostgresThreadAdapter,
    _parse_tags,
    _parse_ts,
    _row_to_thread,
)
from ravn.domain.thread import RavnThread, ThreadStatus


class _FakeRow(dict):
    """Minimal asyncpg-like row (dict subclass)."""


class TestParseTags:
    def test_list_passthrough(self) -> None:
        assert _parse_tags(["ml", "paper"]) == ["ml", "paper"]

    def test_json_string_decoded(self) -> None:
        assert _parse_tags('["ml", "paper"]') == ["ml", "paper"]

    def test_empty_json_string(self) -> None:
        assert _parse_tags("[]") == []

    def test_none_returns_empty(self) -> None:
        assert _parse_tags(None) == []


class TestParseTs:
    def test_naive_datetime_gets_utc(self) -> None:
        naive = datetime(2025, 1, 1, 0, 0, 0)
        result = _parse_ts(naive)
        assert result.tzinfo is not None

    def test_aware_datetime_unchanged(self) -> None:
        aware = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        result = _parse_ts(aware)
        assert result == aware


class TestRowToThread:
    def _make_row(self, **overrides: object) -> _FakeRow:
        now = datetime.now(UTC)
        defaults = {
            "thread_id": "test-uuid",
            "page_path": "papers/foo.md",
            "title": "Test Thread",
            "weight": 0.7,
            "next_action": "read it",
            "tags": ["paper"],
            "status": "open",
            "created_at": now,
            "last_seen_at": now,
        }
        defaults.update(overrides)
        return _FakeRow(defaults)

    def test_basic_row(self) -> None:
        row = self._make_row()
        thread = _row_to_thread(row)
        assert thread.thread_id == "test-uuid"
        assert thread.page_path == "papers/foo.md"
        assert thread.title == "Test Thread"
        assert thread.weight == 0.7
        assert thread.next_action == "read it"
        assert thread.tags == ["paper"]
        assert thread.status == ThreadStatus.OPEN

    def test_closed_status(self) -> None:
        row = self._make_row(status="closed")
        thread = _row_to_thread(row)
        assert thread.status == ThreadStatus.CLOSED

    def test_empty_title_defaults(self) -> None:
        row = self._make_row(title="")
        thread = _row_to_thread(row)
        assert thread.title == ""

    def test_json_string_tags(self) -> None:
        row = self._make_row(tags='["ml", "research"]')
        thread = _row_to_thread(row)
        assert thread.tags == ["ml", "research"]

    def test_naive_timestamps_get_utc(self) -> None:
        naive = datetime(2025, 6, 1, 12, 0, 0)
        row = self._make_row(created_at=naive, last_seen_at=naive)
        thread = _row_to_thread(row)
        assert thread.created_at.tzinfo is not None
        assert thread.last_seen_at.tzinfo is not None

    def test_float_weight(self) -> None:
        row = self._make_row(weight=0.123456)
        thread = _row_to_thread(row)
        assert abs(thread.weight - 0.123456) < 1e-6


# ---------------------------------------------------------------------------
# Mock-based adapter tests (no real PostgreSQL connection)
# ---------------------------------------------------------------------------


def _make_thread(path: str = "papers/foo.md", weight: float = 0.5) -> RavnThread:
    return RavnThread.create(
        page_path=path,
        title="Test Thread",
        weight=weight,
        next_action="read it",
        tags=["test"],
    )


def _make_fake_pool(rows: list | None = None, row: object | None = None) -> MagicMock:
    """Build a fake asyncpg pool that returns predetermined results."""
    conn = MagicMock()
    conn.execute = AsyncMock(return_value=None)
    conn.fetchrow = AsyncMock(return_value=row)
    conn.fetch = AsyncMock(return_value=rows or [])

    pool = MagicMock()
    pool.acquire = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)
    return pool, conn


class TestPostgresThreadAdapter:
    def _make_row(self, **overrides: object) -> dict:
        now = datetime.now(UTC)
        defaults = {
            "thread_id": "test-uuid",
            "page_path": "papers/foo.md",
            "title": "Test Thread",
            "weight": 0.7,
            "next_action": "read it",
            "tags": ["test"],
            "status": "open",
            "created_at": now,
            "last_seen_at": now,
        }
        defaults.update(overrides)
        return defaults

    @pytest.mark.asyncio
    async def test_upsert_calls_execute(self) -> None:
        pool, conn = _make_fake_pool()
        adapter = PostgresThreadAdapter(dsn="postgresql://fake/db")
        adapter._pool = pool

        t = _make_thread()
        await adapter.upsert(t)

        conn.execute.assert_called_once()
        args = conn.execute.call_args[0]
        assert t.thread_id in args

    @pytest.mark.asyncio
    async def test_get_returns_thread(self) -> None:
        row = self._make_row()
        pool, conn = _make_fake_pool(row=row)
        adapter = PostgresThreadAdapter(dsn="postgresql://fake/db")
        adapter._pool = pool

        result = await adapter.get("test-uuid")
        assert result is not None
        assert result.thread_id == "test-uuid"

    @pytest.mark.asyncio
    async def test_get_returns_none_when_missing(self) -> None:
        pool, conn = _make_fake_pool(row=None)
        adapter = PostgresThreadAdapter(dsn="postgresql://fake/db")
        adapter._pool = pool

        result = await adapter.get("nonexistent")
        assert result is None

    @pytest.mark.asyncio
    async def test_get_by_path_returns_thread(self) -> None:
        row = self._make_row(page_path="papers/bar.md")
        pool, conn = _make_fake_pool(row=row)
        adapter = PostgresThreadAdapter(dsn="postgresql://fake/db")
        adapter._pool = pool

        result = await adapter.get_by_path("papers/bar.md")
        assert result is not None
        assert result.page_path == "papers/bar.md"

    @pytest.mark.asyncio
    async def test_get_by_path_returns_none(self) -> None:
        pool, conn = _make_fake_pool(row=None)
        adapter = PostgresThreadAdapter(dsn="postgresql://fake/db")
        adapter._pool = pool

        result = await adapter.get_by_path("nonexistent")
        assert result is None

    @pytest.mark.asyncio
    async def test_peek_queue_returns_threads(self) -> None:
        rows = [self._make_row(thread_id=f"id-{i}", weight=float(i) / 10) for i in range(3)]
        pool, conn = _make_fake_pool(rows=rows)
        adapter = PostgresThreadAdapter(dsn="postgresql://fake/db")
        adapter._pool = pool

        result = await adapter.peek_queue(limit=3)
        assert len(result) == 3

    @pytest.mark.asyncio
    async def test_list_open_returns_threads(self) -> None:
        rows = [self._make_row(thread_id=f"id-{i}") for i in range(2)]
        pool, conn = _make_fake_pool(rows=rows)
        adapter = PostgresThreadAdapter(dsn="postgresql://fake/db")
        adapter._pool = pool

        result = await adapter.list_open(limit=10)
        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_close_calls_execute(self) -> None:
        pool, conn = _make_fake_pool()
        adapter = PostgresThreadAdapter(dsn="postgresql://fake/db")
        adapter._pool = pool

        await adapter.close("test-uuid")
        conn.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_update_weight_calls_execute(self) -> None:
        pool, conn = _make_fake_pool()
        adapter = PostgresThreadAdapter(dsn="postgresql://fake/db")
        adapter._pool = pool

        await adapter.update_weight("test-uuid", 0.9)
        conn.execute.assert_called_once()
        args = conn.execute.call_args[0]
        assert 0.9 in args

    @pytest.mark.asyncio
    async def test_ensure_pool_creates_pool(self) -> None:
        """_ensure_pool lazy-creates the asyncpg pool."""
        import sys

        adapter = PostgresThreadAdapter(dsn="postgresql://fake/db")
        assert adapter._pool is None

        fake_pool = MagicMock()
        fake_conn = MagicMock()
        fake_conn.execute = AsyncMock()
        fake_pool.acquire = MagicMock()
        fake_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=fake_conn)
        fake_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)

        mock_asyncpg = MagicMock()
        mock_asyncpg.create_pool = AsyncMock(return_value=fake_pool)

        with patch.dict(sys.modules, {"asyncpg": mock_asyncpg}):
            result = await adapter._ensure_pool()

        assert result is fake_pool
        assert adapter._pool is fake_pool
        mock_asyncpg.create_pool.assert_called_once_with("postgresql://fake/db")

    @pytest.mark.asyncio
    async def test_ensure_pool_reuses_existing(self) -> None:
        """_ensure_pool returns existing pool without re-creating."""
        adapter = PostgresThreadAdapter(dsn="postgresql://fake/db")
        existing_pool = MagicMock()
        adapter._pool = existing_pool

        # When pool already exists, _ensure_pool returns it immediately
        result = await adapter._ensure_pool()

        assert result is existing_pool
