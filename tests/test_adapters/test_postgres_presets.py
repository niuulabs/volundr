"""Tests for PostgreSQL preset repository."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from volundr.adapters.outbound.postgres_presets import PostgresPresetRepository
from volundr.domain.models import Preset


def _mock_row(**overrides):
    defaults = {
        "id": uuid4(),
        "name": "default-preset",
        "description": "A test preset",
        "is_default": False,
        "cli_tool": "claude",
        "workload_type": "session",
        "model": "claude-sonnet-4-20250514",
        "system_prompt": None,
        "resource_config": json.dumps({}),
        "mcp_servers": json.dumps([]),
        "terminal_sidecar": json.dumps({}),
        "skills": json.dumps([]),
        "rules": json.dumps([]),
        "env_vars": json.dumps({}),
        "env_secret_refs": json.dumps([]),
        "source": None,
        "integration_ids": json.dumps([]),
        "setup_scripts": json.dumps([]),
        "workload_config": json.dumps({}),
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    defaults.update(overrides)
    row = MagicMock()
    row.__getitem__ = lambda self, key: defaults[key]
    row.get = lambda key, default=None: defaults.get(key, default)
    return row


def _make_repo(pool=None):
    if pool is None:
        pool = AsyncMock()
    return PostgresPresetRepository(pool), pool


class TestCreate:
    async def test_create_inserts_and_returns(self):
        repo, pool = _make_repo()
        preset = Preset(name="test", cli_tool="claude")

        result = await repo.create(preset)

        assert result is preset
        pool.execute.assert_called_once()
        call_sql = pool.execute.call_args[0][0]
        assert "INSERT INTO volundr_presets" in call_sql


class TestGet:
    async def test_get_existing(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = _mock_row()

        result = await repo.get(uuid4())

        assert result is not None
        assert result.name == "default-preset"

    async def test_get_missing(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = None

        result = await repo.get(uuid4())

        assert result is None


class TestGetByName:
    async def test_get_by_name_existing(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = _mock_row(name="my-preset")

        result = await repo.get_by_name("my-preset")

        assert result is not None
        assert result.name == "my-preset"

    async def test_get_by_name_missing(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = None

        result = await repo.get_by_name("missing")

        assert result is None


class TestList:
    async def test_list_all(self):
        repo, pool = _make_repo()
        pool.fetch.return_value = [_mock_row(), _mock_row(name="second")]

        result = await repo.list()

        assert len(result) == 2

    async def test_list_by_cli_tool(self):
        repo, pool = _make_repo()
        pool.fetch.return_value = [_mock_row()]

        result = await repo.list(cli_tool="claude")

        assert len(result) == 1
        call_sql = pool.fetch.call_args[0][0]
        assert "cli_tool" in call_sql

    async def test_list_by_is_default(self):
        repo, pool = _make_repo()
        pool.fetch.return_value = [_mock_row(is_default=True)]

        result = await repo.list(is_default=True)

        assert len(result) == 1
        call_sql = pool.fetch.call_args[0][0]
        assert "is_default" in call_sql

    async def test_list_with_both_filters(self):
        repo, pool = _make_repo()
        pool.fetch.return_value = []

        result = await repo.list(cli_tool="claude", is_default=True)

        assert len(result) == 0
        call_sql = pool.fetch.call_args[0][0]
        assert "cli_tool" in call_sql
        assert "is_default" in call_sql


class TestUpdate:
    async def test_update_returns_preset(self):
        repo, pool = _make_repo()
        preset = Preset(name="updated", cli_tool="claude")

        result = await repo.update(preset)

        assert result is preset
        pool.execute.assert_called_once()
        call_sql = pool.execute.call_args[0][0]
        assert "UPDATE volundr_presets" in call_sql


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


class TestClearDefault:
    async def test_clear_default(self):
        repo, pool = _make_repo()

        await repo.clear_default("claude")

        pool.execute.assert_called_once()
        call_sql = pool.execute.call_args[0][0]
        assert "is_default = FALSE" in call_sql


class TestRowToPreset:
    def test_converts_string_json_fields(self):
        row = _mock_row()
        result = PostgresPresetRepository._row_to_preset(row)

        assert isinstance(result, Preset)
        assert result.resource_config == {}
        assert result.mcp_servers == []

    def test_converts_dict_json_fields(self):
        row = _mock_row(
            resource_config={"cpu": "1"},
            mcp_servers=[{"name": "test"}],
            terminal_sidecar={"enabled": True},
            skills=[{"name": "s"}],
            rules=[{"name": "r"}],
            env_vars={"KEY": "val"},
            env_secret_refs=["secret1"],
            workload_config={"type": "pod"},
        )
        result = PostgresPresetRepository._row_to_preset(row)

        assert result.resource_config == {"cpu": "1"}
        assert result.mcp_servers == [{"name": "test"}]
