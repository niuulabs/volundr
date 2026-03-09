"""Tests for PostgreSQL saved prompt repository."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from volundr.adapters.outbound.postgres_prompts import PostgresPromptRepository
from volundr.domain.models import PromptScope, SavedPrompt


def _mock_row(**overrides):
    defaults = {
        "id": uuid4(),
        "name": "test-prompt",
        "content": "You are a helpful assistant.",
        "scope": "global",
        "project_repo": None,
        "tags": ["test", "demo"],
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    defaults.update(overrides)
    row = MagicMock()
    row.__getitem__ = lambda self, key: defaults[key]
    return row


def _make_repo(pool=None):
    if pool is None:
        pool = AsyncMock()
    return PostgresPromptRepository(pool), pool


class TestCreate:
    async def test_create_inserts_and_returns(self):
        repo, pool = _make_repo()
        prompt = SavedPrompt(name="test", content="Hello")

        result = await repo.create(prompt)

        assert result is prompt
        pool.execute.assert_called_once()
        call_sql = pool.execute.call_args[0][0]
        assert "INSERT INTO saved_prompts" in call_sql


class TestGet:
    async def test_get_existing(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = _mock_row()

        result = await repo.get(uuid4())

        assert result is not None
        assert result.name == "test-prompt"

    async def test_get_missing(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = None

        result = await repo.get(uuid4())

        assert result is None


class TestList:
    async def test_list_all(self):
        repo, pool = _make_repo()
        pool.fetch.return_value = [_mock_row(), _mock_row(name="second")]

        result = await repo.list()

        assert len(result) == 2

    async def test_list_by_scope(self):
        repo, pool = _make_repo()
        pool.fetch.return_value = [_mock_row()]

        result = await repo.list(scope=PromptScope.GLOBAL)

        assert len(result) == 1
        call_sql = pool.fetch.call_args[0][0]
        assert "scope" in call_sql

    async def test_list_by_repo(self):
        repo, pool = _make_repo()
        pool.fetch.return_value = [_mock_row()]

        result = await repo.list(repo="https://github.com/org/repo")

        assert len(result) == 1
        call_sql = pool.fetch.call_args[0][0]
        assert "project_repo" in call_sql

    async def test_list_with_both_filters(self):
        repo, pool = _make_repo()
        pool.fetch.return_value = []

        result = await repo.list(scope=PromptScope.PROJECT, repo="https://github.com/org/repo")

        assert len(result) == 0


class TestUpdate:
    async def test_update_returns_prompt(self):
        repo, pool = _make_repo()
        prompt = SavedPrompt(name="updated", content="New content")

        result = await repo.update(prompt)

        assert result is prompt
        pool.execute.assert_called_once()
        call_sql = pool.execute.call_args[0][0]
        assert "UPDATE saved_prompts" in call_sql


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


class TestSearch:
    async def test_search_returns_results(self):
        repo, pool = _make_repo()
        pool.fetch.return_value = [_mock_row()]

        result = await repo.search("test")

        assert len(result) == 1
        call_sql = pool.fetch.call_args[0][0]
        assert "ILIKE" in call_sql

    async def test_search_empty(self):
        repo, pool = _make_repo()
        pool.fetch.return_value = []

        result = await repo.search("nonexistent")

        assert len(result) == 0


class TestRowToPrompt:
    def test_converts_row(self):
        row = _mock_row()
        result = PostgresPromptRepository._row_to_prompt(row)

        assert isinstance(result, SavedPrompt)
        assert result.scope == PromptScope.GLOBAL
        assert result.tags == ["test", "demo"]

    def test_handles_none_tags(self):
        row = _mock_row(tags=None)
        result = PostgresPromptRepository._row_to_prompt(row)

        assert result.tags == []
