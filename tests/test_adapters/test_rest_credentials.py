"""Tests for REST credential endpoints (CredentialService-based)."""

from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from volundr.adapters.inbound.rest_credentials import create_credentials_router
from volundr.adapters.outbound.memory_credential_store import MemoryCredentialStore
from volundr.domain.models import Principal
from volundr.domain.services.credential import CredentialService
from volundr.domain.services.mount_strategies import SecretMountStrategyRegistry


def _mock_identity(principal: Principal | None = None):
    identity = AsyncMock()
    if principal is None:
        principal = Principal(
            user_id="u1",
            email="admin@test.com",
            tenant_id="t1",
            roles=["volundr:admin"],
        )
    identity.validate_token.return_value = principal
    return identity


def _make_app(identity=None) -> tuple[FastAPI, CredentialService]:
    store = MemoryCredentialStore()
    strategies = SecretMountStrategyRegistry()
    service = CredentialService(store, strategies)
    app = FastAPI()
    app.state.identity = identity or _mock_identity()
    router = create_credentials_router(service)
    app.include_router(router)
    return app, service


AUTH = {"Authorization": "Bearer tok"}
PREFIX = "/api/v1/volundr/credentials"


class TestListCredentialTypes:
    """Tests for GET /types."""

    def test_returns_all_types(self):
        app, _ = _make_app()
        client = TestClient(app)
        resp = client.get(f"{PREFIX}/types")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 6
        type_values = {t["type"] for t in data}
        assert "api_key" in type_values
        assert "generic" in type_values


class TestListUserCredentials:
    """Tests for GET /credentials."""

    def test_empty_list(self):
        app, _ = _make_app()
        client = TestClient(app)
        resp = client.get(PREFIX, headers=AUTH)
        assert resp.status_code == 200
        assert resp.json()["credentials"] == []

    def test_returns_created_credentials(self):
        app, _ = _make_app()
        client = TestClient(app)

        client.post(
            PREFIX,
            json={"name": "my-key", "secret_type": "api_key", "data": {"api_key": "secret"}},
            headers=AUTH,
        )

        resp = client.get(PREFIX, headers=AUTH)
        assert resp.status_code == 200
        creds = resp.json()["credentials"]
        assert len(creds) == 1
        assert creds[0]["name"] == "my-key"
        assert creds[0]["secret_type"] == "api_key"

    def test_filter_by_type(self):
        app, _ = _make_app()
        client = TestClient(app)

        client.post(
            PREFIX,
            json={"name": "a", "secret_type": "api_key", "data": {"api_key": "v"}},
            headers=AUTH,
        )
        client.post(
            PREFIX,
            json={"name": "b", "secret_type": "generic", "data": {"k": "v"}},
            headers=AUTH,
        )

        resp = client.get(f"{PREFIX}?secret_type=api_key", headers=AUTH)
        creds = resp.json()["credentials"]
        assert len(creds) == 1
        assert creds[0]["name"] == "a"


