"""Embedded PostgreSQL adapter using pgserver.

pgserver bundles platform-specific PostgreSQL binaries and manages
the full lifecycle (initdb, start, stop). This adapter wraps pgserver
behind the EmbeddedDatabasePort so the rest of the system stays
decoupled from the concrete implementation.

Nuitka notes (spike NIU-361):
    - pgserver extracts PG binaries to a temp/cache dir at runtime.
    - Nuitka --onefile must include pgserver's data files via
      ``--include-package-data=pgserver`` so the bundled binaries
      are available after extraction.
    - The ``--nofollow-import-to`` flag should NOT exclude pgserver.
    - Tested flags that work:
        nuitka --onefile \
            --include-package-data=pgserver \
            --include-package=pgserver \
            script.py
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from niuu.ports.embedded_database import ConnectionInfo, EmbeddedDatabasePort

logger = logging.getLogger(__name__)

# Defaults — no magic numbers in business logic.
_DEFAULT_STARTUP_TIMEOUT_S = 30
_DEFAULT_CLEANUP_TIMEOUT_S = 10


class PgserverEmbeddedDatabase(EmbeddedDatabasePort):
    """EmbeddedDatabasePort backed by pgserver + asyncpg."""

    def __init__(
        self,
        *,
        startup_timeout_s: int = _DEFAULT_STARTUP_TIMEOUT_S,
        cleanup_timeout_s: int = _DEFAULT_CLEANUP_TIMEOUT_S,
    ) -> None:
        self._startup_timeout_s = startup_timeout_s
        self._cleanup_timeout_s = cleanup_timeout_s
        self._pg_instance: object | None = None
        self._conn: object | None = None
        self._connection_info: ConnectionInfo | None = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self, data_dir: str) -> ConnectionInfo:
        """Start embedded PG via pgserver, then open an asyncpg connection."""
        try:
            import pgserver  # noqa: PLC0415 — lazy import, optional dep
        except ImportError as exc:
            raise RuntimeError(
                "pgserver is not installed. Install it with: pip install pgserver"
            ) from exc

        loop = asyncio.get_running_loop()
        pg = await loop.run_in_executor(None, lambda: pgserver.get_server(Path(data_dir)))
        self._pg_instance = pg

        dsn: str = pg.postmaster.dsn
        info = self._parse_dsn(dsn)
        self._connection_info = info

        try:
            import asyncpg  # noqa: PLC0415
        except ImportError as exc:
            raise RuntimeError(
                "asyncpg is not installed. Install it with: pip install asyncpg"
            ) from exc

        self._conn = await asyncio.wait_for(
            asyncpg.connect(
                host=info.host,
                port=info.port,
                database=info.dbname,
                user=info.user,
            ),
            timeout=self._startup_timeout_s,
        )
        logger.info("Embedded PG started — %s:%s/%s", info.host, info.port, info.dbname)
        return info

    async def execute(self, sql: str, *args: object) -> list[dict]:
        if self._conn is None:
            raise RuntimeError("Database not started — call start() first")

        result = await self._conn.fetch(sql, *args)
        return [dict(row) for row in result]

    async def stop(self) -> None:
        if self._conn is not None:
            await asyncio.wait_for(
                self._conn.close(),
                timeout=self._cleanup_timeout_s,
            )
            self._conn = None
            logger.info("asyncpg connection closed")

        if self._pg_instance is not None:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, self._pg_instance.cleanup)
            self._pg_instance = None
            logger.info("Embedded PG stopped")

    async def is_running(self) -> bool:
        if self._conn is None:
            return False
        try:
            await self._conn.fetchval("SELECT 1")
            return True
        except Exception:
            return False

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_dsn(dsn: str) -> ConnectionInfo:
        """Parse a libpq-style DSN into ConnectionInfo.

        pgserver returns DSNs like:
            ``host=/tmp/pgdata/.s.PGSQL.5432 dbname=postgres user=postgres``
        or TCP-style:
            ``host=localhost port=5432 dbname=postgres user=postgres``
        """
        parts: dict[str, str] = {}
        for token in dsn.split():
            if "=" in token:
                key, _, value = token.partition("=")
                parts[key] = value

        return ConnectionInfo(
            host=parts.get("host", "localhost"),
            port=int(parts.get("port", "5432")),
            dbname=parts.get("dbname", "postgres"),
            user=parts.get("user", "postgres"),
        )
