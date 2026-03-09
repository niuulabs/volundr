"""PostgreSQL adapter for statistics repository."""

from decimal import Decimal

import asyncpg

from volundr.domain.models import Stats
from volundr.domain.ports import StatsRepository


class PostgresStatsRepository(StatsRepository):
    """PostgreSQL implementation of StatsRepository using raw SQL."""

    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def get_stats(self) -> Stats:
        """Retrieve aggregate statistics for the dashboard."""
        async with self._pool.acquire() as conn:
            # Get session counts
            session_counts = await conn.fetchrow(
                """
                SELECT
                    COUNT(*) FILTER (WHERE status = 'running') AS active_sessions,
                    COUNT(*) AS total_sessions
                FROM sessions
                """
            )

            # Get token usage for today (UTC)
            token_stats = await conn.fetchrow(
                """
                SELECT
                    COALESCE(SUM(tokens), 0) AS tokens_today,
                    COALESCE(SUM(tokens) FILTER (WHERE provider = 'local'), 0) AS local_tokens,
                    COALESCE(SUM(tokens) FILTER (WHERE provider = 'cloud'), 0) AS cloud_tokens,
                    COALESCE(SUM(cost), 0) AS cost_today
                FROM token_usage
                WHERE recorded_at >= CURRENT_DATE AT TIME ZONE 'UTC'
                """
            )

            return Stats(
                active_sessions=session_counts["active_sessions"],
                total_sessions=session_counts["total_sessions"],
                tokens_today=token_stats["tokens_today"],
                local_tokens=token_stats["local_tokens"],
                cloud_tokens=token_stats["cloud_tokens"],
                cost_today=Decimal(str(token_stats["cost_today"])),
            )
