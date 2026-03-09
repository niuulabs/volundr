"""Tests for PostgreSQL user repository."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from volundr.adapters.outbound.postgres_users import PostgresUserRepository
from volundr.domain.models import TenantMembership, TenantRole, User, UserStatus


def _mock_user_row(**overrides):
    defaults = {
        "id": "u1",
        "email": "a@b.com",
        "display_name": "a",
        "status": "active",
        "home_pvc": None,
        "created_at": None,
        "updated_at": None,
    }
    defaults.update(overrides)
    row = MagicMock()
    row.__getitem__ = lambda self, key: defaults[key]
    return row


def _mock_membership_row(**overrides):
    defaults = {
        "user_id": "u1",
        "tenant_id": "t1",
        "role": "volundr:developer",
        "granted_at": None,
    }
    defaults.update(overrides)
    row = MagicMock()
    row.__getitem__ = lambda self, key: defaults[key]
    return row


def _make_repo(pool=None):
    if pool is None:
        pool = AsyncMock()
    return PostgresUserRepository(pool), pool


class TestUserCreate:
    async def test_create_returns_user(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = _mock_user_row()

        user = User(id="u1", email="a@b.com", status=UserStatus.ACTIVE)
        result = await repo.create(user)
        assert result.id == "u1"
        assert result.email == "a@b.com"


class TestUserGet:
    async def test_get_existing(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = _mock_user_row()

        result = await repo.get("u1")
        assert result is not None
        assert result.id == "u1"

    async def test_get_missing(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = None

        result = await repo.get("missing")
        assert result is None


class TestUserGetByEmail:
    async def test_get_by_email(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = _mock_user_row()

        result = await repo.get_by_email("a@b.com")
        assert result is not None

    async def test_get_by_email_missing(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = None

        result = await repo.get_by_email("x@y.com")
        assert result is None


class TestUserList:
    async def test_list_users(self):
        repo, pool = _make_repo()
        pool.fetch.return_value = [_mock_user_row(), _mock_user_row(id="u2")]

        result = await repo.list()
        assert len(result) == 2


class TestUserUpdate:
    async def test_update_success(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = _mock_user_row(email="new@b.com")

        user = User(id="u1", email="new@b.com", status=UserStatus.ACTIVE)
        result = await repo.update(user)
        assert result.email == "new@b.com"

    async def test_update_not_found(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = None

        user = User(id="missing", email="x@y.com", status=UserStatus.ACTIVE)
        with pytest.raises(ValueError):
            await repo.update(user)


class TestUserDelete:
    async def test_delete_success(self):
        repo, pool = _make_repo()
        pool.execute.return_value = "DELETE 1"

        assert await repo.delete("u1") is True

    async def test_delete_not_found(self):
        repo, pool = _make_repo()
        pool.execute.return_value = "DELETE 0"

        assert await repo.delete("missing") is False


class TestMemberships:
    async def test_add_membership(self):
        repo, pool = _make_repo()
        pool.fetchrow.return_value = _mock_membership_row()

        m = TenantMembership(user_id="u1", tenant_id="t1", role=TenantRole.DEVELOPER)
        result = await repo.add_membership(m)
        assert result.user_id == "u1"
        assert result.tenant_id == "t1"

    async def test_get_memberships(self):
        repo, pool = _make_repo()
        pool.fetch.return_value = [_mock_membership_row()]

        result = await repo.get_memberships("u1")
        assert len(result) == 1

    async def test_get_members(self):
        repo, pool = _make_repo()
        pool.fetch.return_value = [_mock_membership_row(), _mock_membership_row(user_id="u2")]

        result = await repo.get_members("t1")
        assert len(result) == 2

    async def test_remove_membership_success(self):
        repo, pool = _make_repo()
        pool.execute.return_value = "DELETE 1"

        assert await repo.remove_membership("u1", "t1") is True

    async def test_remove_membership_not_found(self):
        repo, pool = _make_repo()
        pool.execute.return_value = "DELETE 0"

        assert await repo.remove_membership("u1", "t1") is False
