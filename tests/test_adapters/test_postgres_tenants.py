"""Tests for PostgreSQL tenant repository."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from volundr.adapters.outbound.postgres_tenants import PostgresTenantRepository
from volundr.domain.models import Tenant


def _mock_row(**overrides):
    defaults = {
        "id": "t1",
        "path": "t1",
        "name": "Test",
        "parent_id": None,
        "tier": "developer",
        "max_sessions": 5,
        "max_storage_gb": 50,
        "created_at": None,
    }
    defaults.update(overrides)
    row = MagicMock()
    row.__getitem__ = lambda self, key: defaults[key]
    return row


def _make_repo(pool=None):
    if pool is None:
        pool = AsyncMock()
    return PostgresTenantRepository(pool), pool


class TestCreate:
    async def test_create_inserts_and_returns(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = _mock_row()

        tenant = Tenant(id="t1", path="t1", name="Test")
        result = await repo.create(tenant)

        assert result.id == "t1"
        pool.fetchrow.assert_called_once()
        call_sql = pool.fetchrow.call_args[0][0]
        assert "INSERT INTO tenants" in call_sql


class TestGet:
    async def test_get_existing(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = _mock_row()

        result = await repo.get("t1")
        assert result is not None
        assert result.id == "t1"

    async def test_get_missing(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = None

        result = await repo.get("missing")
        assert result is None


class TestGetByPath:
    async def test_get_by_path_existing(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = _mock_row(path="root.child")

        result = await repo.get_by_path("root.child")
        assert result is not None
        assert result.path == "root.child"

    async def test_get_by_path_missing(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = None

        result = await repo.get_by_path("nonexistent")
        assert result is None


class TestList:
    async def test_list_all(self):
        repo, pool = _make_repo()
        pool.fetch.return_value = [_mock_row(), _mock_row(id="t2", path="t2", name="T2")]

        result = await repo.list()
        assert len(result) == 2

    async def test_list_by_parent(self):
        repo, pool = _make_repo()
        pool.fetch.return_value = [_mock_row()]

        result = await repo.list(parent_id="root")
        assert len(result) == 1
        call_sql = pool.fetch.call_args[0][0]
        assert "parent_id" in call_sql


class TestGetAncestors:
    async def test_returns_ancestors(self):
        repo, pool = _make_repo()
        pool.fetch.return_value = [
            _mock_row(id="root", path="root"),
            _mock_row(id="child", path="root.child"),
        ]

        result = await repo.get_ancestors("root.child")
        assert len(result) == 2


class TestUpdate:
    async def test_update_success(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = _mock_row(name="Updated")

        tenant = Tenant(id="t1", path="t1", name="Updated")
        result = await repo.update(tenant)
        assert result.name == "Updated"

    async def test_update_not_found_raises(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = None

        tenant = Tenant(id="missing", path="missing", name="X")
        with pytest.raises(ValueError):
            await repo.update(tenant)


class TestDelete:
    async def test_delete_success(self):
        repo, pool = _make_repo()
        pool.execute.return_value = "DELETE 1"

        result = await repo.delete("t1")
        assert result is True

    async def test_delete_not_found(self):
        repo, pool = _make_repo()
        pool.execute.return_value = "DELETE 0"

        result = await repo.delete("missing")
        assert result is False
