"""Tests for Cerbos authorization adapter."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from volundr.adapters.outbound.cerbos import CerbosAuthorizationAdapter
from volundr.domain.models import Principal, TenantRole
from volundr.domain.ports import Resource


def _principal(
    user_id: str = "user-1",
    tenant_id: str = "tenant-a",
    roles: list[str] | None = None,
) -> Principal:
    return Principal(
        user_id=user_id,
        email=f"{user_id}@example.com",
        tenant_id=tenant_id,
        roles=roles or [TenantRole.DEVELOPER],
    )


def _resource(
    kind: str = "session",
    id: str = "sess-1",
    owner_id: str = "user-1",
    tenant_id: str = "tenant-a",
) -> Resource:
    return Resource(kind=kind, id=id, attr={"owner_id": owner_id, "tenant_id": tenant_id})


def _allow_response(resource_id: str, resource_kind: str, action: str) -> dict:
    return {
        "results": [
            {
                "resource": {"id": resource_id, "kind": resource_kind},
                "actions": {action: {"effect": "EFFECT_ALLOW"}},
            }
        ]
    }


def _deny_response(resource_id: str, resource_kind: str, action: str) -> dict:
    return {
        "results": [
            {
                "resource": {"id": resource_id, "kind": resource_kind},
                "actions": {action: {"effect": "EFFECT_DENY"}},
            }
        ]
    }


class TestCerbosAdapter:
    @pytest.fixture
    def adapter(self):
        return CerbosAuthorizationAdapter(url="http://cerbos:3592")

    async def test_is_allowed_returns_true_on_allow(self, adapter):
        resource = _resource()
        response = _allow_response("sess-1", "session", "read")

        mock_resp = MagicMock()
        mock_resp.json.return_value = response
        mock_resp.raise_for_status = MagicMock()

        with patch.object(
            adapter._client,
            "post",
            new_callable=AsyncMock,
            return_value=mock_resp,
        ) as mock_post:
            result = await adapter.is_allowed(_principal(), "read", resource)

        assert result is True
        mock_post.assert_called_once()
        payload = mock_post.call_args[1]["json"]
        assert payload["principal"]["id"] == "user-1"
        assert payload["resources"][0]["resource"]["kind"] == "session"

    async def test_is_allowed_returns_false_on_deny(self, adapter):
        resource = _resource()
        response = _deny_response("sess-1", "session", "delete")

        mock_resp = MagicMock()
        mock_resp.json.return_value = response
        mock_resp.raise_for_status = MagicMock()

        with patch.object(adapter._client, "post", new_callable=AsyncMock, return_value=mock_resp):
            result = await adapter.is_allowed(_principal(), "delete", resource)

        assert result is False

    async def test_is_allowed_returns_false_on_http_error(self, adapter):
        resource = _resource()

        with patch.object(
            adapter._client,
            "post",
            new_callable=AsyncMock,
            side_effect=httpx.ConnectError("connection refused"),
        ):
            result = await adapter.is_allowed(_principal(), "read", resource)

        assert result is False

    async def test_filter_allowed_returns_matching(self, adapter):
        r1 = _resource(id="s1")
        r2 = _resource(id="s2")
        r3 = _resource(id="s3")

        response = {
            "results": [
                {
                    "resource": {"id": "s1", "kind": "session"},
                    "actions": {"read": {"effect": "EFFECT_ALLOW"}},
                },
                {
                    "resource": {"id": "s2", "kind": "session"},
                    "actions": {"read": {"effect": "EFFECT_DENY"}},
                },
                {
                    "resource": {"id": "s3", "kind": "session"},
                    "actions": {"read": {"effect": "EFFECT_ALLOW"}},
                },
            ]
        }

        mock_resp = MagicMock()
        mock_resp.json.return_value = response
        mock_resp.raise_for_status = MagicMock()

        with patch.object(adapter._client, "post", new_callable=AsyncMock, return_value=mock_resp):
            result = await adapter.filter_allowed(_principal(), "read", [r1, r2, r3])

        assert len(result) == 2
        assert result[0].id == "s1"
        assert result[1].id == "s3"

    async def test_filter_allowed_empty_list(self, adapter):
        result = await adapter.filter_allowed(_principal(), "read", [])
        assert result == []

    async def test_filter_allowed_returns_empty_on_http_error(self, adapter):
        resource = _resource()
        with patch.object(
            adapter._client,
            "post",
            new_callable=AsyncMock,
            side_effect=httpx.ConnectError("connection refused"),
        ):
            result = await adapter.filter_allowed(_principal(), "read", [resource])

        assert result == []

    async def test_build_check_payload_structure(self, adapter):
        principal = _principal(user_id="alice", tenant_id="acme", roles=[TenantRole.ADMIN])
        resource = _resource(kind="session", id="s-123", owner_id="alice", tenant_id="acme")

        payload = adapter._build_check_payload(principal, "start", [resource])

        assert payload["principal"]["id"] == "alice"
        assert payload["principal"]["roles"] == [TenantRole.ADMIN]
        assert payload["principal"]["attr"]["tenant_id"] == "acme"
        assert len(payload["resources"]) == 1
        assert payload["resources"][0]["actions"] == ["start"]
        assert payload["resources"][0]["resource"]["kind"] == "session"
        assert payload["resources"][0]["resource"]["id"] == "s-123"
        assert payload["resources"][0]["resource"]["attr"]["owner_id"] == "alice"

    async def test_close(self, adapter):
        with patch.object(adapter._client, "aclose", new_callable=AsyncMock) as mock_close:
            await adapter.close()
        mock_close.assert_called_once()

    async def test_is_allowed_no_matching_result(self, adapter):
        resource = _resource(id="sess-1")
        response = {
            "results": [
                {
                    "resource": {"id": "other-id", "kind": "session"},
                    "actions": {"read": {"effect": "EFFECT_ALLOW"}},
                }
            ]
        }

        mock_resp = MagicMock()
        mock_resp.json.return_value = response
        mock_resp.raise_for_status = MagicMock()

        with patch.object(adapter._client, "post", new_callable=AsyncMock, return_value=mock_resp):
            result = await adapter.is_allowed(_principal(), "read", resource)

        assert result is False
