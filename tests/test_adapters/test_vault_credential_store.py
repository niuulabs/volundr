"""Tests for Vault/OpenBao credential store adapter."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import httpx
import pytest

from volundr.adapters.outbound.vault_credential_store import VaultCredentialStore
from volundr.domain.models import SecretType


def _mock_response(json_data: dict | None = None, status_code: int = 200):
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    if json_data is not None:
        resp.json.return_value = json_data
    resp.text = "error text"
    return resp


class TestInit:
    def test_default_values(self):
        store = VaultCredentialStore()
        assert store._url == "http://openbao.volundr-system:8200"
        assert store._mount_path == "secret"

    def test_custom_values(self):
        store = VaultCredentialStore(
            url="http://vault:8200",
            auth_method="token",
            mount_path="kv",
            token="s.test",
        )
        assert store._url == "http://vault:8200"
        assert store._token == "s.test"


class TestGetClient:
    async def test_creates_client(self):
        store = VaultCredentialStore(token="s.test")
        client = await store._get_client()
        assert client is not None
        await store.close()

    async def test_reuses_client(self):
        store = VaultCredentialStore()
        client1 = await store._get_client()
        client2 = await store._get_client()
        assert client1 is client2
        await store.close()


class TestClose:
    async def test_close_with_client(self):
        store = VaultCredentialStore()
        mock_client = AsyncMock()
        store._client = mock_client
        await store.close()
        mock_client.aclose.assert_called_once()
        assert store._client is None

    async def test_close_without_client(self):
        store = VaultCredentialStore()
        await store.close()  # No error


class TestPaths:
    def test_data_path(self):
        store = VaultCredentialStore(mount_path="secret")
        path = store._data_path("user", "u1", "api-key")
        assert path == "secret/data/users/u1/api-key"

    def test_metadata_path(self):
        store = VaultCredentialStore(mount_path="secret")
        path = store._metadata_path("tenant", "t1", "cred")
        assert path == "secret/metadata/tenants/t1/cred"

    def test_list_path(self):
        store = VaultCredentialStore(mount_path="secret")
        path = store._list_path("user", "u1")
        assert path == "secret/metadata/users/u1"


class TestStore:
    async def test_store_new_credential(self):
        store = VaultCredentialStore()
        mock_client = AsyncMock()
        store._client = mock_client

        # get() returns None (no existing credential)
        mock_client.get.return_value = _mock_response(status_code=404)
        # post succeeds
        mock_client.post.return_value = _mock_response({}, status_code=200)

        result = await store.store(
            owner_type="user",
            owner_id="u1",
            name="api-key",
            secret_type=SecretType.API_KEY,
            data={"key": "secret123"},
        )

        assert result.name == "api-key"
        assert result.secret_type == SecretType.API_KEY
        assert result.keys == ("key",)
        mock_client.post.assert_called_once()

    async def test_store_error_raises(self):
        store = VaultCredentialStore()
        mock_client = AsyncMock()
        store._client = mock_client

        mock_client.get.return_value = _mock_response(status_code=404)
        mock_client.post.return_value = _mock_response(status_code=500)

        with pytest.raises(RuntimeError, match="Vault store error"):
            await store.store(
                owner_type="user",
                owner_id="u1",
                name="cred",
                secret_type=SecretType.API_KEY,
                data={"key": "val"},
            )


class TestGet:
    async def test_get_existing(self):
        store = VaultCredentialStore()
        mock_client = AsyncMock()
        store._client = mock_client

        now = datetime.now(UTC)
        meta = {
            "id": str(uuid4()),
            "secret_type": "api_key",
            "keys": ["key"],
            "metadata": {},
            "owner_id": "u1",
            "owner_type": "user",
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }
        mock_client.get.return_value = _mock_response(
            {"data": {"data": {"key": "secret", "__meta__": json.dumps(meta)}}}
        )

        result = await store.get("user", "u1", "api-key")
        assert result is not None
        assert result.name == "api-key"
        assert result.secret_type == SecretType.API_KEY

    async def test_get_not_found(self):
        store = VaultCredentialStore()
        mock_client = AsyncMock()
        store._client = mock_client
        mock_client.get.return_value = _mock_response(status_code=404)

        result = await store.get("user", "u1", "missing")
        assert result is None

    async def test_get_no_meta(self):
        store = VaultCredentialStore()
        mock_client = AsyncMock()
        store._client = mock_client
        mock_client.get.return_value = _mock_response({"data": {"data": {"key": "val"}}})

        result = await store.get("user", "u1", "cred")
        assert result is None


class TestGetValue:
    async def test_get_value_existing(self):
        store = VaultCredentialStore()
        mock_client = AsyncMock()
        store._client = mock_client
        mock_client.get.return_value = _mock_response(
            {"data": {"data": {"key": "secret", "__meta__": "{}"}}}
        )

        result = await store.get_value("user", "u1", "cred")
        assert result == {"key": "secret"}
        assert "__meta__" not in result

    async def test_get_value_not_found(self):
        store = VaultCredentialStore()
        mock_client = AsyncMock()
        store._client = mock_client
        mock_client.get.return_value = _mock_response(status_code=404)

        result = await store.get_value("user", "u1", "missing")
        assert result is None


class TestDelete:
    async def test_delete(self):
        store = VaultCredentialStore()
        mock_client = AsyncMock()
        store._client = mock_client
        mock_client.delete.return_value = _mock_response(status_code=204)

        await store.delete("user", "u1", "cred")
        mock_client.delete.assert_called_once()

    async def test_delete_not_found_ok(self):
        store = VaultCredentialStore()
        mock_client = AsyncMock()
        store._client = mock_client
        mock_client.delete.return_value = _mock_response(status_code=404)

        await store.delete("user", "u1", "missing")  # No error


class TestList:
    async def test_list_empty(self):
        store = VaultCredentialStore()
        mock_client = AsyncMock()
        store._client = mock_client
        mock_client.get.return_value = _mock_response(status_code=404)

        result = await store.list("user", "u1")
        assert result == []

    async def test_list_with_credentials(self):
        store = VaultCredentialStore()
        mock_client = AsyncMock()
        store._client = mock_client

        now = datetime.now(UTC)
        meta = json.dumps(
            {
                "id": str(uuid4()),
                "secret_type": "api_key",
                "keys": ["key"],
                "metadata": {},
                "owner_id": "u1",
                "owner_type": "user",
                "created_at": now.isoformat(),
                "updated_at": now.isoformat(),
            }
        )

        # First call: list keys
        # Subsequent calls: get each credential
        mock_client.get.side_effect = [
            _mock_response({"data": {"keys": ["cred1/"]}}),
            _mock_response({"data": {"data": {"key": "val", "__meta__": meta}}}),
        ]

        result = await store.list("user", "u1")
        assert len(result) == 1

    async def test_list_filters_by_type(self):
        store = VaultCredentialStore()
        mock_client = AsyncMock()
        store._client = mock_client

        now = datetime.now(UTC)
        meta = json.dumps(
            {
                "id": str(uuid4()),
                "secret_type": "api_key",
                "keys": ["key"],
                "metadata": {},
                "owner_id": "u1",
                "owner_type": "user",
                "created_at": now.isoformat(),
                "updated_at": now.isoformat(),
            }
        )

        mock_client.get.side_effect = [
            _mock_response({"data": {"keys": ["cred1/"]}}),
            _mock_response({"data": {"data": {"key": "val", "__meta__": meta}}}),
        ]

        result = await store.list("user", "u1", secret_type=SecretType.OAUTH_TOKEN)
        assert len(result) == 0  # Filtered out because type doesn't match


class TestHealthCheck:
    async def test_healthy(self):
        store = VaultCredentialStore()
        mock_client = AsyncMock()
        store._client = mock_client
        mock_client.get.return_value = _mock_response(status_code=200)

        assert await store.health_check() is True

    async def test_unhealthy(self):
        store = VaultCredentialStore()
        mock_client = AsyncMock()
        store._client = mock_client
        mock_client.get.return_value = _mock_response(status_code=500)

        assert await store.health_check() is False

    async def test_connection_error(self):
        store = VaultCredentialStore()
        mock_client = AsyncMock()
        store._client = mock_client
        mock_client.get.side_effect = Exception("Connection refused")

        assert await store.health_check() is False
