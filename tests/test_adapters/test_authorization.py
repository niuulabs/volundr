"""Tests for authorization adapters."""

from __future__ import annotations

from volundr.adapters.outbound.authorization import (
    AllowAllAuthorizationAdapter,
    SimpleRoleAuthorizationAdapter,
)
from volundr.domain.models import Principal
from volundr.domain.ports import Resource


class TestAllowAllAuthorizationAdapter:
    """Tests for AllowAllAuthorizationAdapter."""

    async def test_is_allowed_always_true(self):
        adapter = AllowAllAuthorizationAdapter()
        principal = Principal(user_id="u1", email="a@b.com", tenant_id="t1", roles=[])
        resource = Resource(kind="session", id="s1", attr={})

        assert await adapter.is_allowed(principal, "delete", resource)

    async def test_filter_allowed_returns_all(self):
        adapter = AllowAllAuthorizationAdapter()
        principal = Principal(user_id="u1", email="a@b.com", tenant_id="t1", roles=[])
        resources = [
            Resource(kind="session", id="s1", attr={}),
            Resource(kind="session", id="s2", attr={}),
        ]

        result = await adapter.filter_allowed(principal, "read", resources)
        assert len(result) == 2


class TestSimpleRoleAuthorizationAdapter:
    """Tests for SimpleRoleAuthorizationAdapter."""

    async def test_admin_can_do_anything(self):
        adapter = SimpleRoleAuthorizationAdapter()
        principal = Principal(
            user_id="u1",
            email="a@b.com",
            tenant_id="t1",
            roles=["volundr:admin"],
        )
        resource = Resource(kind="session", id="s1", attr={"owner_id": "u2"})

        assert await adapter.is_allowed(principal, "delete", resource)

    async def test_developer_can_delete_own_session(self):
        adapter = SimpleRoleAuthorizationAdapter()
        principal = Principal(
            user_id="u1",
            email="a@b.com",
            tenant_id="t1",
            roles=["volundr:developer"],
        )
        resource = Resource(kind="session", id="s1", attr={"owner_id": "u1", "tenant_id": "t1"})

        assert await adapter.is_allowed(principal, "delete", resource)

    async def test_developer_cannot_delete_others_session(self):
        adapter = SimpleRoleAuthorizationAdapter()
        principal = Principal(
            user_id="u1",
            email="a@b.com",
            tenant_id="t1",
            roles=["volundr:developer"],
        )
        resource = Resource(kind="session", id="s1", attr={"owner_id": "u2", "tenant_id": "t1"})

        assert not await adapter.is_allowed(principal, "delete", resource)

    async def test_viewer_cannot_write(self):
        adapter = SimpleRoleAuthorizationAdapter()
        principal = Principal(
            user_id="u1",
            email="a@b.com",
            tenant_id="t1",
            roles=["volundr:viewer"],
        )
        resource = Resource(kind="session", id="s1", attr={"tenant_id": "t1"})

        assert not await adapter.is_allowed(principal, "start", resource)

    async def test_viewer_can_read(self):
        adapter = SimpleRoleAuthorizationAdapter()
        principal = Principal(
            user_id="u1",
            email="a@b.com",
            tenant_id="t1",
            roles=["volundr:viewer"],
        )
        resource = Resource(kind="session", id="s1", attr={"tenant_id": "t1"})

        assert await adapter.is_allowed(principal, "read", resource)

    async def test_cross_tenant_denied(self):
        adapter = SimpleRoleAuthorizationAdapter()
        principal = Principal(
            user_id="u1",
            email="a@b.com",
            tenant_id="t1",
            roles=["volundr:developer"],
        )
        resource = Resource(kind="session", id="s1", attr={"tenant_id": "t2"})

        assert not await adapter.is_allowed(principal, "read", resource)

    async def test_filter_allowed_filters_correctly(self):
        adapter = SimpleRoleAuthorizationAdapter()
        principal = Principal(
            user_id="u1",
            email="a@b.com",
            tenant_id="t1",
            roles=["volundr:developer"],
        )
        resources = [
            Resource(kind="session", id="s1", attr={"tenant_id": "t1", "owner_id": "u1"}),
            Resource(kind="session", id="s2", attr={"tenant_id": "t2", "owner_id": "u2"}),
            Resource(kind="session", id="s3", attr={"tenant_id": "t1", "owner_id": "u2"}),
        ]

        result = await adapter.filter_allowed(principal, "delete", resources)
        assert len(result) == 1
        assert result[0].id == "s1"