class TestCreateUserCredential:
    """Tests for POST /credentials."""

    def test_create_credential(self):
        app, _ = _make_app()
        client = TestClient(app)

        resp = client.post(
            PREFIX,
            json={"name": "my-key", "secret_type": "generic", "data": {"token": "abc"}},
            headers=AUTH,
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "my-key"
        assert body["secret_type"] == "generic"
        assert "token" in body["keys"]
        assert "id" in body
        assert "created_at" in body

    def test_invalid_name_rejected(self):
        app, _ = _make_app()
        client = TestClient(app)

        resp = client.post(
            PREFIX,
            json={"name": "INVALID NAME!", "data": {"k": "v"}},
            headers=AUTH,
        )
        assert resp.status_code == 422

    def test_validation_error_for_empty_api_key(self):
        app, _ = _make_app()
        client = TestClient(app)

        resp = client.post(
            PREFIX,
            json={"name": "key", "secret_type": "api_key", "data": {}},
            headers=AUTH,
        )
        assert resp.status_code == 422

    def test_invalid_secret_type(self):
        app, _ = _make_app()
        client = TestClient(app)

        resp = client.post(
            PREFIX,
            json={"name": "key", "secret_type": "nonsense", "data": {"k": "v"}},
            headers=AUTH,
        )
        assert resp.status_code == 400


class TestGetUserCredential:
    """Tests for GET /credentials/{name}."""

    def test_get_existing(self):
        app, _ = _make_app()
        client = TestClient(app)

        client.post(
            PREFIX,
            json={"name": "my-key", "secret_type": "generic", "data": {"k": "v"}},
            headers=AUTH,
        )

        resp = client.get(f"{PREFIX}/my-key", headers=AUTH)
        assert resp.status_code == 200
        assert resp.json()["name"] == "my-key"

    def test_get_missing_returns_404(self):
        app, _ = _make_app()
        client = TestClient(app)

        resp = client.get(f"{PREFIX}/nonexistent", headers=AUTH)
        assert resp.status_code == 404


class TestDeleteUserCredential:
    """Tests for DELETE /credentials/{name}."""

    def test_delete_existing(self):
        app, _ = _make_app()
        client = TestClient(app)

        client.post(
            PREFIX,
            json={"name": "my-key", "secret_type": "generic", "data": {"k": "v"}},
            headers=AUTH,
        )

        resp = client.delete(f"{PREFIX}/my-key", headers=AUTH)
        assert resp.status_code == 204

        resp = client.get(f"{PREFIX}/my-key", headers=AUTH)
        assert resp.status_code == 404

    def test_delete_missing_returns_404(self):
        app, _ = _make_app()
        client = TestClient(app)

        resp = client.delete(f"{PREFIX}/gone", headers=AUTH)
        assert resp.status_code == 404


class TestTenantCredentialEndpoints:
    """Tests for tenant credential endpoints (admin only)."""

    def test_list_tenant_credentials(self):
        app, _service = _make_app()
        client = TestClient(app)

        client.post(
            f"{PREFIX}/tenant",
            json={"name": "db-cred", "secret_type": "generic", "data": {"host": "db.local"}},
            headers=AUTH,
        )

        resp = client.get(f"{PREFIX}/tenant/list", headers=AUTH)
        assert resp.status_code == 200
        creds = resp.json()["credentials"]
        assert len(creds) == 1
        assert creds[0]["name"] == "db-cred"

    def test_create_tenant_credential(self):
        app, _ = _make_app()
        client = TestClient(app)

        resp = client.post(
            f"{PREFIX}/tenant",
            json={"name": "db-cred", "secret_type": "generic", "data": {"host": "db.local"}},
            headers=AUTH,
        )
        assert resp.status_code == 201
        assert resp.json()["name"] == "db-cred"

    def test_delete_tenant_credential(self):
        app, _ = _make_app()
        client = TestClient(app)

        client.post(
            f"{PREFIX}/tenant",
            json={"name": "db-cred", "secret_type": "generic", "data": {"k": "v"}},
            headers=AUTH,
        )

        resp = client.delete(f"{PREFIX}/tenant/db-cred", headers=AUTH)
        assert resp.status_code == 204

    def test_delete_missing_tenant_credential_returns_404(self):
        app, _ = _make_app()
        client = TestClient(app)

        resp = client.delete(f"{PREFIX}/tenant/gone", headers=AUTH)
        assert resp.status_code == 404


class TestTenantEndpointsRequireAdmin:
    """Non-admin users should be blocked from tenant endpoints."""

    def _viewer_app(self):
        viewer = Principal(
            user_id="u2",
            email="viewer@test.com",
            tenant_id="t1",
            roles=["volundr:viewer"],
        )
        app, _ = _make_app(identity=_mock_identity(viewer))
        return TestClient(app)

    def test_list_forbidden(self):
        client = self._viewer_app()
        resp = client.get(f"{PREFIX}/tenant/list", headers=AUTH)
        assert resp.status_code == 403

    def test_create_forbidden(self):
        client = self._viewer_app()
        resp = client.post(
            f"{PREFIX}/tenant",
            json={"name": "x", "data": {"k": "v"}},
            headers=AUTH,
        )
        assert resp.status_code == 403

    def test_delete_forbidden(self):
        client = self._viewer_app()
        resp = client.delete(f"{PREFIX}/tenant/x", headers=AUTH)
        assert resp.status_code == 403
