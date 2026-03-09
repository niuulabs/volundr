"""Tests for REST tenant endpoints."""

from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from volundr.adapters.inbound.rest_tenants import create_tenants_router
from volundr.domain.models import (
    Principal,
    Tenant,
    TenantMembership,
    TenantRole,
    TenantTier,
)
from volundr.domain.services.tenant import (
    TenantAlreadyExistsError,
    TenantNotFoundError,
    TenantService,
)


def _mock_identity(principal=None):
    identity = AsyncMock()
    if principal is None:
        principal = Principal(
            user_id="u1", email="admin@test.com",
            tenant_id="t1", roles=["volundr:admin"],
        )
    identity.validate_token.return_value = principal
    return identity


def _make_app(tenant_service, identity=None):
    app = FastAPI()
    app.state.identity = identity or _mock_identity()
    router = create_tenants_router(tenant_service)
    app.include_router(router)
    return app


def _sample_tenant(**overrides):
    defaults = dict(
        id="t1", path="t1", name="Test",
        tier=TenantTier.DEVELOPER, max_sessions=5, max_storage_gb=50,
    )
    defaults.update(overrides)
    return Tenant(**defaults)


AUTH = {"Authorization": "Bearer tok"}


class TestGetMe:
    """Tests for GET /me."""

    def test_returns_principal_info(self):
        svc = AsyncMock(spec=TenantService)
        app = _make_app(svc)
        client = TestClient(app)

        resp = client.get("/api/v1/volundr/me", headers=AUTH)
        assert resp.status_code == 200
        data = resp.json()
        assert data["user_id"] == "u1"
        assert data["email"] == "admin@test.com"
        assert "volundr:admin" in data["roles"]


class TestListTenants:
    """Tests for GET /tenants."""

    def test_returns_tenants(self):
        svc = AsyncMock(spec=TenantService)
        svc.list_tenants.return_value = [
            _sample_tenant(),
            _sample_tenant(id="t2", path="t2", name="T2"),
        ]
        app = _make_app(svc)
        client = TestClient(app)

        resp = client.get("/api/v1/volundr/tenants", headers=AUTH)
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_filter_by_parent(self):
        svc = AsyncMock(spec=TenantService)
        svc.list_tenants.return_value = []
        app = _make_app(svc)
        client = TestClient(app)

        resp = client.get("/api/v1/volundr/tenants?parent_id=root", headers=AUTH)
        assert resp.status_code == 200
        svc.list_tenants.assert_called_once_with("root")


class TestCreateTenant:
    """Tests for POST /tenants."""

    def test_create_success(self):
        svc = AsyncMock(spec=TenantService)
        svc.create_tenant.return_value = _sample_tenant()
        app = _make_app(svc)
        client = TestClient(app)

        resp = client.post(
            "/api/v1/volundr/tenants",
            json={"name": "Test", "tenant_id": "t1"},
            headers=AUTH,
        )
        assert resp.status_code == 201
        assert resp.json()["id"] == "t1"

    def test_create_duplicate_returns_409(self):
        svc = AsyncMock(spec=TenantService)
        svc.create_tenant.side_effect = TenantAlreadyExistsError("exists")
        app = _make_app(svc)
        client = TestClient(app)

        resp = client.post(
            "/api/v1/volundr/tenants",
            json={"name": "Dup"},
            headers=AUTH,
        )
        assert resp.status_code == 409

    def test_create_parent_not_found_returns_404(self):
        svc = AsyncMock(spec=TenantService)
        svc.create_tenant.side_effect = TenantNotFoundError("not found")
        app = _make_app(svc)
        client = TestClient(app)

        resp = client.post(
            "/api/v1/volundr/tenants",
            json={"name": "Child", "parent_id": "bad"},
            headers=AUTH,
        )
        assert resp.status_code == 404

    def test_create_requires_admin(self):
        svc = AsyncMock(spec=TenantService)
        viewer = Principal(
            user_id="u2", email="v@test.com",
            tenant_id="t1", roles=["volundr:viewer"],
        )
        app = _make_app(svc, identity=_mock_identity(viewer))
        client = TestClient(app)

        resp = client.post(
            "/api/v1/volundr/tenants",
            json={"name": "Test"},
            headers=AUTH,
        )
        assert resp.status_code == 403


