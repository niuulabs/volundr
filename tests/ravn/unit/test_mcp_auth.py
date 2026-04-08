"""Unit tests for MCP authentication (NIU-502).

Tests cover:
- MCPToken model (expiry, header generation, serialisation)
- LocalEncryptedTokenStore (read/write/delete, missing file, corrupt data)
- OpenBaoTokenStore (load/save/delete via mocked HTTP)
- acquire_api_key (happy path, missing env var)
- acquire_client_credentials (happy path, HTTP error)
- acquire_device_flow (happy path, slow_down, timeout, HTTP error)
- MCPAuthSession (authenticate all types, get_auth_headers, revoke, caching)
- MCPAuthTool.execute (all auth types, error paths)
- build_mcp_auth_tool / build_token_store helpers
- MCPTransport.set_auth_headers (HTTPTransport, SSETransport, base no-op)
- MCPServerClient.set_auth_headers
- MCPManager.get_client
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ravn.adapters.mcp.auth import (
    MCPAuthSession,
    MCPAuthType,
    MCPToken,
    OpenBaoTokenStore,
    acquire_api_key,
    acquire_client_credentials,
    acquire_device_flow,
)
from ravn.adapters.mcp.client import MCPServerClient
from ravn.adapters.mcp.sse_transport import HTTPTransport, SSETransport
from ravn.adapters.mcp.transport import MCPTransport
from ravn.adapters.tools.mcp import MCPAuthTool, build_mcp_auth_tool, build_token_store
from ravn.config import MCPAuthConfig, MCPServerConfig, MCPTokenStoreConfig

# ---------------------------------------------------------------------------
# Helpers / fakes
# ---------------------------------------------------------------------------


class FakeTokenStore:
    """In-memory token store for tests — no filesystem or encryption."""

    def __init__(self) -> None:
        self._data: dict[str, MCPToken] = {}

    async def load(self, server_name: str) -> MCPToken | None:
        return self._data.get(server_name)

    async def save(self, server_name: str, token: MCPToken) -> None:
        self._data[server_name] = token

    async def delete(self, server_name: str) -> None:
        self._data.pop(server_name, None)


def make_server_config(
    name: str = "test-server",
    auth_type: str | None = None,
    api_key_env: str = "MY_API_KEY",
    token_url: str = "https://auth.example.com/token",
    client_id: str = "my-client-id",
    client_secret_env: str = "MY_CLIENT_SECRET",
    scope: str = "read",
) -> MCPServerConfig:
    return MCPServerConfig(
        name=name,
        transport="http",
        url="http://mcp-server:8000",
        auth=MCPAuthConfig(
            auth_type=auth_type,
            api_key_env=api_key_env,
            token_url=token_url,
            client_id=client_id,
            client_secret_env=client_secret_env,
            scope=scope,
        ),
    )


# ---------------------------------------------------------------------------
# MCPToken
# ---------------------------------------------------------------------------


class TestMCPToken:
    def test_not_expired_when_no_expiry(self) -> None:
        token = MCPToken(access_token="abc", expires_at=None)
        assert not token.is_expired()

    def test_not_expired_when_future(self) -> None:
        token = MCPToken(access_token="abc", expires_at=time.time() + 3600)
        assert not token.is_expired()

    def test_expired_when_past(self) -> None:
        token = MCPToken(access_token="abc", expires_at=time.time() - 1)
        assert token.is_expired()

    def test_expired_within_buffer(self) -> None:
        # expires 20s from now — within the 30s buffer
        token = MCPToken(access_token="abc", expires_at=time.time() + 20)
        assert token.is_expired()

    def test_auth_header_value(self) -> None:
        token = MCPToken(access_token="secret", token_type="Bearer")
        assert token.auth_header_value() == "Bearer secret"

    def test_as_auth_headers(self) -> None:
        token = MCPToken(access_token="secret")
        assert token.as_auth_headers() == {"Authorization": "Bearer secret"}

    def test_round_trip_serialisation(self) -> None:
        original = MCPToken(access_token="abc", token_type="ApiKey", expires_at=9999.0)
        reconstructed = MCPToken.from_dict(original.to_dict())
        assert reconstructed.access_token == original.access_token
        assert reconstructed.token_type == original.token_type
        assert reconstructed.expires_at == original.expires_at

    def test_from_dict_defaults(self) -> None:
        token = MCPToken.from_dict({"access_token": "x"})
        assert token.token_type == "Bearer"
        assert token.expires_at is None


# ---------------------------------------------------------------------------
# LocalEncryptedTokenStore
# ---------------------------------------------------------------------------


class TestLocalEncryptedTokenStore:
    @pytest.mark.asyncio
    async def test_save_and_load(self, tmp_path: Path) -> None:
        from ravn.adapters.mcp.auth import LocalEncryptedTokenStore

        store = LocalEncryptedTokenStore(path=str(tmp_path / "tokens.json"))
        token = MCPToken(access_token="tok1", expires_at=None)
        await store.save("server-a", token)
        loaded = await store.load("server-a")
        assert loaded is not None
        assert loaded.access_token == "tok1"

    @pytest.mark.asyncio
    async def test_load_missing_returns_none(self, tmp_path: Path) -> None:
        from ravn.adapters.mcp.auth import LocalEncryptedTokenStore

        store = LocalEncryptedTokenStore(path=str(tmp_path / "tokens.json"))
        assert await store.load("nonexistent") is None

    @pytest.mark.asyncio
    async def test_delete_removes_entry(self, tmp_path: Path) -> None:
        from ravn.adapters.mcp.auth import LocalEncryptedTokenStore

        store = LocalEncryptedTokenStore(path=str(tmp_path / "tokens.json"))
        await store.save("srv", MCPToken(access_token="x"))
        await store.delete("srv")
        assert await store.load("srv") is None

    @pytest.mark.asyncio
    async def test_corrupt_file_returns_empty(self, tmp_path: Path) -> None:
        from ravn.adapters.mcp.auth import LocalEncryptedTokenStore

        p = tmp_path / "tokens.json"
        p.write_bytes(b"not-valid-json-or-fernet")
        store = LocalEncryptedTokenStore(path=str(p))
        assert await store.load("any") is None

    @pytest.mark.asyncio
    async def test_save_overwrites_existing(self, tmp_path: Path) -> None:
        from ravn.adapters.mcp.auth import LocalEncryptedTokenStore

        store = LocalEncryptedTokenStore(path=str(tmp_path / "tokens.json"))
        await store.save("srv", MCPToken(access_token="v1"))
        await store.save("srv", MCPToken(access_token="v2"))
        loaded = await store.load("srv")
        assert loaded is not None
        assert loaded.access_token == "v2"

    @pytest.mark.asyncio
    async def test_multiple_servers(self, tmp_path: Path) -> None:
        from ravn.adapters.mcp.auth import LocalEncryptedTokenStore

        store = LocalEncryptedTokenStore(path=str(tmp_path / "tokens.json"))
        await store.save("a", MCPToken(access_token="token-a"))
        await store.save("b", MCPToken(access_token="token-b"))
        a = await store.load("a")
        b = await store.load("b")
        assert a is not None and a.access_token == "token-a"
        assert b is not None and b.access_token == "token-b"


# ---------------------------------------------------------------------------
# OpenBaoTokenStore
# ---------------------------------------------------------------------------


class TestOpenBaoTokenStore:
    def _store(self) -> OpenBaoTokenStore:
        return OpenBaoTokenStore(url="http://openbao:8200", token="root")

    @pytest.mark.asyncio
    async def test_load_returns_token(self) -> None:
        store = self._store()
        payload = {
            "data": {
                "data": {
                    "access_token": "vault-token",
                    "token_type": "Bearer",
                    "expires_at": None,
                }
            }
        }
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = payload
        mock_resp.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=mock_resp)

        with patch("ravn.adapters.mcp.auth.httpx") as mock_httpx:
            mock_httpx.AsyncClient.return_value = mock_client
            token = await store.load("my-server")

        assert token is not None
        assert token.access_token == "vault-token"

    @pytest.mark.asyncio
    async def test_load_returns_none_on_404(self) -> None:
        store = self._store()
        mock_resp = MagicMock()
        mock_resp.status_code = 404

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=mock_resp)

        with patch("ravn.adapters.mcp.auth.httpx") as mock_httpx:
            mock_httpx.AsyncClient.return_value = mock_client
            result = await store.load("missing")

        assert result is None

    @pytest.mark.asyncio
    async def test_load_returns_none_on_exception(self) -> None:
        store = self._store()
        with patch("ravn.adapters.mcp.auth.httpx") as mock_httpx:
            mock_httpx.AsyncClient.side_effect = Exception("connection refused")
            result = await store.load("any")
        assert result is None

    @pytest.mark.asyncio
    async def test_save_posts_to_vault(self) -> None:
        store = self._store()
        token = MCPToken(access_token="new-tok")

        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_resp)

        with patch("ravn.adapters.mcp.auth.httpx") as mock_httpx:
            mock_httpx.AsyncClient.return_value = mock_client
            await store.save("srv", token)

        mock_client.post.assert_awaited_once()
        call_kwargs = mock_client.post.call_args
        assert "new-tok" in json.dumps(call_kwargs.kwargs.get("json", {}))

    @pytest.mark.asyncio
    async def test_delete_calls_vault(self) -> None:
        store = self._store()
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.delete = AsyncMock(return_value=mock_resp)

        with patch("ravn.adapters.mcp.auth.httpx") as mock_httpx:
            mock_httpx.AsyncClient.return_value = mock_client
            await store.delete("srv")

        mock_client.delete.assert_awaited_once()


# ---------------------------------------------------------------------------
# acquire_api_key
# ---------------------------------------------------------------------------


class TestAcquireApiKey:
    @pytest.mark.asyncio
    async def test_reads_env_var(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("MY_API_KEY", "secret-value")
        token = await acquire_api_key("MY_API_KEY", "Authorization", "Bearer")
        assert token.access_token == "secret-value"
        assert token.expires_at is None  # API keys don't expire

    @pytest.mark.asyncio
    async def test_raises_when_env_var_missing(self) -> None:
        os.environ.pop("NONEXISTENT_KEY", None)
        with pytest.raises(ValueError, match="NONEXISTENT_KEY"):
            await acquire_api_key("NONEXISTENT_KEY", "Authorization", "Bearer")

    @pytest.mark.asyncio
    async def test_raises_when_env_var_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("EMPTY_KEY", "")
        with pytest.raises(ValueError, match="EMPTY_KEY"):
            await acquire_api_key("EMPTY_KEY", "X-Api-Key", "ApiKey")

    @pytest.mark.asyncio
    async def test_token_type_from_prefix(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("MY_KEY", "val")
        token = await acquire_api_key("MY_KEY", "Authorization", "ApiKey")
        assert token.token_type == "ApiKey"
        assert token.auth_header_value() == "ApiKey val"


# ---------------------------------------------------------------------------
# acquire_client_credentials
# ---------------------------------------------------------------------------


class TestAcquireClientCredentials:
    def _mock_httpx_post(self, payload: dict[str, Any], status_code: int = 200) -> Any:
        mock_resp = MagicMock()
        mock_resp.is_success = status_code < 400
        mock_resp.status_code = status_code
        mock_resp.text = json.dumps(payload)
        mock_resp.json.return_value = payload

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_resp)
        return mock_client

    @pytest.mark.asyncio
    async def test_success_with_expires_in(self) -> None:
        payload = {"access_token": "cc-token", "token_type": "Bearer", "expires_in": 3600}
        mock_client = self._mock_httpx_post(payload)

        with patch("ravn.adapters.mcp.auth.httpx") as mock_httpx:
            mock_httpx.AsyncClient.return_value = mock_client
            token = await acquire_client_credentials(
                token_url="https://auth.example.com/token",
                client_id="cid",
                client_secret="csec",
                scope="read write",
            )

        assert token.access_token == "cc-token"
        assert token.expires_at is not None
        assert token.expires_at > time.time()

    @pytest.mark.asyncio
    async def test_success_without_expires_in(self) -> None:
        payload = {"access_token": "cc-token", "token_type": "Bearer"}
        mock_client = self._mock_httpx_post(payload)

        with patch("ravn.adapters.mcp.auth.httpx") as mock_httpx:
            mock_httpx.AsyncClient.return_value = mock_client
            token = await acquire_client_credentials(
                token_url="https://auth.example.com/token",
                client_id="cid",
                client_secret="csec",
            )

        assert token.expires_at is None

    @pytest.mark.asyncio
    async def test_raises_on_http_error(self) -> None:
        mock_client = self._mock_httpx_post({"error": "bad"}, status_code=401)

        with patch("ravn.adapters.mcp.auth.httpx") as mock_httpx:
            mock_httpx.AsyncClient.return_value = mock_client
            with pytest.raises(RuntimeError, match="Token request failed"):
                await acquire_client_credentials(
                    token_url="https://auth.example.com/token",
                    client_id="cid",
                    client_secret="csec",
                )

    @pytest.mark.asyncio
    async def test_raises_on_missing_access_token(self) -> None:
        mock_client = self._mock_httpx_post({"token_type": "Bearer"})

        with patch("ravn.adapters.mcp.auth.httpx") as mock_httpx:
            mock_httpx.AsyncClient.return_value = mock_client
            with pytest.raises(RuntimeError, match="missing 'access_token'"):
                await acquire_client_credentials(
                    token_url="https://auth.example.com/token",
                    client_id="cid",
                    client_secret="csec",
                )

    @pytest.mark.asyncio
    async def test_raises_on_network_error(self) -> None:
        import httpx as _httpx

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=_httpx.ConnectError("refused"))

        with patch("ravn.adapters.mcp.auth.httpx.AsyncClient", return_value=mock_client):
            # ConnectError propagates as-is (not wrapped) since we only catch
            # is_success and then raise RuntimeError for status errors
            with pytest.raises(_httpx.ConnectError):
                await acquire_client_credentials(
                    token_url="https://auth.example.com/token",
                    client_id="cid",
                    client_secret="csec",
                )


# ---------------------------------------------------------------------------
# acquire_device_flow / _poll_device_token
# ---------------------------------------------------------------------------


class TestAcquireDeviceFlow:
    def _make_device_resp(
        self,
        user_code: str = "ABCD-1234",
        verification_uri: str = "https://example.com/activate",
        device_code: str = "dev-code",
        interval: int = 5,
    ) -> MagicMock:
        mock_resp = MagicMock()
        mock_resp.is_success = True
        mock_resp.json.return_value = {
            "user_code": user_code,
            "verification_uri": verification_uri,
            "device_code": device_code,
            "interval": interval,
        }
        return mock_resp

    def _make_token_resp(
        self,
        access_token: str = "dev-token",
        expires_in: int = 3600,
    ) -> MagicMock:
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": expires_in,
        }
        return mock_resp

    def _make_pending_resp(self) -> MagicMock:
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"error": "authorization_pending"}
        return mock_resp

    def _make_slow_down_resp(self) -> MagicMock:
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"error": "slow_down"}
        return mock_resp

    def _make_error_resp(self, error: str = "access_denied") -> MagicMock:
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "error": error,
            "error_description": "Access was denied.",
        }
        return mock_resp

    @pytest.mark.asyncio
    async def test_happy_path(self) -> None:
        device_resp = self._make_device_resp()
        token_resp = self._make_token_resp()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=[device_resp, token_resp])

        with patch("ravn.adapters.mcp.auth.httpx") as mock_httpx:
            mock_httpx.AsyncClient.return_value = mock_client
            token, instructions = await acquire_device_flow(
                token_url="https://auth.example.com/token",
                client_id="cid",
                poll_interval=0,
                max_attempts=5,
            )

        assert token.access_token == "dev-token"
        assert "ABCD-1234" in instructions
        assert "https://example.com/activate" in instructions

    @pytest.mark.asyncio
    async def test_polls_through_pending(self) -> None:
        device_resp = self._make_device_resp(interval=0)
        pending1 = self._make_pending_resp()
        pending2 = self._make_pending_resp()
        token_resp = self._make_token_resp()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        # First call is device auth, then 3 token polls
        mock_client.post = AsyncMock(side_effect=[device_resp, pending1, pending2, token_resp])

        with patch("ravn.adapters.mcp.auth.httpx") as mock_httpx:
            mock_httpx.AsyncClient.return_value = mock_client
            with patch("ravn.adapters.mcp.auth.asyncio.sleep", new_callable=AsyncMock):
                token, _ = await acquire_device_flow(
                    token_url="https://auth.example.com/token",
                    client_id="cid",
                    poll_interval=0,
                    max_attempts=10,
                )

        assert token.access_token == "dev-token"

    @pytest.mark.asyncio
    async def test_times_out(self) -> None:
        device_resp = self._make_device_resp(interval=0)
        pending = self._make_pending_resp()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        # First call is device auth; all remaining are pending
        mock_client.post = AsyncMock(side_effect=[device_resp] + [pending] * 20)

        with patch("ravn.adapters.mcp.auth.httpx") as mock_httpx:
            mock_httpx.AsyncClient.return_value = mock_client
            with patch("ravn.adapters.mcp.auth.asyncio.sleep", new_callable=AsyncMock):
                with pytest.raises(RuntimeError, match="timed out"):
                    await acquire_device_flow(
                        token_url="https://auth.example.com/token",
                        client_id="cid",
                        poll_interval=0,
                        max_attempts=3,
                    )

    @pytest.mark.asyncio
    async def test_raises_on_access_denied(self) -> None:
        device_resp = self._make_device_resp(interval=0)
        error_resp = self._make_error_resp("access_denied")

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=[device_resp, error_resp])

        with patch("ravn.adapters.mcp.auth.httpx") as mock_httpx:
            mock_httpx.AsyncClient.return_value = mock_client
            with patch("ravn.adapters.mcp.auth.asyncio.sleep", new_callable=AsyncMock):
                with pytest.raises(RuntimeError, match="Device flow error"):
                    await acquire_device_flow(
                        token_url="https://auth.example.com/token",
                        client_id="cid",
                        poll_interval=0,
                        max_attempts=5,
                    )

    @pytest.mark.asyncio
    async def test_slow_down_increases_interval(self) -> None:
        """slow_down doubles the interval; we just verify it doesn't crash."""
        device_resp = self._make_device_resp(interval=5)
        slow_down = self._make_slow_down_resp()
        token_resp = self._make_token_resp()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=[device_resp, slow_down, token_resp])

        sleep_mock = AsyncMock()
        with patch("ravn.adapters.mcp.auth.httpx") as mock_httpx:
            mock_httpx.AsyncClient.return_value = mock_client
            with patch("ravn.adapters.mcp.auth.asyncio.sleep", sleep_mock):
                token, _ = await acquire_device_flow(
                    token_url="https://auth.example.com/token",
                    client_id="cid",
                    poll_interval=5,
                    max_attempts=5,
                )

        assert token.access_token == "dev-token"

    @pytest.mark.asyncio
    async def test_raises_on_device_auth_request_failure(self) -> None:
        mock_resp = MagicMock()
        mock_resp.is_success = False
        mock_resp.status_code = 400
        mock_resp.text = "bad_request"

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_resp)

        with patch("ravn.adapters.mcp.auth.httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(RuntimeError, match="Device authorization request failed"):
                await acquire_device_flow(
                    token_url="https://auth.example.com/token",
                    client_id="cid",
                )


# ---------------------------------------------------------------------------
# MCPAuthSession
# ---------------------------------------------------------------------------


class TestMCPAuthSession:
    @pytest.mark.asyncio
    async def test_get_auth_headers_empty_when_no_token(self) -> None:
        session = MCPAuthSession(FakeTokenStore())
        assert session.get_auth_headers("server-a") == {}

    @pytest.mark.asyncio
    async def test_get_auth_headers_after_authenticate_api_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("MY_KEY", "my-secret")
        session = MCPAuthSession(FakeTokenStore())
        await session.authenticate("srv", MCPAuthType.API_KEY, api_key_env="MY_KEY")
        headers = session.get_auth_headers("srv")
        assert headers == {"Authorization": "Bearer my-secret"}

    @pytest.mark.asyncio
    async def test_authenticate_client_credentials(self) -> None:
        payload = {"access_token": "cc-token", "token_type": "Bearer", "expires_in": 3600}
        mock_resp = MagicMock()
        mock_resp.is_success = True
        mock_resp.json.return_value = payload

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_resp)

        session = MCPAuthSession(FakeTokenStore())
        with patch("ravn.adapters.mcp.auth.httpx") as mock_httpx:
            mock_httpx.AsyncClient.return_value = mock_client
            token, message = await session.authenticate(
                "srv",
                MCPAuthType.CLIENT_CREDENTIALS,
                token_url="https://auth.example.com/token",
                client_id="cid",
                client_secret="csec",
            )

        assert token.access_token == "cc-token"
        assert "Client-credentials" in message

    @pytest.mark.asyncio
    async def test_authenticate_device_flow(self) -> None:
        device_resp = MagicMock()
        device_resp.is_success = True
        device_resp.json.return_value = {
            "user_code": "XYZ-123",
            "verification_uri": "https://example.com/activate",
            "device_code": "dc",
            "interval": 0,
        }
        token_resp = MagicMock()
        token_resp.json.return_value = {
            "access_token": "df-token",
            "token_type": "Bearer",
        }

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=[device_resp, token_resp])

        session = MCPAuthSession(FakeTokenStore())
        with patch("ravn.adapters.mcp.auth.httpx") as mock_httpx:
            mock_httpx.AsyncClient.return_value = mock_client
            with patch("ravn.adapters.mcp.auth.asyncio.sleep", new_callable=AsyncMock):
                token, message = await session.authenticate(
                    "srv",
                    MCPAuthType.DEVICE_FLOW,
                    token_url="https://auth.example.com/token",
                    client_id="cid",
                    device_poll_interval=0,
                    device_max_attempts=3,
                )

        assert token.access_token == "df-token"
        assert "Device-flow" in message

    @pytest.mark.asyncio
    async def test_revoke_clears_cache_and_store(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("KEY", "val")
        store = FakeTokenStore()
        session = MCPAuthSession(store)
        await session.authenticate("srv", MCPAuthType.API_KEY, api_key_env="KEY")
        assert session.get_auth_headers("srv") != {}

        await session.revoke("srv")
        assert session.get_auth_headers("srv") == {}
        assert await store.load("srv") is None

    @pytest.mark.asyncio
    async def test_get_token_loads_from_store(self) -> None:
        store = FakeTokenStore()
        saved = MCPToken(access_token="stored-tok", expires_at=time.time() + 3600)
        await store.save("srv", saved)

        session = MCPAuthSession(store)
        token = await session.get_token("srv")
        assert token is not None
        assert token.access_token == "stored-tok"

    @pytest.mark.asyncio
    async def test_get_auth_headers_empty_for_expired_token(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("KEY", "val")
        session = MCPAuthSession(FakeTokenStore())
        # Manually inject an expired token into cache
        from ravn.adapters.mcp.auth import _SessionEntry

        session._cache["srv"] = _SessionEntry(
            token=MCPToken(access_token="old", expires_at=time.time() - 100),
            auth_type=MCPAuthType.API_KEY,
        )
        assert session.get_auth_headers("srv") == {}


# ---------------------------------------------------------------------------
# MCPAuthTool
# ---------------------------------------------------------------------------


class TestMCPAuthTool:
    def _make_tool(
        self,
        *,
        server_name: str = "my-server",
        auth_type: str | None = None,
        manager: Any = None,
    ) -> MCPAuthTool:
        cfg = make_server_config(name=server_name, auth_type=auth_type)
        session = MCPAuthSession(FakeTokenStore())
        return MCPAuthTool(
            auth_session=session,
            server_configs={server_name: cfg},
            manager=manager,
        )

    def test_name(self) -> None:
        tool = self._make_tool()
        assert tool.name == "mcp_auth"

    def test_required_permission(self) -> None:
        tool = self._make_tool()
        assert tool.required_permission == "mcp:auth"

    def test_not_parallelisable(self) -> None:
        tool = self._make_tool()
        assert not tool.parallelisable

    def test_input_schema_has_server_name(self) -> None:
        tool = self._make_tool()
        assert "server_name" in tool.input_schema["properties"]
        assert "server_name" in tool.input_schema["required"]

    @pytest.mark.asyncio
    async def test_error_on_empty_server_name(self) -> None:
        tool = self._make_tool()
        result = await tool.execute({"server_name": ""})
        assert result.is_error
        assert "server_name" in result.content

    @pytest.mark.asyncio
    async def test_error_on_unknown_server(self) -> None:
        tool = self._make_tool()
        result = await tool.execute({"server_name": "unknown"})
        assert result.is_error
        assert "Unknown MCP server" in result.content
        assert "my-server" in result.content  # shows known servers

    @pytest.mark.asyncio
    async def test_error_when_no_auth_type_configured(self) -> None:
        # No auth_type in call AND no default in config
        tool = self._make_tool(auth_type=None)
        result = await tool.execute({"server_name": "my-server"})
        assert result.is_error
        assert "No auth type" in result.content

    @pytest.mark.asyncio
    async def test_error_on_invalid_auth_type(self) -> None:
        tool = self._make_tool()
        result = await tool.execute({"server_name": "my-server", "auth_type": "magic"})
        assert result.is_error
        assert "Unknown auth_type" in result.content

    @pytest.mark.asyncio
    async def test_api_key_success(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("MY_API_KEY", "super-secret")
        tool = self._make_tool(auth_type="api_key")
        result = await tool.execute({"server_name": "my-server"})
        assert not result.is_error
        assert "authenticated" in result.content.lower()

    @pytest.mark.asyncio
    async def test_api_key_missing_env_is_error(self) -> None:
        os.environ.pop("MY_API_KEY", None)
        tool = self._make_tool(auth_type="api_key")
        result = await tool.execute({"server_name": "my-server"})
        assert result.is_error
        assert "Authentication failed" in result.content

    @pytest.mark.asyncio
    async def test_auth_type_from_input_overrides_config(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Config has no auth_type, but call provides one
        monkeypatch.setenv("MY_API_KEY", "key-val")
        tool = self._make_tool(auth_type=None)
        result = await tool.execute({"server_name": "my-server", "auth_type": "api_key"})
        assert not result.is_error

    @pytest.mark.asyncio
    async def test_client_credentials_success(self) -> None:
        payload = {"access_token": "cc-tok", "token_type": "Bearer", "expires_in": 3600}
        mock_resp = MagicMock()
        mock_resp.is_success = True
        mock_resp.json.return_value = payload

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_resp)

        os.environ["MY_CLIENT_SECRET"] = "csec"
        tool = self._make_tool(auth_type="client_credentials")
        with patch("ravn.adapters.mcp.auth.httpx") as mock_httpx:
            mock_httpx.AsyncClient.return_value = mock_client
            result = await tool.execute({"server_name": "my-server"})
        os.environ.pop("MY_CLIENT_SECRET", None)

        assert not result.is_error
        assert "Client-credentials" in result.content

    @pytest.mark.asyncio
    async def test_injects_headers_into_manager_client(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("MY_API_KEY", "secret-key")

        mock_client = MagicMock()
        mock_client.set_auth_headers = MagicMock()

        mock_manager = MagicMock()
        mock_manager.get_client.return_value = mock_client

        cfg = make_server_config(name="my-server", auth_type="api_key")
        session = MCPAuthSession(FakeTokenStore())
        tool = MCPAuthTool(
            auth_session=session,
            server_configs={"my-server": cfg},
            manager=mock_manager,
        )
        result = await tool.execute({"server_name": "my-server"})

        assert not result.is_error
        mock_manager.get_client.assert_called_once_with("my-server")
        mock_client.set_auth_headers.assert_called_once()

    @pytest.mark.asyncio
    async def test_no_manager_still_succeeds(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("MY_API_KEY", "key")
        tool = self._make_tool(auth_type="api_key", manager=None)
        result = await tool.execute({"server_name": "my-server"})
        assert not result.is_error

    @pytest.mark.asyncio
    async def test_manager_client_not_found_still_succeeds(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("MY_API_KEY", "key")
        mock_manager = MagicMock()
        mock_manager.get_client.return_value = None
        tool = self._make_tool(auth_type="api_key", manager=mock_manager)
        result = await tool.execute({"server_name": "my-server"})
        assert not result.is_error


# ---------------------------------------------------------------------------
# build_mcp_auth_tool / build_token_store helpers
# ---------------------------------------------------------------------------


class TestHelpers:
    def test_build_mcp_auth_tool_creates_tool(self) -> None:
        session = MCPAuthSession(FakeTokenStore())
        configs = [make_server_config("srv-a"), make_server_config("srv-b")]
        tool = build_mcp_auth_tool(session, configs)
        assert tool.name == "mcp_auth"
        assert "srv-a" in tool._server_configs
        assert "srv-b" in tool._server_configs

    def test_build_token_store_local(self) -> None:
        from ravn.adapters.mcp.auth import LocalEncryptedTokenStore

        cfg = MCPTokenStoreConfig(backend="local", local_path="/tmp/ravn_test_tokens.json")
        store = build_token_store(cfg)
        assert isinstance(store, LocalEncryptedTokenStore)

    def test_build_token_store_openbao(self) -> None:
        cfg = MCPTokenStoreConfig(
            backend="openbao",
            openbao_url="http://openbao:8200",
            openbao_token_env="OPENBAO_TOKEN",
        )
        store = build_token_store(cfg)
        assert isinstance(store, OpenBaoTokenStore)


# ---------------------------------------------------------------------------
# Transport auth header injection
# ---------------------------------------------------------------------------


class TestTransportAuthHeaders:
    def test_base_transport_set_auth_headers_is_noop(self) -> None:
        """The default implementation should not raise."""

        class MinimalTransport(MCPTransport):
            async def start(self) -> None:
                pass

            async def send(self, message: Any) -> None:
                pass

            async def receive(self) -> Any:
                return {}

            async def close(self) -> None:
                pass

            @property
            def is_alive(self) -> bool:
                return True

        transport = MinimalTransport()
        transport.set_auth_headers({"Authorization": "Bearer x"})  # Must not raise

    def test_http_transport_stores_auth_headers(self) -> None:
        transport = HTTPTransport(url="http://example.com/mcp")
        transport.set_auth_headers({"Authorization": "Bearer tok"})
        assert transport._auth_headers == {"Authorization": "Bearer tok"}

    def test_sse_transport_stores_auth_headers(self) -> None:
        transport = SSETransport(url="http://example.com/sse")
        transport.set_auth_headers({"Authorization": "Bearer tok"})
        assert transport._auth_headers == {"Authorization": "Bearer tok"}

    def test_http_transport_sends_auth_headers(self) -> None:
        """Auth headers are merged into the POST headers."""
        transport = HTTPTransport(url="http://example.com/mcp")
        transport.set_auth_headers({"Authorization": "Bearer my-token"})
        # The header is stored; the POST test is in test_mcp_transports.py
        assert "Authorization" in transport._auth_headers

    def test_sse_transport_default_empty_headers(self) -> None:
        transport = SSETransport(url="http://example.com/sse")
        assert transport._auth_headers == {}


# ---------------------------------------------------------------------------
# MCPServerClient.set_auth_headers
# ---------------------------------------------------------------------------


class FakeTransport(MCPTransport):
    def __init__(self) -> None:
        self.auth_headers: dict[str, str] = {}
        self.started = False

    async def start(self) -> None:
        self.started = True

    async def send(self, message: Any) -> None:
        pass

    async def receive(self) -> Any:
        return {}

    async def close(self) -> None:
        pass

    @property
    def is_alive(self) -> bool:
        return self.started

    def set_auth_headers(self, headers: dict[str, str]) -> None:
        self.auth_headers = dict(headers)


class TestMCPServerClientAuthHeaders:
    def test_set_auth_headers_delegates_to_transport(self) -> None:
        transport = FakeTransport()
        client = MCPServerClient(name="srv", transport=transport)
        client.set_auth_headers({"Authorization": "Bearer x"})
        assert transport.auth_headers == {"Authorization": "Bearer x"}


# ---------------------------------------------------------------------------
# MCPManager.get_client
# ---------------------------------------------------------------------------


class TestMCPManagerGetClient:
    @pytest.mark.asyncio
    async def test_get_client_returns_none_when_empty(self) -> None:
        from ravn.adapters.mcp.manager import MCPManager

        manager = MCPManager(configs=[])
        assert manager.get_client("any") is None

    @pytest.mark.asyncio
    async def test_get_client_finds_client_by_name(self) -> None:
        from ravn.adapters.mcp.manager import MCPManager

        manager = MCPManager(configs=[])
        fake_transport = FakeTransport()
        fake_transport.started = True
        client = MCPServerClient(name="my-server", transport=fake_transport)
        manager._clients.append(client)

        found = manager.get_client("my-server")
        assert found is client

    @pytest.mark.asyncio
    async def test_get_client_returns_none_for_unknown_name(self) -> None:
        from ravn.adapters.mcp.manager import MCPManager

        manager = MCPManager(configs=[])
        fake_transport = FakeTransport()
        client = MCPServerClient(name="other", transport=fake_transport)
        manager._clients.append(client)

        assert manager.get_client("nonexistent") is None
