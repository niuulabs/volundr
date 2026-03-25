"""Tests for PostgresRaidRepository with mocked asyncpg."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from tyr.adapters.postgres_raids import PostgresRaidRepository
from tyr.domain.models import (
    ConfidenceEvent,
    ConfidenceEventType,
    RaidStatus,
)


@pytest.fixture
def pool() -> MagicMock:
    return MagicMock()


@pytest.fixture
def repo(pool: MagicMock) -> PostgresRaidRepository:
    return PostgresRaidRepository(pool)


# ---------------------------------------------------------------------------
# get_raid
# ---------------------------------------------------------------------------


class TestGetRaid:
    @pytest.mark.asyncio
    async def test_found(self, repo: PostgresRaidRepository, pool: MagicMock):
        now = datetime.now(UTC)
        raid_id = uuid4()
        pool.fetchrow = AsyncMock(
            return_value={
                "id": raid_id,
                "phase_id": uuid4(),
                "tracker_id": "TRK-1",
                "name": "Raid 1",
                "description": "Do a thing",
                "acceptance_criteria": ["works"],
                "declared_files": ["main.py"],
                "estimate_hours": 2.0,
                "status": "REVIEW",
                "confidence": 0.7,
                "session_id": "ses-1",
                "branch": "raid/1",
                "chronicle_summary": "summary",
                "retry_count": 0,
                "created_at": now,
                "updated_at": now,
            }
        )

        raid = await repo.get_raid(raid_id)
        assert raid is not None
        assert raid.id == raid_id
        assert raid.name == "Raid 1"
        assert raid.status == RaidStatus.REVIEW

    @pytest.mark.asyncio
    async def test_not_found(self, repo: PostgresRaidRepository, pool: MagicMock):
        pool.fetchrow = AsyncMock(return_value=None)

        raid = await repo.get_raid(uuid4())
        assert raid is None


# ---------------------------------------------------------------------------
# update_raid_status
# ---------------------------------------------------------------------------


class TestUpdateRaidStatus:
    @pytest.mark.asyncio
    async def test_updates_status(self, repo: PostgresRaidRepository, pool: MagicMock):
        now = datetime.now(UTC)
        raid_id = uuid4()
        pool.fetchrow = AsyncMock(
            return_value={
                "id": raid_id,
                "phase_id": uuid4(),
                "tracker_id": "TRK-1",
                "name": "Raid 1",
                "description": "",
                "acceptance_criteria": [],
                "declared_files": [],
                "estimate_hours": None,
                "status": "MERGED",
                "confidence": 0.8,
                "session_id": None,
                "branch": None,
                "chronicle_summary": None,
                "retry_count": 0,
                "created_at": now,
                "updated_at": now,
            }
        )

        updated = await repo.update_raid_status(raid_id, RaidStatus.MERGED)
        assert updated is not None
        assert updated.status == RaidStatus.MERGED

    @pytest.mark.asyncio
    async def test_returns_none_when_missing(self, repo: PostgresRaidRepository, pool: MagicMock):
        pool.fetchrow = AsyncMock(return_value=None)

        result = await repo.update_raid_status(uuid4(), RaidStatus.FAILED)
        assert result is None

    @pytest.mark.asyncio
    async def test_increment_retry(self, repo: PostgresRaidRepository, pool: MagicMock):
        now = datetime.now(UTC)
        raid_id = uuid4()
        pool.fetchrow = AsyncMock(
            return_value={
                "id": raid_id,
                "phase_id": uuid4(),
                "tracker_id": "TRK-1",
                "name": "Raid 1",
                "description": "",
                "acceptance_criteria": [],
                "declared_files": [],
                "estimate_hours": None,
                "status": "PENDING",
                "confidence": 0.5,
                "session_id": None,
                "branch": None,
                "chronicle_summary": None,
                "retry_count": 2,
                "created_at": now,
                "updated_at": now,
            }
        )

        updated = await repo.update_raid_status(raid_id, RaidStatus.PENDING, increment_retry=True)
        assert updated is not None
        assert updated.retry_count == 2
        # Verify SQL uses retry_count + 1
        call_args = pool.fetchrow.call_args
        assert "retry_count + 1" in call_args[0][0]


# ---------------------------------------------------------------------------
# add_confidence_event
# ---------------------------------------------------------------------------


class TestAddConfidenceEvent:
    @pytest.mark.asyncio
    async def test_inserts_event_and_updates_raid(
        self, repo: PostgresRaidRepository, pool: MagicMock
    ):
        pool.execute = AsyncMock()
        event = ConfidenceEvent(
            id=uuid4(),
            raid_id=uuid4(),
            event_type=ConfidenceEventType.HUMAN_APPROVED,
            delta=0.15,
            score_after=0.65,
            created_at=datetime.now(UTC),
        )

        await repo.add_confidence_event(event)

        assert pool.execute.call_count == 2
        # First call inserts the event
        first_sql = pool.execute.call_args_list[0][0][0]
        assert "INSERT INTO confidence_events" in first_sql
        # Second call updates the raid confidence
        second_sql = pool.execute.call_args_list[1][0][0]
        assert "UPDATE raids SET confidence" in second_sql


# ---------------------------------------------------------------------------
# get_confidence_events
# ---------------------------------------------------------------------------


class TestGetConfidenceEvents:
    @pytest.mark.asyncio
    async def test_returns_events(self, repo: PostgresRaidRepository, pool: MagicMock):
        now = datetime.now(UTC)
        pool.fetch = AsyncMock(
            return_value=[
                {
                    "id": uuid4(),
                    "raid_id": uuid4(),
                    "event_type": "ci_pass",
                    "delta": 0.1,
                    "score_after": 0.6,
                    "created_at": now,
                }
            ]
        )

        events = await repo.get_confidence_events(uuid4())
        assert len(events) == 1
        assert events[0].event_type == ConfidenceEventType.CI_PASS


# ---------------------------------------------------------------------------
# get_saga_for_raid / get_phase_for_raid / all_raids_merged
# ---------------------------------------------------------------------------


class TestRelationshipQueries:
    @pytest.mark.asyncio
    async def test_get_saga_found(self, repo: PostgresRaidRepository, pool: MagicMock):
        now = datetime.now(UTC)
        pool.fetchrow = AsyncMock(
            return_value={
                "id": uuid4(),
                "tracker_id": "proj-1",
                "tracker_type": "linear",
                "slug": "alpha",
                "name": "Alpha",
                "repos": ["org/repo"],
                "feature_branch": "feat/alpha",
                "status": "ACTIVE",
                "confidence": 0.5,
                "created_at": now,
                "owner_id": "user-1",
            }
        )

        saga = await repo.get_saga_for_raid(uuid4())
        assert saga is not None
        assert saga.name == "Alpha"
        assert saga.feature_branch == "feat/alpha"

    @pytest.mark.asyncio
    async def test_get_saga_not_found(self, repo: PostgresRaidRepository, pool: MagicMock):
        pool.fetchrow = AsyncMock(return_value=None)
        assert await repo.get_saga_for_raid(uuid4()) is None

    @pytest.mark.asyncio
    async def test_get_owner_found(self, repo: PostgresRaidRepository, pool: MagicMock):
        pool.fetchrow = AsyncMock(return_value={"owner_id": "user-42"})
        assert await repo.get_owner_for_raid(uuid4()) == "user-42"

    @pytest.mark.asyncio
    async def test_get_owner_not_found(self, repo: PostgresRaidRepository, pool: MagicMock):
        pool.fetchrow = AsyncMock(return_value=None)
        assert await repo.get_owner_for_raid(uuid4()) is None

    @pytest.mark.asyncio
    async def test_get_owner_empty_string(self, repo: PostgresRaidRepository, pool: MagicMock):
        pool.fetchrow = AsyncMock(return_value={"owner_id": ""})
        assert await repo.get_owner_for_raid(uuid4()) is None

    @pytest.mark.asyncio
    async def test_get_phase_found(self, repo: PostgresRaidRepository, pool: MagicMock):
        pool.fetchrow = AsyncMock(
            return_value={
                "id": uuid4(),
                "saga_id": uuid4(),
                "tracker_id": "phase-1",
                "number": 1,
                "name": "Phase 1",
                "status": "ACTIVE",
                "confidence": 0.5,
            }
        )

        phase = await repo.get_phase_for_raid(uuid4())
        assert phase is not None
        assert phase.name == "Phase 1"

    @pytest.mark.asyncio
    async def test_all_raids_merged_true(self, repo: PostgresRaidRepository, pool: MagicMock):
        pool.fetchrow = AsyncMock(return_value={"remaining": 0})
        assert await repo.all_raids_merged(uuid4()) is True

    @pytest.mark.asyncio
    async def test_all_raids_merged_false(self, repo: PostgresRaidRepository, pool: MagicMock):
        pool.fetchrow = AsyncMock(return_value={"remaining": 2})
        assert await repo.all_raids_merged(uuid4()) is False