class TestGetTenant:
    """Tests for GET /tenants/{id}."""

    def test_get_existing(self):
        svc = AsyncMock(spec=TenantService)
        svc.get_tenant.return_value = _sample_tenant()
        app = _make_app(svc)
        client = TestClient(app)

        resp = client.get("/api/v1/volundr/tenants/t1", headers=AUTH)
        assert resp.status_code == 200
        assert resp.json()["name"] == "Test"

    def test_get_not_found(self):
        svc = AsyncMock(spec=TenantService)
        svc.get_tenant.side_effect = TenantNotFoundError("not found")
        app = _make_app(svc)
        client = TestClient(app)

        resp = client.get("/api/v1/volundr/tenants/bad", headers=AUTH)
        assert resp.status_code == 404


class TestDeleteTenant:
    """Tests for DELETE /tenants/{id}."""

    def test_delete_success(self):
        svc = AsyncMock(spec=TenantService)
        svc.delete_tenant.return_value = True
        app = _make_app(svc)
        client = TestClient(app)

        resp = client.delete("/api/v1/volundr/tenants/t1", headers=AUTH)
        assert resp.status_code == 204

    def test_delete_not_found(self):
        svc = AsyncMock(spec=TenantService)
        svc.delete_tenant.return_value = False
        app = _make_app(svc)
        client = TestClient(app)

        resp = client.delete("/api/v1/volundr/tenants/t1", headers=AUTH)
        assert resp.status_code == 404


class TestMembers:
    """Tests for member management endpoints."""

    def test_list_members(self):
        svc = AsyncMock(spec=TenantService)
        svc.get_members.return_value = [
            TenantMembership(user_id="u1", tenant_id="t1", role=TenantRole.ADMIN),
        ]
        app = _make_app(svc)
        client = TestClient(app)

        resp = client.get("/api/v1/volundr/tenants/t1/members", headers=AUTH)
        assert resp.status_code == 200
        assert len(resp.json()) == 1
        assert resp.json()[0]["user_id"] == "u1"

    def test_add_member_success(self):
        svc = AsyncMock(spec=TenantService)
        svc.add_member.return_value = TenantMembership(
            user_id="u2", tenant_id="t1", role=TenantRole.DEVELOPER,
        )
        app = _make_app(svc)
        client = TestClient(app)

        resp = client.post(
            "/api/v1/volundr/tenants/t1/members",
            json={"user_id": "u2"},
            headers=AUTH,
        )
        assert resp.status_code == 201
        assert resp.json()["user_id"] == "u2"

    def test_add_member_tenant_not_found(self):
        svc = AsyncMock(spec=TenantService)
        svc.add_member.side_effect = TenantNotFoundError("not found")
        app = _make_app(svc)
        client = TestClient(app)

        resp = client.post(
            "/api/v1/volundr/tenants/bad/members",
            json={"user_id": "u1"},
            headers=AUTH,
        )
        assert resp.status_code == 404

    def test_add_member_user_not_found(self):
        svc = AsyncMock(spec=TenantService)
        svc.add_member.side_effect = ValueError("User not found")
        app = _make_app(svc)
        client = TestClient(app)

        resp = client.post(
            "/api/v1/volundr/tenants/t1/members",
            json={"user_id": "bad"},
            headers=AUTH,
        )
        assert resp.status_code == 404

    def test_remove_member_success(self):
        svc = AsyncMock(spec=TenantService)
        svc.remove_member.return_value = True
        app = _make_app(svc)
        client = TestClient(app)

        resp = client.delete("/api/v1/volundr/tenants/t1/members/u1", headers=AUTH)
        assert resp.status_code == 204

    def test_remove_member_not_found(self):
        svc = AsyncMock(spec=TenantService)
        svc.remove_member.return_value = False
        app = _make_app(svc)
        client = TestClient(app)

        resp = client.delete("/api/v1/volundr/tenants/t1/members/u1", headers=AUTH)
        assert resp.status_code == 404
