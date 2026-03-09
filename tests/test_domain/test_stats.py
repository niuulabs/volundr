"""Tests for StatsService."""

from decimal import Decimal

import pytest

from tests.conftest import InMemoryStatsRepository
from volundr.domain.models import Stats
from volundr.domain.services import StatsService


@pytest.fixture
def stats_repo() -> InMemoryStatsRepository:
    """Create a stats repository with sample data."""
    return InMemoryStatsRepository(
        active_sessions=3,
        total_sessions=10,
        tokens_today=50000,
        local_tokens=20000,
        cloud_tokens=30000,
        cost_today=Decimal("1.50"),
    )


@pytest.fixture
def stats_service(stats_repo: InMemoryStatsRepository) -> StatsService:
    """Create a stats service with test repository."""
    return StatsService(stats_repo)


class TestStatsService:
    """Tests for StatsService."""

    async def test_get_stats_returns_stats(self, stats_service: StatsService) -> None:
        """Test that get_stats returns Stats object."""
        stats = await stats_service.get_stats()

        assert isinstance(stats, Stats)
        assert stats.active_sessions == 3
        assert stats.total_sessions == 10
        assert stats.tokens_today == 50000
        assert stats.local_tokens == 20000
        assert stats.cloud_tokens == 30000
        assert stats.cost_today == Decimal("1.50")

    async def test_get_stats_with_zero_values(self) -> None:
        """Test that get_stats handles zero values."""
        repo = InMemoryStatsRepository()
        service = StatsService(repo)

        stats = await service.get_stats()

        assert stats.active_sessions == 0
        assert stats.total_sessions == 0
        assert stats.tokens_today == 0
        assert stats.local_tokens == 0
        assert stats.cloud_tokens == 0
        assert stats.cost_today == Decimal("0")

    async def test_get_stats_with_updated_values(self, stats_repo: InMemoryStatsRepository) -> None:
        """Test that get_stats reflects updated values."""
        service = StatsService(stats_repo)

        # Update stats
        stats_repo.set_stats(active_sessions=5, tokens_today=100000)

        stats = await service.get_stats()

        assert stats.active_sessions == 5
        assert stats.tokens_today == 100000
        # Other values should remain unchanged
        assert stats.total_sessions == 10
        assert stats.local_tokens == 20000
