"""Tests for the pgserver embedded database adapter.

These tests mock pgserver and asyncpg so they run in CI without
actually starting an embedded PostgreSQL instance.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from niuu.adapters.pgserver_embedded import PgserverEmbeddedDatabase
from niuu.ports.embedded_database import ConnectionInfo, EmbeddedDatabasePort

# ---------------------------------------------------------------------------
# Port contract
# ---------------------------------------------------------------------------


class TestEmbeddedDatabasePort:
    """Verify PgserverEmbeddedDatabase satisfies the port interface."""

    def test_implements_port(self):
        assert issubclass(PgserverEmbeddedDatabase, EmbeddedDatabasePort)

    def test_connection_info_is_frozen(self):
        info = ConnectionInfo(host="localhost", port=5432, dbname="test", user="pg")
        with pytest.raises(AttributeError):
            info.host = "other"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# DSN parsing
# ---------------------------------------------------------------------------


class TestParseDsn:
    """Test _parse_dsn covers the DSN variants pgserver produces."""

    def test_tcp_dsn(self):
        dsn = "host=127.0.0.1 port=5433 dbname=mydb user=myuser"
        info = PgserverEmbeddedDatabase._parse_dsn(dsn)
        assert info.host == "127.0.0.1"
        assert info.port == 5433
        assert info.dbname == "mydb"
        assert info.user == "myuser"

    def test_unix_socket_dsn(self):
        dsn = "host=/tmp/pg_data/.s.PGSQL.5432 dbname=postgres user=postgres"
        info = PgserverEmbeddedDatabase._parse_dsn(dsn)
        assert info.host == "/tmp/pg_data/.s.PGSQL.5432"
        assert info.port == 5432  # default when not specified
        assert info.dbname == "postgres"
        assert info.user == "postgres"

    def test_minimal_dsn_uses_defaults(self):
        dsn = "dbname=test"
        info = PgserverEmbeddedDatabase._parse_dsn(dsn)
        assert info.host == "localhost"
        assert info.port == 5432
        assert info.user == "postgres"

    def test_empty_dsn_uses_all_defaults(self):
        info = PgserverEmbeddedDatabase._parse_dsn("")
        assert info.host == "localhost"
        assert info.port == 5432
        assert info.dbname == "postgres"
        assert info.user == "postgres"


# ---------------------------------------------------------------------------
# Lifecycle tests (mocked)
# ---------------------------------------------------------------------------


def _make_mock_pg():
    """Create a mock pgserver instance with a DSN."""
    pg = MagicMock()
    pg.postmaster.dsn = "host=127.0.0.1 port=5433 dbname=postgres user=postgres"
    pg.cleanup = MagicMock()
    return pg


def _make_mock_conn():
    """Create a mock asyncpg connection."""
    conn = AsyncMock()
    conn.fetch = AsyncMock(return_value=[])
    conn.fetchval = AsyncMock(return_value=1)
    conn.close = AsyncMock()
    return conn


class TestStart:
    @pytest.mark.asyncio
    async def test_start_returns_connection_info(self):
        mock_pg = _make_mock_pg()
        mock_conn = _make_mock_conn()

        with (
            patch("niuu.adapters.pgserver_embedded.pgserver", create=True) as mock_pgserver_mod,
            patch("niuu.adapters.pgserver_embedded.asyncpg", create=True) as mock_asyncpg_mod,
        ):
            # Make the lazy imports work by patching sys.modules
            import sys

            sys.modules["pgserver"] = mock_pgserver_mod
            sys.modules["asyncpg"] = mock_asyncpg_mod
            mock_pgserver_mod.get_server = MagicMock(return_value=mock_pg)
            mock_asyncpg_mod.connect = AsyncMock(return_value=mock_conn)

            try:
                db = PgserverEmbeddedDatabase()
                info = await db.start("/tmp/test_data")

                assert info.host == "127.0.0.1"
                assert info.port == 5433
                assert info.dbname == "postgres"
                assert info.user == "postgres"
            finally:
                sys.modules.pop("pgserver", None)
                sys.modules.pop("asyncpg", None)

    @pytest.mark.asyncio
    async def test_start_raises_without_pgserver(self):
        db = PgserverEmbeddedDatabase()

        with patch.dict("sys.modules", {"pgserver": None}):
            with pytest.raises(RuntimeError, match="pgserver is not installed"):
                await db.start("/tmp/test")

    @pytest.mark.asyncio
    async def test_start_raises_without_asyncpg(self):
        mock_pg = _make_mock_pg()

        import sys

        mock_pgserver_mod = MagicMock()
        mock_pgserver_mod.get_server = MagicMock(return_value=mock_pg)
        sys.modules["pgserver"] = mock_pgserver_mod

        try:
            db = PgserverEmbeddedDatabase()
            with patch.dict("sys.modules", {"asyncpg": None}):
                with pytest.raises(RuntimeError, match="asyncpg is not installed"):
                    await db.start("/tmp/test")
        finally:
            sys.modules.pop("pgserver", None)


class TestExecute:
    @pytest.mark.asyncio
    async def test_execute_returns_rows_as_dicts(self):
        mock_conn = _make_mock_conn()
        mock_row = MagicMock()
        mock_row.__iter__ = MagicMock(return_value=iter([("id", 1), ("name", "test")]))
        mock_row.items = MagicMock(return_value=[("id", 1), ("name", "test")])
        # asyncpg Records support dict() conversion
        mock_record = {"id": 1, "name": "test"}
        mock_conn.fetch = AsyncMock(return_value=[mock_record])

        db = PgserverEmbeddedDatabase()
        db._conn = mock_conn

        rows = await db.execute("SELECT id, name FROM t WHERE id = $1", 1)
        assert rows == [{"id": 1, "name": "test"}]
        mock_conn.fetch.assert_awaited_once_with("SELECT id, name FROM t WHERE id = $1", 1)

    @pytest.mark.asyncio
    async def test_execute_raises_when_not_started(self):
        db = PgserverEmbeddedDatabase()
        with pytest.raises(RuntimeError, match="Database not started"):
            await db.execute("SELECT 1")


class TestStop:
    @pytest.mark.asyncio
    async def test_stop_closes_connection_and_cleans_up(self):
        mock_pg = _make_mock_pg()
        mock_conn = _make_mock_conn()

        db = PgserverEmbeddedDatabase()
        db._pg_instance = mock_pg
        db._conn = mock_conn

        await db.stop()

        mock_conn.close.assert_awaited_once()
        mock_pg.cleanup.assert_called_once()
        assert db._conn is None
        assert db._pg_instance is None

    @pytest.mark.asyncio
    async def test_stop_is_safe_when_not_started(self):
        db = PgserverEmbeddedDatabase()
        await db.stop()  # should not raise


class TestIsRunning:
    @pytest.mark.asyncio
    async def test_is_running_true_when_connected(self):
        mock_conn = _make_mock_conn()
        mock_conn.fetchval = AsyncMock(return_value=1)

        db = PgserverEmbeddedDatabase()
        db._conn = mock_conn

        assert await db.is_running() is True

    @pytest.mark.asyncio
    async def test_is_running_false_when_no_connection(self):
        db = PgserverEmbeddedDatabase()
        assert await db.is_running() is False

    @pytest.mark.asyncio
    async def test_is_running_false_on_connection_error(self):
        mock_conn = _make_mock_conn()
        mock_conn.fetchval = AsyncMock(side_effect=ConnectionError("gone"))

        db = PgserverEmbeddedDatabase()
        db._conn = mock_conn

        assert await db.is_running() is False


# ---------------------------------------------------------------------------
# Constructor
# ---------------------------------------------------------------------------


class TestConstructor:
    def test_default_timeouts(self):
        db = PgserverEmbeddedDatabase()
        assert db._startup_timeout_s == 30
        assert db._cleanup_timeout_s == 10

    def test_custom_timeouts(self):
        db = PgserverEmbeddedDatabase(startup_timeout_s=60, cleanup_timeout_s=20)
        assert db._startup_timeout_s == 60
        assert db._cleanup_timeout_s == 20
