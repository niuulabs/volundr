"""Tests for PostgreSQL personal access token repository."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from volundr.adapters.outbound.postgres_pats import PostgresPATRepository
from volundr.domain.models import PersonalAccessToken


def _mock_row(**overrides):
    defaults = {
        "id": uuid4(),
        "owner_id": "user-123",
        "name": "my-token",
        "created_at": datetime.now(UTC),
        "last_used_at": None,
    }
    defaults.update(overrides)
    row = MagicMock()
    row.__getitem__ = lambda self, key: defaults[key]
    return row


def _make_repo(pool=None):
    if pool is None:
        pool = AsyncMock()
    return PostgresPATRepository(pool), pool


class TestCreate:
    async def test_create_inserts_and_returns_pat(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = _mock_row()

        result = await repo.create("user-123", "my-token", "hash-abc")

        assert isinstance(result, PersonalAccessToken)
        assert result.owner_id == "user-123"
        assert result.name == "my-token"
        pool.fetchrow.assert_called_once()
        call_sql = pool.fetchrow.call_args[0][0]
        assert "INSERT INTO personal_access_tokens" in call_sql

    async def test_create_passes_correct_params(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = _mock_row()

        await repo.create("owner-1", "token-name", "hash-xyz")

        args = pool.fetchrow.call_args[0]
        assert args[1] == "owner-1"
        assert args[2] == "token-name"
        assert args[3] == "hash-xyz"


class TestList:
    async def test_list_returns_pats(self):
        repo, pool = _make_repo()
        pool.fetch.return_value = [_mock_row(), _mock_row(name="second")]

        result = await repo.list("user-123")

        assert len(result) == 2
        assert all(isinstance(p, PersonalAccessToken) for p in result)

    async def test_list_empty(self):
        repo, pool = _make_repo()
        pool.fetch.return_value = []

        result = await repo.list("user-123")

        assert result == []

    async def test_list_filters_by_owner(self):
        repo, pool = _make_repo()
        pool.fetch.return_value = []

        await repo.list("owner-abc")

        call_sql = pool.fetch.call_args[0][0]
        assert "owner_id" in call_sql
        assert pool.fetch.call_args[0][1] == "owner-abc"


class TestGet:
    async def test_get_existing(self):
        repo, pool = _make_repo()
        pat_id = uuid4()
        pool.fetchrow.return_value = _mock_row(id=pat_id)

        result = await repo.get(pat_id, "user-123")

        assert result is not None
        assert result.id == pat_id

    async def test_get_missing(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = None

        result = await repo.get(uuid4(), "user-123")

        assert result is None

    async def test_get_scopes_by_owner(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = None
        pat_id = uuid4()

        await repo.get(pat_id, "owner-x")

        call_sql = pool.fetchrow.call_args[0][0]
        assert "owner_id" in call_sql
        assert pool.fetchrow.call_args[0][2] == "owner-x"


class TestDelete:
    async def test_delete_success(self):
        repo, pool = _make_repo()
        pool.execute.return_value = "DELETE 1"

        result = await repo.delete(uuid4(), "user-123")

        assert result is True

    async def test_delete_not_found(self):
        repo, pool = _make_repo()
        pool.execute.return_value = "DELETE 0"

        result = await repo.delete(uuid4(), "user-123")

        assert result is False

    async def test_delete_scopes_by_owner(self):
        repo, pool = _make_repo()
        pool.execute.return_value = "DELETE 0"
        pat_id = uuid4()

        await repo.delete(pat_id, "owner-y")

        call_sql = pool.execute.call_args[0][0]
        assert "owner_id" in call_sql


class TestRowToPat:
    def test_converts_row(self):
        row = _mock_row()
        result = PostgresPATRepository._row_to_pat(row)

        assert isinstance(result, PersonalAccessToken)
        assert result.owner_id == "user-123"
        assert result.name == "my-token"
        assert result.last_used_at is None

    def test_converts_row_with_last_used(self):
        now = datetime.now(UTC)
        row = _mock_row(last_used_at=now)
        result = PostgresPATRepository._row_to_pat(row)

        assert result.last_used_at == now
