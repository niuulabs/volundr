"""Tests for niuu.adapters.search.postgres — PostgresSearchAdapter.

Since these tests run without a live PostgreSQL instance, we mock asyncpg at
the module boundary and verify the adapter's interface contract.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from niuu.adapters.search.postgres import PostgresSearchAdapter

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_record(
    id: str,
    content: str,
    metadata: str = "{}",
    rank_score: float = 0.8,
    embedding: str | None = None,
) -> MagicMock:
    row = MagicMock()
    row.__getitem__ = lambda self, key: {  # type: ignore[misc]
        "id": id,
        "content": content,
        "metadata": metadata,
        "rank_score": rank_score,
        "embedding": embedding,
    }[key]
    return row


def _make_pool(fts_rows: list, emb_rows: list | None = None) -> MagicMock:
    """Create a mock asyncpg pool that returns controlled rows."""
    mock_conn = AsyncMock()
    call_count = {"n": 0}
    fts_result = fts_rows
    sem_result = emb_rows or []

    async def _fetch(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return fts_result
        return sem_result

    async def _execute(*args, **kwargs):
        return None

    async def _fetchrow(*args, **kwargs):
        return None  # pgvector not available

    mock_conn.fetch = _fetch
    mock_conn.execute = _execute
    mock_conn.fetchrow = _fetchrow

    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=mock_conn)
    cm.__aexit__ = AsyncMock(return_value=False)

    pool = MagicMock()
    pool.acquire = MagicMock(return_value=cm)
    pool.close = AsyncMock()
    return pool


# ---------------------------------------------------------------------------
# Constructor
# ---------------------------------------------------------------------------


class TestPostgresSearchAdapterConstructor:
    def test_raises_on_empty_dsn(self) -> None:
        with pytest.raises(ValueError, match="DSN"):
            PostgresSearchAdapter(dsn="")

    def test_pgvector_false_before_init(self) -> None:
        adapter = PostgresSearchAdapter(dsn="postgresql://localhost/test")
        assert adapter.pgvector_available is False


# ---------------------------------------------------------------------------
# FTS search (mocked pool)
# ---------------------------------------------------------------------------


class TestPostgresSearchAdapterFts:
    @pytest.mark.asyncio
    async def test_search_returns_results(self) -> None:
        rows = [
            _make_record("doc-1", "python testing", '{"src": "a"}', rank_score=0.9),
            _make_record("doc-2", "python code", '{"src": "b"}', rank_score=0.5),
        ]
        adapter = PostgresSearchAdapter(dsn="postgresql://localhost/test")
        adapter._pool = _make_pool(rows)

        results = await adapter.search("python", limit=5)

        assert len(results) == 2
        assert results[0].id == "doc-1"
        assert results[0].score == pytest.approx(1.0)
        assert results[1].score == pytest.approx(0.5 / 0.9)

    @pytest.mark.asyncio
    async def test_empty_query_returns_empty(self) -> None:
        adapter = PostgresSearchAdapter(dsn="postgresql://localhost/test")
        adapter._pool = _make_pool([])

        results = await adapter.search("   ")
        assert results == []

    @pytest.mark.asyncio
    async def test_no_rows_returns_empty(self) -> None:
        adapter = PostgresSearchAdapter(dsn="postgresql://localhost/test")
        adapter._pool = _make_pool([])

        results = await adapter.search("anything")
        assert results == []

    @pytest.mark.asyncio
    async def test_metadata_decoded(self) -> None:
        rows = [_make_record("doc-1", "content", '{"key": "value"}', rank_score=1.0)]
        adapter = PostgresSearchAdapter(dsn="postgresql://localhost/test")
        adapter._pool = _make_pool(rows)

        results = await adapter.search("content")
        assert results[0].metadata == {"key": "value"}

    @pytest.mark.asyncio
    async def test_remove_calls_delete(self) -> None:
        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock()
        cm = AsyncMock()
        cm.__aenter__ = AsyncMock(return_value=mock_conn)
        cm.__aexit__ = AsyncMock(return_value=False)
        pool = MagicMock()
        pool.acquire = MagicMock(return_value=cm)

        adapter = PostgresSearchAdapter(dsn="postgresql://localhost/test")
        adapter._pool = pool
        await adapter.remove("doc-1")

        mock_conn.execute.assert_called_once()
        call_args = mock_conn.execute.call_args[0]
        assert "DELETE" in call_args[0]
        assert "doc-1" in call_args

    @pytest.mark.asyncio
    async def test_rebuild_is_noop(self) -> None:
        adapter = PostgresSearchAdapter(dsn="postgresql://localhost/test")
        # rebuild is a no-op for Postgres — should not raise even without a pool
        await adapter.rebuild()

    @pytest.mark.asyncio
    async def test_index_upserts_row(self) -> None:
        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock()
        cm = AsyncMock()
        cm.__aenter__ = AsyncMock(return_value=mock_conn)
        cm.__aexit__ = AsyncMock(return_value=False)
        pool = MagicMock()
        pool.acquire = MagicMock(return_value=cm)

        adapter = PostgresSearchAdapter(dsn="postgresql://localhost/test")
        adapter._pool = pool
        await adapter.index("doc-1", "hello world", {"x": 1})

        mock_conn.execute.assert_called_once()
        sql = mock_conn.execute.call_args[0][0]
        assert "INSERT INTO niuu_search_index" in sql
        assert "ON CONFLICT" in sql

    @pytest.mark.asyncio
    async def test_require_pool_raises_when_not_initialized(self) -> None:
        adapter = PostgresSearchAdapter(dsn="postgresql://localhost/test")
        with pytest.raises(RuntimeError, match="not initialized"):
            adapter._require_pool()

    @pytest.mark.asyncio
    async def test_close_noop_when_not_initialized(self) -> None:
        adapter = PostgresSearchAdapter(dsn="postgresql://localhost/test")
        await adapter.close()  # should not raise


# ---------------------------------------------------------------------------
# SearchPort interface compliance
# ---------------------------------------------------------------------------


class TestSearchPortCompliance:
    def test_is_search_port(self) -> None:
        from niuu.ports.search import SearchPort

        adapter = PostgresSearchAdapter(dsn="postgresql://localhost/test")
        assert isinstance(adapter, SearchPort)

    def test_sqlite_is_search_port(self) -> None:
        import tempfile

        from niuu.adapters.search.sqlite import SqliteSearchAdapter
        from niuu.ports.search import SearchPort

        with tempfile.NamedTemporaryFile(suffix=".db") as f:
            adapter = SqliteSearchAdapter(path=f.name)
            assert isinstance(adapter, SearchPort)
