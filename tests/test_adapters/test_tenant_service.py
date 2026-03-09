"""Tests for TenantService."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from volundr.domain.models import (
    Principal,
    PVCRef,
    Tenant,
    TenantMembership,
    TenantTier,
    User,
    UserStatus,
)
from volundr.domain.services.tenant import (
    TenantAlreadyExistsError,
    TenantNotFoundError,
    TenantService,
)


class TestTenantServiceCreate:
    """Tests for tenant creation."""

    def _make_service(self, tenant_repo=None, user_repo=None):
        if tenant_repo is None:
            tenant_repo = AsyncMock()
        if user_repo is None:
            user_repo = AsyncMock()
        return TenantService(tenant_repo, user_repo)

    async def test_create_root_tenant(self):
        tenant_repo = AsyncMock()
        tenant_repo.get_by_path.return_value = None
        tenant_repo.create.return_value = Tenant(
            id="root", path="root", name="Root", tier=TenantTier.DEVELOPER,
        )

        service = self._make_service(tenant_repo)
        tenant = await service.create_tenant(name="Root", tenant_id="root")

        assert tenant.id == "root"
        assert tenant.path == "root"
        tenant_repo.create.assert_called_once()

    async def test_create_child_tenant(self):
        tenant_repo = AsyncMock()
        parent = Tenant(id="parent", path="parent", name="Parent")
        tenant_repo.get.return_value = parent
        tenant_repo.get_by_path.return_value = None
        tenant_repo.create.return_value = Tenant(
            id="child", path="parent.child", name="Child",
            parent_id="parent",
        )

        service = self._make_service(tenant_repo)
        tenant = await service.create_tenant(
            name="Child", tenant_id="child", parent_id="parent",
        )

        assert tenant.path == "parent.child"
        assert tenant.parent_id == "parent"

    async def test_create_tenant_duplicate_path_raises(self):
        tenant_repo = AsyncMock()
        tenant_repo.get_by_path.return_value = Tenant(
            id="existing", path="existing", name="Existing",
        )

        service = self._make_service(tenant_repo)

        with pytest.raises(TenantAlreadyExistsError):
            await service.create_tenant(name="Dup", tenant_id="existing")

    async def test_create_tenant_parent_not_found_raises(self):
        tenant_repo = AsyncMock()
        tenant_repo.get.return_value = None

        service = self._make_service(tenant_repo)

        with pytest.raises(TenantNotFoundError):
            await service.create_tenant(
                name="Child", tenant_id="child", parent_id="nonexistent",
            )


class TestTenantServiceQuota:
    """Tests for quota checking."""

    async def test_quota_allowed(self):
        tenant_repo = AsyncMock()
        tenant_repo.get_ancestors.return_value = [
            Tenant(id="root", path="root", name="Root", max_sessions=10),
        ]

        service = TenantService(tenant_repo, AsyncMock())

        async def count_fn(path):
            return 3

        result = await service.check_quota("root", count_fn)
        assert result.allowed is True
        assert result.current_sessions == 3

    async def test_quota_denied(self):
        tenant_repo = AsyncMock()
        tenant_repo.get_ancestors.return_value = [
            Tenant(id="root", path="root", name="Root", max_sessions=5),
        ]

        service = TenantService(tenant_repo, AsyncMock())

        async def count_fn(path):
            return 5

        result = await service.check_quota("root", count_fn)
        assert result.allowed is False
        assert "limit" in result.reason.lower()


class TestTenantServiceEnsureDefault:
    """Tests for ensure_default_tenant."""

    async def test_returns_existing(self):
        tenant_repo = AsyncMock()
        existing = Tenant(id="default", path="default", name="Default")
        tenant_repo.get.return_value = existing

        service = TenantService(tenant_repo, AsyncMock())
        result = await service.ensure_default_tenant()

        assert result.id == "default"
        tenant_repo.create.assert_not_called()

    async def test_creates_when_missing(self):
        tenant_repo = AsyncMock()
        tenant_repo.get.return_value = None
        tenant_repo.get_by_path.return_value = None
        created = Tenant(
            id="default", path="default", name="Default",
            max_sessions=100, max_storage_gb=500,
        )
        tenant_repo.create.return_value = created

        service = TenantService(tenant_repo, AsyncMock())
        result = await service.ensure_default_tenant()

        assert result.id == "default"
        tenant_repo.create.assert_called_once()


class TestTenantServiceMembers:
    """Tests for member management."""

    async def test_add_member(self):
        tenant_repo = AsyncMock()
        user_repo = AsyncMock()
        tenant_repo.get.return_value = Tenant(id="t1", path="t1", name="T1")
        user_repo.get.return_value = User(id="u1", email="a@b.com", status=UserStatus.ACTIVE)
        user_repo.add_membership.return_value = AsyncMock()

        service = TenantService(tenant_repo, user_repo)
        await service.add_member("t1", "u1")

        user_repo.add_membership.assert_called_once()

    async def test_add_member_tenant_not_found(self):
        tenant_repo = AsyncMock()
        tenant_repo.get.return_value = None

        service = TenantService(tenant_repo, AsyncMock())

        with pytest.raises(TenantNotFoundError):
            await service.add_member("nonexistent", "u1")

    async def test_add_member_user_not_found(self):
        tenant_repo = AsyncMock()
        tenant_repo.get.return_value = Tenant(id="t1", path="t1", name="T1")
        user_repo = AsyncMock()
        user_repo.get.return_value = None

        service = TenantService(tenant_repo, user_repo)

        with pytest.raises(ValueError, match="not found"):
            await service.add_member("t1", "missing-user")

    async def test_get_members(self):
        user_repo = AsyncMock()
        membership = TenantMembership(user_id="u1", tenant_id="t1")
        user_repo.get_members.return_value = [membership]

        service = TenantService(AsyncMock(), user_repo)
        result = await service.get_members("t1")

        assert len(result) == 1
        assert result[0].user_id == "u1"

    async def test_remove_member(self):
        user_repo = AsyncMock()
        user_repo.remove_membership.return_value = True

        service = TenantService(AsyncMock(), user_repo)
        result = await service.remove_member("t1", "u1")

        assert result is True
        user_repo.remove_membership.assert_called_once_with("u1", "t1")


class TestTenantServiceSyncFromPrincipal:
    """Tests for sync_tenant_from_principal."""

    async def test_existing_tenant_returned(self):
        tenant_repo = AsyncMock()
        existing = Tenant(id="org-1", path="org-1", name="Org")
        tenant_repo.get.return_value = existing

        service = TenantService(tenant_repo, AsyncMock())
        principal = Principal(user_id="u1", email="u@test.com", tenant_id="org-1", roles=[])
        result = await service.sync_tenant_from_principal(principal)

        assert result.id == "org-1"
        tenant_repo.create.assert_not_called()

    async def test_auto_creates_tenant(self):
        tenant_repo = AsyncMock()
        tenant_repo.get.return_value = None
        tenant_repo.get_by_path.return_value = None
        created = Tenant(id="org-1", path="org-1", name="org-1")
        tenant_repo.create.return_value = created

        service = TenantService(tenant_repo, AsyncMock())
        principal = Principal(user_id="u1", email="u@test.com", tenant_id="org-1", roles=[])
        result = await service.sync_tenant_from_principal(principal)

        assert result.id == "org-1"
        tenant_repo.create.assert_called_once()

    async def test_no_tenant_id_falls_back_to_default(self):
        tenant_repo = AsyncMock()
        default = Tenant(id="default", path="default", name="Default")
        tenant_repo.get.return_value = default

        service = TenantService(tenant_repo, AsyncMock())
        principal = Principal(user_id="u1", email="u@test.com", tenant_id="", roles=[])
        result = await service.sync_tenant_from_principal(principal)

        assert result.id == "default"


class TestTenantServiceReprovision:
    """Tests for reprovisioning."""

    async def test_reprovision_user_success(self):
        user_repo = AsyncMock()
        user = User(id="u1", email="u@test.com", status=UserStatus.ACTIVE)
        user_repo.get.return_value = user
        user_repo.update.return_value = user

        storage = AsyncMock()
        storage.provision_user_storage.return_value = PVCRef(name="home-u1")

        service = TenantService(AsyncMock(), user_repo)
        result = await service.reprovision_user("u1", storage)

        assert result.success is True
        assert result.user_id == "u1"
        assert result.home_pvc == "home-u1"

    async def test_reprovision_user_not_found(self):
        user_repo = AsyncMock()
        user_repo.get.return_value = None

        service = TenantService(AsyncMock(), user_repo)
        result = await service.reprovision_user("missing")

        assert result.success is False
        assert "not found" in result.errors[0].lower()

    async def test_reprovision_user_without_storage(self):
        user_repo = AsyncMock()
        user = User(id="u1", email="u@test.com", status=UserStatus.ACTIVE, home_pvc="existing-pvc")
        user_repo.get.return_value = user
        user_repo.update.return_value = user

        service = TenantService(AsyncMock(), user_repo)
        result = await service.reprovision_user("u1", storage=None)

        assert result.success is True
        assert result.home_pvc == "existing-pvc"

    async def test_reprovision_user_storage_failure(self):
        user_repo = AsyncMock()
        user = User(id="u1", email="u@test.com", status=UserStatus.ACTIVE)
        user_repo.get.return_value = user
        user_repo.update.return_value = user

        storage = AsyncMock()
        storage.provision_user_storage.side_effect = RuntimeError("PVC creation failed")

        service = TenantService(AsyncMock(), user_repo)
        result = await service.reprovision_user("u1", storage)

        assert result.success is False
        assert "PVC creation failed" in result.errors[0]

    async def test_reprovision_tenant(self):
        user_repo = AsyncMock()
        membership = TenantMembership(user_id="u1", tenant_id="t1")
        user_repo.get_members.return_value = [membership]
        user = User(id="u1", email="u@test.com", status=UserStatus.ACTIVE)
        user_repo.get.return_value = user
        user_repo.update.return_value = user

        service = TenantService(AsyncMock(), user_repo)
        results = await service.reprovision_tenant("t1")

        assert len(results) == 1
        assert results[0].success is True

    async def test_reprovision_tenant_empty(self):
        user_repo = AsyncMock()
        user_repo.get_members.return_value = []

        service = TenantService(AsyncMock(), user_repo)
        results = await service.reprovision_tenant("t1")

        assert results == []


class TestTenantServiceUpdateSettings:
    """Tests for updating tenant settings."""

    async def test_update_settings(self):
        tenant_repo = AsyncMock()
        tenant = Tenant(id="t1", path="t1", name="T1", max_sessions=5, max_storage_gb=50)
        tenant_repo.get.return_value = tenant
        updated = Tenant(id="t1", path="t1", name="T1", max_sessions=20, max_storage_gb=100)
        tenant_repo.update.return_value = updated

        service = TenantService(tenant_repo, AsyncMock())
        result = await service.update_tenant_settings("t1", max_sessions=20, max_storage_gb=100)

        assert result.max_sessions == 20
        assert result.max_storage_gb == 100
        tenant_repo.update.assert_called_once()

    async def test_update_settings_no_changes(self):
        tenant_repo = AsyncMock()
        tenant = Tenant(id="t1", path="t1", name="T1")
        tenant_repo.get.return_value = tenant

        service = TenantService(tenant_repo, AsyncMock())
        result = await service.update_tenant_settings("t1")

        assert result.id == "t1"
        tenant_repo.update.assert_not_called()

    async def test_update_settings_tenant_not_found(self):
        tenant_repo = AsyncMock()
        tenant_repo.get.return_value = None

        service = TenantService(tenant_repo, AsyncMock())

        with pytest.raises(TenantNotFoundError):
            await service.update_tenant_settings("nonexistent", max_sessions=10)

    async def test_update_tier(self):
        tenant_repo = AsyncMock()
        tenant = Tenant(id="t1", path="t1", name="T1", tier=TenantTier.DEVELOPER)
        tenant_repo.get.return_value = tenant
        updated = Tenant(id="t1", path="t1", name="T1", tier=TenantTier.ENTERPRISE)
        tenant_repo.update.return_value = updated

        service = TenantService(tenant_repo, AsyncMock())
        result = await service.update_tenant_settings("t1", tier=TenantTier.ENTERPRISE)

        assert result.tier == TenantTier.ENTERPRISE


class TestTenantServiceCRUD:
    """Tests for basic CRUD operations."""

    async def test_get_tenant(self):
        tenant_repo = AsyncMock()
        tenant = Tenant(id="t1", path="t1", name="T1")
        tenant_repo.get.return_value = tenant

        service = TenantService(tenant_repo, AsyncMock())
        result = await service.get_tenant("t1")

        assert result.id == "t1"

    async def test_get_tenant_not_found(self):
        tenant_repo = AsyncMock()
        tenant_repo.get.return_value = None

        service = TenantService(tenant_repo, AsyncMock())

        with pytest.raises(TenantNotFoundError):
            await service.get_tenant("missing")

    async def test_list_tenants(self):
        tenant_repo = AsyncMock()
        tenant_repo.list.return_value = [Tenant(id="t1", path="t1", name="T1")]

        service = TenantService(tenant_repo, AsyncMock())
        result = await service.list_tenants()

        assert len(result) == 1

    async def test_list_users(self):
        user_repo = AsyncMock()
        user_repo.list.return_value = [User(id="u1", email="u@test.com", status=UserStatus.ACTIVE)]

        service = TenantService(AsyncMock(), user_repo)
        result = await service.list_users()

        assert len(result) == 1

    async def test_update_tenant(self):
        tenant_repo = AsyncMock()
        tenant = Tenant(id="t1", path="t1", name="Updated")
        tenant_repo.update.return_value = tenant

        service = TenantService(tenant_repo, AsyncMock())
        result = await service.update_tenant(tenant)

        assert result.name == "Updated"

    async def test_delete_tenant(self):
        tenant_repo = AsyncMock()
        tenant_repo.delete.return_value = True

        service = TenantService(tenant_repo, AsyncMock())
        result = await service.delete_tenant("t1")

        assert result is True
