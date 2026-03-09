"""Domain service for aggregate statistics."""

from __future__ import annotations

import logging

from volundr.domain.models import Stats
from volundr.domain.ports import StatsRepository

logger = logging.getLogger(__name__)


class StatsService:
    """Service for retrieving aggregate statistics."""

    def __init__(self, repository: StatsRepository):
        self._repository = repository

    async def get_stats(self) -> Stats:
        """Get aggregate statistics for the dashboard."""
        return await self._repository.get_stats()
