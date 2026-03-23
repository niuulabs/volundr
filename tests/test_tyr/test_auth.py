"""Tests for Tyr extract_principal authentication dependency."""

from __future__ import annotations

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from niuu.domain.models import Principal
from tyr.adapters.inbound.auth import extract_principal


@pytest.fixture
def app() -> FastAPI:
    """Create a minimal app with an endpoint using extract_principal."""
    app = FastAPI()

    @app.get("/whoami")
    async def whoami(principal: Principal = Depends(extract_principal)) -> dict:
        return {
            "user_id": principal.user_id,
            "email": principal.email,
            "tenant_id": principal.tenant_id,
            "roles": principal.roles,
        }

    return app


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


class TestExtractPrincipalWithHeaders:
    """Tests for extract_principal when Envoy headers are present."""

    def test_extracts_all_headers(self, client: TestClient):
        resp = client.get(
            "/whoami",
            headers={
                "x-auth-user-id": "user-42",
                "x-auth-email": "user@example.com",
                "x-auth-tenant": "tenant-1",
                "x-auth-roles": "volundr:admin,volundr:developer",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["user_id"] == "user-42"
        assert data["email"] == "user@example.com"
        assert data["tenant_id"] == "tenant-1"
        assert data["roles"] == ["volundr:admin", "volundr:developer"]

    def test_single_role(self, client: TestClient):
        resp = client.get(
            "/whoami",
            headers={
                "x-auth-user-id": "user-1",
                "x-auth-roles": "volundr:viewer",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["roles"] == ["volundr:viewer"]

    def test_defaults_missing_optional_headers(self, client: TestClient):
        resp = client.get(
            "/whoami",
            headers={"x-auth-user-id": "user-99"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["user_id"] == "user-99"
        assert data["email"] == ""
        assert data["tenant_id"] == ""
        assert data["roles"] == ["volundr:developer"]


class TestExtractPrincipalFallback:
    """Tests for extract_principal when no Envoy headers are present (dev/test)."""

    def test_returns_default_principal(self, client: TestClient):
        resp = client.get("/whoami")
        assert resp.status_code == 200
        data = resp.json()
        assert data["user_id"] == "default"
        assert data["email"] == ""
        assert data["tenant_id"] == ""
        assert data["roles"] == ["volundr:developer"]

    def test_empty_user_id_header_triggers_fallback(self, client: TestClient):
        resp = client.get(
            "/whoami",
            headers={"x-auth-user-id": ""},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["user_id"] == "default"
