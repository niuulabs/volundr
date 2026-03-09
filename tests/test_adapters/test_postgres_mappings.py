"""Tests for PostgreSQL project mapping repository."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from volundr.adapters.outbound.postgres_mappings import PostgresMappingRepository
from volundr.domain.models import ProjectMapping


def _mock_row(**overrides):
    defaults = {
        "id": uuid4(),
        "repo_url": "https://github.com/org/repo",
        "project_id": "PRJ-1",
        "project_name": "My Project",
        "created_at": datetime.now(UTC),
    }
    defaults.update(overrides)
    row = MagicMock()
    row.__getitem__ = lambda self, key: defaults[key]
    return row


def _make_repo(pool=None):
    if pool is None:
        pool = AsyncMock()
    return PostgresMappingRepository(pool), pool


class TestCreate:
    async def test_create_inserts_and_returns(self):
        repo, pool = _make_repo()
        mapping = ProjectMapping(
            repo_url="https://github.com/org/repo",
            project_id="PRJ-1",
            project_name="My Project",
        )

        result = await repo.create(mapping)

        assert result is mapping
        pool.execute.assert_called_once()
        call_sql = pool.execute.call_args[0][0]
        assert "INSERT INTO project_mappings" in call_sql


class TestList:
    async def test_list_returns_all(self):
        repo, pool = _make_repo()
        pool.fetch.return_value = [_mock_row(), _mock_row(project_id="PRJ-2")]

        result = await repo.list()

        assert len(result) == 2
        pool.fetch.assert_called_once()


class TestGetByRepo:
    async def test_get_by_repo_existing(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = _mock_row()

        result = await repo.get_by_repo("https://github.com/org/repo")

        assert result is not None
        assert result.repo_url == "https://github.com/org/repo"

    async def test_get_by_repo_missing(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = None

        result = await repo.get_by_repo("https://github.com/org/missing")

        assert result is None


class TestDelete:
    async def test_delete_success(self):
        repo, pool = _make_repo()
        pool.execute.return_value = "DELETE 1"

        result = await repo.delete(uuid4())

        assert result is True

    async def test_delete_not_found(self):
        repo, pool = _make_repo()
        pool.execute.return_value = "DELETE 0"

        result = await repo.delete(uuid4())

        assert result is False
