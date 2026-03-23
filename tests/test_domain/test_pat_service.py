"""Tests for PATService domain service."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from unittest.mock import AsyncMock
from uuid import uuid4

import jwt

from volundr.domain.models import PersonalAccessToken
from volundr.domain.services.pat import PATService

SIGNING_KEY = "test-secret-key-for-jwt-signing!"


def _make_service(repo=None, signing_key=SIGNING_KEY, ttl_days=365):
    if repo is None:
        repo = AsyncMock()
    return PATService(repo=repo, signing_key=signing_key, ttl_days=ttl_days), repo


def _make_pat(**overrides):
    defaults = {
        "id": uuid4(),
        "owner_id": "user-123",
        "name": "my-token",
        "created_at": datetime.now(UTC),
        "last_used_at": None,
    }
    defaults.update(overrides)
    return PersonalAccessToken(**defaults)


class TestCreate:
    async def test_create_returns_pat_and_jwt(self):
        service, repo = _make_service()
        pat = _make_pat()
        repo.create.return_value = pat

        result_pat, raw_jwt = await service.create("user-123", "my-token")

        assert result_pat is pat
        assert isinstance(raw_jwt, str)
        assert len(raw_jwt) > 0

    async def test_create_jwt_has_correct_payload(self):
        service, repo = _make_service(ttl_days=30)
        repo.create.return_value = _make_pat()

        _, raw_jwt = await service.create("user-abc", "deploy-key")

        payload = jwt.decode(raw_jwt, SIGNING_KEY, algorithms=["HS256"])
        assert payload["sub"] == "user-abc"
        assert payload["type"] == "pat"
        assert payload["name"] == "deploy-key"
        assert "jti" in payload
        assert "iat" in payload
        assert "exp" in payload

    async def test_create_stores_sha256_hash(self):
        service, repo = _make_service()
        repo.create.return_value = _make_pat()

        _, raw_jwt = await service.create("user-123", "my-token")

        expected_hash = hashlib.sha256(raw_jwt.encode()).hexdigest()
        call_args = repo.create.call_args[0]
        assert call_args[0] == "user-123"
        assert call_args[1] == "my-token"
        assert call_args[2] == expected_hash

    async def test_create_jwt_respects_ttl_days(self):
        service, repo = _make_service(ttl_days=7)
        repo.create.return_value = _make_pat()

        _, raw_jwt = await service.create("user-123", "short-lived")

        payload = jwt.decode(raw_jwt, SIGNING_KEY, algorithms=["HS256"])
        iat = payload["iat"]
        exp = payload["exp"]
        assert exp - iat == 7 * 86400

    async def test_create_jwt_uses_hs256(self):
        service, repo = _make_service()
        repo.create.return_value = _make_pat()

        _, raw_jwt = await service.create("user-123", "my-token")

        header = jwt.get_unverified_header(raw_jwt)
        assert header["alg"] == "HS256"

    async def test_create_unique_jti_per_call(self):
        service, repo = _make_service()
        repo.create.return_value = _make_pat()

        _, jwt1 = await service.create("user-123", "token-1")
        _, jwt2 = await service.create("user-123", "token-2")

        payload1 = jwt.decode(jwt1, SIGNING_KEY, algorithms=["HS256"])
        payload2 = jwt.decode(jwt2, SIGNING_KEY, algorithms=["HS256"])
        assert payload1["jti"] != payload2["jti"]


class TestList:
    async def test_list_delegates_to_repo(self):
        service, repo = _make_service()
        pats = [_make_pat(), _make_pat(name="second")]
        repo.list.return_value = pats

        result = await service.list("user-123")

        assert result is pats
        repo.list.assert_called_once_with("user-123")

    async def test_list_empty(self):
        service, repo = _make_service()
        repo.list.return_value = []

        result = await service.list("user-456")

        assert result == []


class TestRevoke:
    async def test_revoke_success(self):
        service, repo = _make_service()
        repo.delete.return_value = True
        pat_id = uuid4()

        result = await service.revoke(pat_id, "user-123")

        assert result is True
        repo.delete.assert_called_once_with(pat_id, "user-123")

    async def test_revoke_not_found(self):
        service, repo = _make_service()
        repo.delete.return_value = False
        pat_id = uuid4()

        result = await service.revoke(pat_id, "user-123")

        assert result is False
