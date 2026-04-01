"""Tests for PostgresReviewerOutcomeRepository with mocked asyncpg pool."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from tyr.adapters.postgres_reviewer_outcomes import PostgresReviewerOutcomeRepository
from tyr.domain.models import ReviewerOutcome

NOW = datetime.now(UTC)


@pytest.fixture
def mock_pool() -> MagicMock:
    pool = MagicMock()
    pool.execute = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    pool.fetchrow = AsyncMock(return_value=None)
    return pool


@pytest.fixture
def repo(mock_pool: MagicMock) -> PostgresReviewerOutcomeRepository:
    return PostgresReviewerOutcomeRepository(mock_pool)


class TestRecord:
    @pytest.mark.asyncio
    async def test_inserts_outcome(
        self, repo: PostgresReviewerOutcomeRepository, mock_pool: MagicMock
    ) -> None:
        outcome = ReviewerOutcome(
            id=uuid4(),
            raid_id=uuid4(),
            owner_id="user-1",
            reviewer_decision="auto_approved",
            reviewer_confidence=0.92,
            reviewer_issues_count=0,
            decision_at=NOW,
        )
        await repo.record(outcome)
        mock_pool.execute.assert_called_once()
        sql = mock_pool.execute.call_args[0][0]
        assert "INSERT INTO tyr_reviewer_outcomes" in sql
        assert mock_pool.execute.call_args[0][1] == outcome.id

    @pytest.mark.asyncio
    async def test_inserts_with_none_decision_at(
        self, repo: PostgresReviewerOutcomeRepository, mock_pool: MagicMock
    ) -> None:
        outcome = ReviewerOutcome(
            id=uuid4(),
            raid_id=uuid4(),
            owner_id="user-1",
            reviewer_decision="retried",
            reviewer_confidence=0.5,
        )
        await repo.record(outcome)
        mock_pool.execute.assert_called_once()
        # decision_at=None should be replaced with now()
        args = mock_pool.execute.call_args[0]
        # arg at index 8 is decision_at
        assert args[8] is not None  # filled in by adapter


class TestResolve:
    @pytest.mark.asyncio
    async def test_updates_unresolved(
        self, repo: PostgresReviewerOutcomeRepository, mock_pool: MagicMock
    ) -> None:
        raid_id = uuid4()
        await repo.resolve(raid_id, "merged")
        mock_pool.execute.assert_called_once()
        sql = mock_pool.execute.call_args[0][0]
        assert "UPDATE tyr_reviewer_outcomes" in sql
        assert "actual_outcome" in sql
        assert mock_pool.execute.call_args[0][1] == raid_id
        assert mock_pool.execute.call_args[0][2] == "merged"

    @pytest.mark.asyncio
    async def test_resolve_with_notes(
        self, repo: PostgresReviewerOutcomeRepository, mock_pool: MagicMock
    ) -> None:
        raid_id = uuid4()
        await repo.resolve(raid_id, "reverted", notes="Broke staging")
        args = mock_pool.execute.call_args[0]
        assert args[4] == "Broke staging"


class TestListRecent:
    @pytest.mark.asyncio
    async def test_queries_by_owner(
        self, repo: PostgresReviewerOutcomeRepository, mock_pool: MagicMock
    ) -> None:
        mock_pool.fetch.return_value = []
        result = await repo.list_recent("user-1", limit=50)
        assert result == []
        sql = mock_pool.fetch.call_args[0][0]
        assert "owner_id" in sql
        assert "ORDER BY decision_at DESC" in sql
        assert mock_pool.fetch.call_args[0][1] == "user-1"
        assert mock_pool.fetch.call_args[0][2] == 50

    @pytest.mark.asyncio
    async def test_maps_rows_to_outcomes(
        self, repo: PostgresReviewerOutcomeRepository, mock_pool: MagicMock
    ) -> None:
        outcome_id = uuid4()
        raid_id = uuid4()
        mock_pool.fetch.return_value = [
            {
                "id": outcome_id,
                "raid_id": raid_id,
                "owner_id": "user-1",
                "reviewer_decision": "auto_approved",
                "reviewer_confidence": 0.92,
                "reviewer_issues_count": 0,
                "actual_outcome": "merged",
                "decision_at": NOW,
                "resolved_at": NOW,
                "notes": None,
            }
        ]
        result = await repo.list_recent("user-1")
        assert len(result) == 1
        assert result[0].id == outcome_id
        assert result[0].reviewer_decision == "auto_approved"
        assert result[0].actual_outcome == "merged"


class TestDivergenceRate:
    @pytest.mark.asyncio
    async def test_zero_total_returns_zero(
        self, repo: PostgresReviewerOutcomeRepository, mock_pool: MagicMock
    ) -> None:
        mock_pool.fetchrow.return_value = {"diverged": 0, "total": 0}
        rate = await repo.divergence_rate("user-1")
        assert rate == 0.0

    @pytest.mark.asyncio
    async def test_computes_fraction(
        self, repo: PostgresReviewerOutcomeRepository, mock_pool: MagicMock
    ) -> None:
        mock_pool.fetchrow.return_value = {"diverged": 2, "total": 5}
        rate = await repo.divergence_rate("user-1")
        assert rate == pytest.approx(0.4)

    @pytest.mark.asyncio
    async def test_all_diverged(
        self, repo: PostgresReviewerOutcomeRepository, mock_pool: MagicMock
    ) -> None:
        mock_pool.fetchrow.return_value = {"diverged": 3, "total": 3}
        rate = await repo.divergence_rate("user-1")
        assert rate == 1.0

    @pytest.mark.asyncio
    async def test_passes_window_days(
        self, repo: PostgresReviewerOutcomeRepository, mock_pool: MagicMock
    ) -> None:
        mock_pool.fetchrow.return_value = {"diverged": 0, "total": 0}
        await repo.divergence_rate("user-1", window_days=7)
        args = mock_pool.fetchrow.call_args[0]
        assert args[1] == "user-1"
        assert args[2] == 7

    @pytest.mark.asyncio
    async def test_sql_filters_auto_approved(
        self, repo: PostgresReviewerOutcomeRepository, mock_pool: MagicMock
    ) -> None:
        mock_pool.fetchrow.return_value = {"diverged": 0, "total": 0}
        await repo.divergence_rate("user-1")
        sql = mock_pool.fetchrow.call_args[0][0]
        assert "auto_approved" in sql
        assert "actual_outcome IS NOT NULL" in sql
        assert "reverted" in sql
        assert "abandoned" in sql


class TestListUnresolved:
    @pytest.mark.asyncio
    async def test_queries_by_owner(
        self, repo: PostgresReviewerOutcomeRepository, mock_pool: MagicMock
    ) -> None:
        mock_pool.fetch.return_value = []
        result = await repo.list_unresolved("user-1")
        assert result == []
        sql = mock_pool.fetch.call_args[0][0]
        assert "actual_outcome IS NULL" in sql
        assert mock_pool.fetch.call_args[0][1] == "user-1"

    @pytest.mark.asyncio
    async def test_maps_rows(
        self, repo: PostgresReviewerOutcomeRepository, mock_pool: MagicMock
    ) -> None:
        oid = uuid4()
        rid = uuid4()
        mock_pool.fetch.return_value = [
            {
                "id": oid,
                "raid_id": rid,
                "owner_id": "user-1",
                "reviewer_decision": "auto_approved",
                "reviewer_confidence": 0.9,
                "reviewer_issues_count": 0,
                "actual_outcome": None,
                "decision_at": NOW,
                "resolved_at": None,
                "notes": None,
            }
        ]
        result = await repo.list_unresolved("user-1")
        assert len(result) == 1
        assert result[0].id == oid
        assert result[0].actual_outcome is None


class TestCalibrationSummary:
    @pytest.mark.asyncio
    async def test_returns_summary(
        self, repo: PostgresReviewerOutcomeRepository, mock_pool: MagicMock
    ) -> None:
        mock_pool.fetchrow.return_value = {
            "total_decisions": 10,
            "auto_approved": 7,
            "retried": 2,
            "escalated": 1,
            "pending_resolution": 3,
            "avg_confidence_approved": 0.85,
            "avg_confidence_reverted": 0.45,
            "diverged": 1,
            "total": 4,
        }
        summary = await repo.calibration_summary("user-1", window_days=30)
        assert summary.total_decisions == 10
        assert summary.auto_approved == 7
        assert summary.retried == 2
        assert summary.escalated == 1
        assert summary.pending_resolution == 3
        assert summary.window_days == 30
        assert summary.avg_confidence_approved == pytest.approx(0.85)
        assert summary.avg_confidence_reverted == pytest.approx(0.45)

    @pytest.mark.asyncio
    async def test_passes_window_days(
        self, repo: PostgresReviewerOutcomeRepository, mock_pool: MagicMock
    ) -> None:
        mock_pool.fetchrow.return_value = {
            "total_decisions": 0,
            "auto_approved": 0,
            "retried": 0,
            "escalated": 0,
            "pending_resolution": 0,
            "avg_confidence_approved": 0,
            "avg_confidence_reverted": 0,
            "diverged": 0,
            "total": 0,
        }
        summary = await repo.calibration_summary("user-1", window_days=7)
        assert summary.window_days == 7


class TestResolveByTrackerId:
    @pytest.mark.asyncio
    async def test_updates_and_returns_count(
        self, repo: PostgresReviewerOutcomeRepository, mock_pool: MagicMock
    ) -> None:
        mock_pool.execute.return_value = "UPDATE 2"
        count = await repo.resolve_by_tracker_id("TRACKER-1", "merged")
        assert count == 2
        sql = mock_pool.execute.call_args[0][0]
        assert "UPDATE tyr_reviewer_outcomes" in sql
        assert "tracker_id" in sql

    @pytest.mark.asyncio
    async def test_returns_zero_when_none(
        self, repo: PostgresReviewerOutcomeRepository, mock_pool: MagicMock
    ) -> None:
        mock_pool.execute.return_value = "UPDATE 0"
        count = await repo.resolve_by_tracker_id("TRACKER-X", "abandoned")
        assert count == 0

    @pytest.mark.asyncio
    async def test_passes_notes(
        self, repo: PostgresReviewerOutcomeRepository, mock_pool: MagicMock
    ) -> None:
        mock_pool.execute.return_value = "UPDATE 1"
        await repo.resolve_by_tracker_id("T-1", "reverted", notes="bad deploy")
        args = mock_pool.execute.call_args[0]
        assert args[1] == "T-1"
        assert args[2] == "reverted"
        assert args[4] == "bad deploy"

    @pytest.mark.asyncio
    async def test_empty_result(
        self, repo: PostgresReviewerOutcomeRepository, mock_pool: MagicMock
    ) -> None:
        mock_pool.execute.return_value = ""
        count = await repo.resolve_by_tracker_id("T-1", "merged")
        assert count == 0


class TestListUnresolvedOwnerIds:
    @pytest.mark.asyncio
    async def test_returns_owner_ids(
        self, repo: PostgresReviewerOutcomeRepository, mock_pool: MagicMock
    ) -> None:
        mock_pool.fetch.return_value = [
            {"owner_id": "user-1"},
            {"owner_id": "user-2"},
        ]
        result = await repo.list_unresolved_owner_ids()
        assert result == ["user-1", "user-2"]

    @pytest.mark.asyncio
    async def test_returns_empty(
        self, repo: PostgresReviewerOutcomeRepository, mock_pool: MagicMock
    ) -> None:
        mock_pool.fetch.return_value = []
        result = await repo.list_unresolved_owner_ids()
        assert result == []
