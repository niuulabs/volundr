"""Tests for PostgresSagaRepository with mocked asyncpg pool."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from tyr.adapters.postgres_sagas import PostgresSagaRepository
from tyr.domain.models import Saga, SagaStatus


@pytest.fixture
def mock_pool() -> MagicMock:
    pool = MagicMock()
    pool.execute = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    pool.fetchrow = AsyncMock(return_value=None)
    return pool


@pytest.fixture
def repo(mock_pool: MagicMock) -> PostgresSagaRepository:
    return PostgresSagaRepository(mock_pool)


@pytest.fixture
def saga() -> Saga:
    return Saga(
        id=uuid4(),
        tracker_id="proj-1",
        tracker_type="linear",
        slug="alpha",
        name="Alpha",
        repos=["org/repo"],
        feature_branch="feat/alpha",
        status=SagaStatus.ACTIVE,
        confidence=0.0,
        created_at=datetime.now(UTC),
    )


class TestSaveSaga:
    @pytest.mark.asyncio
    async def test_inserts_saga(
        self, repo: PostgresSagaRepository, saga: Saga, mock_pool: MagicMock
    ):
        await repo.save_saga(saga)
        mock_pool.execute.assert_called_once()
        call_args = mock_pool.execute.call_args
        assert "INSERT INTO sagas" in call_args[0][0]
        assert call_args[0][1] == saga.id


class TestListSagas:
    @pytest.mark.asyncio
    async def test_returns_empty(self, repo: PostgresSagaRepository):
        result = await repo.list_sagas()
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_sagas(
        self, repo: PostgresSagaRepository, saga: Saga, mock_pool: MagicMock
    ):
        mock_pool.fetch.return_value = [
            {
                "id": saga.id,
                "tracker_id": saga.tracker_id,
                "tracker_type": saga.tracker_type,
                "slug": saga.slug,
                "name": saga.name,
                "repos": saga.repos,
                "feature_branch": saga.feature_branch,
                "status": "ACTIVE",
                "confidence": 0.0,
                "created_at": saga.created_at,
            }
        ]
        result = await repo.list_sagas()
        assert len(result) == 1
        assert result[0].tracker_id == "proj-1"

    @pytest.mark.asyncio
    async def test_list_with_owner_id(
        self, repo: PostgresSagaRepository, saga: Saga, mock_pool: MagicMock
    ):
        mock_pool.fetch.return_value = [
            {
                "id": saga.id,
                "tracker_id": saga.tracker_id,
                "tracker_type": saga.tracker_type,
                "slug": saga.slug,
                "name": saga.name,
                "repos": saga.repos,
                "feature_branch": saga.feature_branch,
                "status": "ACTIVE",
                "confidence": 0.0,
                "created_at": saga.created_at,
            }
        ]
        result = await repo.list_sagas(owner_id="user-1")
        assert len(result) == 1
        call_args = mock_pool.fetch.call_args
        assert "owner_id" in call_args[0][0]
        assert call_args[0][1] == "user-1"

    @pytest.mark.asyncio
    async def test_list_without_owner_id_no_filter(
        self, repo: PostgresSagaRepository, mock_pool: MagicMock
    ):
        mock_pool.fetch.return_value = []
        await repo.list_sagas()
        call_args = mock_pool.fetch.call_args
        assert "owner_id" not in call_args[0][0]


class TestGetSaga:
    @pytest.mark.asyncio
    async def test_not_found(self, repo: PostgresSagaRepository):
        result = await repo.get_saga(uuid4())
        assert result is None

    @pytest.mark.asyncio
    async def test_found(self, repo: PostgresSagaRepository, saga: Saga, mock_pool: MagicMock):
        mock_pool.fetchrow.return_value = {
            "id": saga.id,
            "tracker_id": saga.tracker_id,
            "tracker_type": saga.tracker_type,
            "slug": saga.slug,
            "name": saga.name,
            "repos": saga.repos,
            "feature_branch": saga.feature_branch,
            "status": "ACTIVE",
            "confidence": 0.0,
            "created_at": saga.created_at,
        }
        result = await repo.get_saga(saga.id)
        assert result is not None
        assert result.name == "Alpha"

    @pytest.mark.asyncio
    async def test_get_with_owner_id(
        self, repo: PostgresSagaRepository, saga: Saga, mock_pool: MagicMock
    ):
        mock_pool.fetchrow.return_value = {
            "id": saga.id,
            "tracker_id": saga.tracker_id,
            "tracker_type": saga.tracker_type,
            "slug": saga.slug,
            "name": saga.name,
            "repos": saga.repos,
            "feature_branch": saga.feature_branch,
            "status": "ACTIVE",
            "confidence": 0.0,
            "created_at": saga.created_at,
        }
        result = await repo.get_saga(saga.id, owner_id="user-1")
        assert result is not None
        call_args = mock_pool.fetchrow.call_args
        assert "owner_id" in call_args[0][0]
        assert call_args[0][2] == "user-1"

    @pytest.mark.asyncio
    async def test_get_with_owner_id_not_found(
        self, repo: PostgresSagaRepository, mock_pool: MagicMock
    ):
        mock_pool.fetchrow.return_value = None
        result = await repo.get_saga(uuid4(), owner_id="user-1")
        assert result is None


class TestDeleteSaga:
    @pytest.mark.asyncio
    async def test_delete_existing(self, repo: PostgresSagaRepository, mock_pool: MagicMock):
        mock_pool.execute.return_value = "DELETE 1"
        result = await repo.delete_saga(uuid4())
        assert result is True

    @pytest.mark.asyncio
    async def test_delete_not_found(self, repo: PostgresSagaRepository, mock_pool: MagicMock):
        mock_pool.execute.return_value = "DELETE 0"
        result = await repo.delete_saga(uuid4())
        assert result is False


class TestCountByStatus:
    @pytest.mark.asyncio
    async def test_returns_all_statuses_zero_when_no_raids(
        self, repo: PostgresSagaRepository, mock_pool: MagicMock
    ):
        mock_pool.fetch.return_value = []
        result = await repo.count_by_status()
        assert set(result.keys()) == {"PENDING", "QUEUED", "RUNNING", "REVIEW", "MERGED", "FAILED"}
        assert all(v == 0 for v in result.values())

    @pytest.mark.asyncio
    async def test_counts_raids_by_status(self, repo: PostgresSagaRepository, mock_pool: MagicMock):
        mock_pool.fetch.return_value = [
            {"status": "PENDING", "cnt": 3},
            {"status": "RUNNING", "cnt": 2},
            {"status": "MERGED", "cnt": 5},
        ]
        result = await repo.count_by_status()
        assert result["PENDING"] == 3
        assert result["RUNNING"] == 2
        assert result["MERGED"] == 5
        assert result["QUEUED"] == 0
        assert result["REVIEW"] == 0
        assert result["FAILED"] == 0

    @pytest.mark.asyncio
    async def test_queries_raids_table(self, repo: PostgresSagaRepository, mock_pool: MagicMock):
        mock_pool.fetch.return_value = []
        await repo.count_by_status()
        call_sql = mock_pool.fetch.call_args[0][0]
        assert "raids" in call_sql
        assert "status" in call_sql
        assert "COUNT" in call_sql
