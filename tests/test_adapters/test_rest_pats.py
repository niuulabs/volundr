"""Tests for REST personal access token endpoints."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from volundr.adapters.inbound.rest_pats import create_pats_router
from volundr.domain.models import PersonalAccessToken, Principal


def _mock_identity(principal: Principal | None = None):
    identity = AsyncMock()
    if principal is None:
        principal = Principal(
            user_id="u1",
            email="user@test.com",
            tenant_id="t1",
            roles=["volundr:developer"],
        )
    identity.validate_token.return_value = principal
    return identity


def _make_pat(
    owner_id: str = "u1",
    name: str = "my-token",
    last_used_at: datetime | None = None,
) -> PersonalAccessToken:
    return PersonalAccessToken(
        id=uuid4(),
        owner_id=owner_id,
        name=name,
        created_at=datetime.now(UTC),
        last_used_at=last_used_at,
    )


def _make_app(
    identity=None,
    pat_service: AsyncMock | None = None,
) -> tuple[FastAPI, AsyncMock]:
    service = pat_service or AsyncMock()
    app = FastAPI()
    app.state.identity = identity or _mock_identity()
    app.state.pat_service = service
    router = create_pats_router()
    app.include_router(router)
    return app, service


AUTH = {"Authorization": "Bearer tok"}
PREFIX = "/api/v1/users/tokens"


class TestCreateToken:
    """Tests for POST /api/v1/users/tokens."""

    def test_create_returns_201_with_token(self):
        pat = _make_pat()
        raw_token = "eyJhbGciOiJIUzI1NiJ9.test.sig"
        app, service = _make_app()
        service.create.return_value = (pat, raw_token)
        client = TestClient(app)

        resp = client.post(PREFIX, json={"name": "my-token"}, headers=AUTH)

        assert resp.status_code == 201
        body = resp.json()
        assert body["id"] == str(pat.id)
        assert body["name"] == "my-token"
        assert body["token"] == raw_token
        assert "created_at" in body
        service.create.assert_called_once_with("u1", "my-token")

    def test_create_with_empty_name_returns_422(self):
        app, _ = _make_app()
        client = TestClient(app)

        resp = client.post(PREFIX, json={"name": ""}, headers=AUTH)

        assert resp.status_code == 422

    def test_create_with_missing_name_returns_422(self):
        app, _ = _make_app()
        client = TestClient(app)

        resp = client.post(PREFIX, json={}, headers=AUTH)

        assert resp.status_code == 422

    def test_create_with_long_name_returns_422(self):
        app, _ = _make_app()
        client = TestClient(app)

        resp = client.post(PREFIX, json={"name": "a" * 101}, headers=AUTH)

        assert resp.status_code == 422

    def test_create_without_auth_returns_401(self):
        app, _ = _make_app()
        client = TestClient(app)

        resp = client.post(PREFIX, json={"name": "my-token"})

        assert resp.status_code == 401


class TestListTokens:
    """Tests for GET /api/v1/users/tokens."""

    def test_list_empty(self):
        app, service = _make_app()
        service.list.return_value = []
        client = TestClient(app)

        resp = client.get(PREFIX, headers=AUTH)

        assert resp.status_code == 200
        assert resp.json() == []
        service.list.assert_called_once_with("u1")

    def test_list_returns_pats(self):
        pat1 = _make_pat(name="token-a")
        pat2 = _make_pat(name="token-b", last_used_at=datetime.now(UTC))
        app, service = _make_app()
        service.list.return_value = [pat1, pat2]
        client = TestClient(app)

        resp = client.get(PREFIX, headers=AUTH)

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["name"] == "token-a"
        assert data[0]["last_used_at"] is None
        assert data[1]["name"] == "token-b"
        assert data[1]["last_used_at"] is not None
        # Ensure raw token is never in the list response
        assert "token" not in data[0]
        assert "token" not in data[1]

    def test_list_without_auth_returns_401(self):
        app, _ = _make_app()
        client = TestClient(app)

        resp = client.get(PREFIX)

        assert resp.status_code == 401


class TestRevokeToken:
    """Tests for DELETE /api/v1/users/tokens/{pat_id}."""

    def test_revoke_returns_204(self):
        pat_id = uuid4()
        app, service = _make_app()
        service.revoke.return_value = True
        client = TestClient(app)

        resp = client.delete(f"{PREFIX}/{pat_id}", headers=AUTH)

        assert resp.status_code == 204
        assert resp.content == b""
        service.revoke.assert_called_once_with(pat_id, "u1")

    def test_revoke_nonexistent_returns_404(self):
        pat_id = uuid4()
        app, service = _make_app()
        service.revoke.return_value = False
        client = TestClient(app)

        resp = client.delete(f"{PREFIX}/{pat_id}", headers=AUTH)

        assert resp.status_code == 404

    def test_revoke_invalid_uuid_returns_404(self):
        app, _ = _make_app()
        client = TestClient(app)

        resp = client.delete(f"{PREFIX}/not-a-uuid", headers=AUTH)

        assert resp.status_code == 404

    def test_revoke_without_auth_returns_401(self):
        app, _ = _make_app()
        client = TestClient(app)

        resp = client.delete(f"{PREFIX}/{uuid4()}")

        assert resp.status_code == 401
