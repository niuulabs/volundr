"""Tests for Skuld broker service."""

import logging
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import WebSocketDisconnect
from fastapi.testclient import TestClient

from skuld.broker import (
    Broker,
    _log_buffer,
    _TokenRedactFilter,
    app,
    broker,
)
from skuld.config import SkuldSettings
from skuld.transports import (
    CodexSubprocessTransport,
    SdkWebSocketTransport,
    SubprocessTransport,
    TransportCapabilities,
)


class TestBroker:
    """Tests for Broker class."""

    @pytest.fixture
    def settings(self, tmp_path):
        return SkuldSettings(
            session={"id": "test-session-123"},
            transport="subprocess",
            host="0.0.0.0",
            port=8081,
        )

    @pytest.fixture
    def test_broker(self, settings, tmp_path):
        # Ensure workspace_dir points to tmp_path
        settings.session.workspace_dir = str(tmp_path)
        return Broker(settings=settings)

    def test_init_from_settings(self, test_broker, tmp_path):
        assert test_broker.session_id == "test-session-123"
        assert test_broker.workspace_dir == str(tmp_path)
        assert test_broker._transport is None

    def test_create_transport_subprocess(self, tmp_path):
        settings = SkuldSettings(
            transport="subprocess",
            session={"id": "s1", "workspace_dir": str(tmp_path)},
        )
        b = Broker(settings=settings)
        transport = b._create_transport()
        assert isinstance(transport, SubprocessTransport)

    def test_create_transport_sdk(self, tmp_path):
        settings = SkuldSettings(
            transport="sdk",
            session={"id": "s1", "workspace_dir": str(tmp_path)},
        )
        b = Broker(settings=settings)
        transport = b._create_transport()
        assert isinstance(transport, SdkWebSocketTransport)

    def test_create_transport_default_is_sdk(self, tmp_path):
        settings = SkuldSettings(
            session={"id": "s1", "workspace_dir": str(tmp_path)},
        )
        b = Broker(settings=settings)
        transport = b._create_transport()
        assert isinstance(transport, SdkWebSocketTransport)

    def test_create_transport_codex(self, tmp_path):
        settings = SkuldSettings(
            cli_type="codex",
            session={"id": "s1", "workspace_dir": str(tmp_path), "model": "o4-mini"},
        )
        b = Broker(settings=settings)
        transport = b._create_transport()
        assert isinstance(transport, CodexSubprocessTransport)

    def test_create_transport_codex_passes_model(self, tmp_path):
        settings = SkuldSettings(
            cli_type="codex",
            session={"id": "s1", "workspace_dir": str(tmp_path), "model": "gpt-4o"},
        )
        b = Broker(settings=settings)
        transport = b._create_transport()
        assert isinstance(transport, CodexSubprocessTransport)
        assert transport._model == "gpt-4o"

    def test_create_transport_sdk_passes_model(self, tmp_path):
        settings = SkuldSettings(
            transport="sdk",
            session={
                "id": "s1",
                "workspace_dir": str(tmp_path),
                "model": "claude-opus-4-20250514",
            },
        )
        b = Broker(settings=settings)
        transport = b._create_transport()
        assert isinstance(transport, SdkWebSocketTransport)
        assert transport._model == "claude-opus-4-20250514"

    def test_create_transport_dynamic_import(self, tmp_path):
        """Dynamic transport factory uses importlib to load the configured adapter."""
        settings = SkuldSettings(
            transport_adapter="skuld.transports.subprocess.SubprocessTransport",
            session={"id": "s1", "workspace_dir": str(tmp_path)},
        )
        b = Broker(settings=settings)

        with patch("skuld.broker.import_class") as mock_import:
            mock_import.return_value = SubprocessTransport
            transport = b._create_transport()

        mock_import.assert_called_once_with("skuld.transports.subprocess.SubprocessTransport")
        assert isinstance(transport, SubprocessTransport)

    def test_create_transport_invalid_adapter_path(self, tmp_path):
        """Invalid adapter path (no dot) raises ValueError."""
        settings = SkuldSettings(
            transport_adapter="BadPath",
            session={"id": "s1", "workspace_dir": str(tmp_path)},
        )
        b = Broker(settings=settings)

        with pytest.raises(ValueError, match="must be a fully-qualified"):
            b._create_transport()

    def test_create_transport_import_error(self, tmp_path):
        """ImportError from dynamic import is wrapped in ValueError."""
        settings = SkuldSettings(
            transport_adapter="nonexistent.module.Transport",
            session={"id": "s1", "workspace_dir": str(tmp_path)},
        )
        b = Broker(settings=settings)

        with patch("skuld.broker.import_class", side_effect=ImportError("no module")):
            with pytest.raises(ValueError, match="Cannot load transport adapter"):
                b._create_transport()

    @pytest.mark.asyncio
    async def test_startup_creates_workspace(self, test_broker, tmp_path):
        """Test startup creates workspace directory and initializes transport."""
        import shutil

        shutil.rmtree(tmp_path)

        await test_broker.startup()

        assert os.path.exists(test_broker.workspace_dir)
        assert test_broker._transport is not None

    @pytest.mark.asyncio
    async def test_shutdown_stops_transport(self, test_broker):
        mock_transport = AsyncMock()
        test_broker._transport = mock_transport

        await test_broker.shutdown()
        mock_transport.stop.assert_called_once()

    @pytest.mark.asyncio
    async def test_shutdown_closes_channels(self, test_broker):
        mock_channel = AsyncMock()
        mock_channel.channel_type = "browser"
        mock_channel.is_open = True
        test_broker._channels.add(mock_channel)

        await test_broker.shutdown()
        mock_channel.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_handle_cli_event_forwards_to_channels(self, test_broker):
        mock_ch1 = AsyncMock()
        mock_ch1.channel_type = "browser"
        mock_ch1.is_open = True
        mock_ch2 = AsyncMock()
        mock_ch2.channel_type = "browser"
        mock_ch2.is_open = True
        test_broker._channels.add(mock_ch1)
        test_broker._channels.add(mock_ch2)

        data = {"type": "assistant", "message": {"content": "hi"}}
        await test_broker._handle_cli_event(data)

        mock_ch1.send_event.assert_called_once_with(data)
        mock_ch2.send_event.assert_called_once_with(data)

    @pytest.mark.asyncio
    async def test_handle_cli_event_reports_usage_on_result(self, test_broker):
        test_broker.volundr_api_url = "http://volundr:80"

        with patch.object(test_broker, "_report_usage", new_callable=AsyncMock) as mock_report:
            data = {"type": "result", "modelUsage": {"opus": {"inputTokens": 10}}}
            await test_broker._handle_cli_event(data)

            # _report_usage is called via create_task — let the task run
            import asyncio

            await asyncio.sleep(0.05)

            mock_report.assert_called_once_with(data)

    @pytest.mark.asyncio
    async def test_handle_cli_event_removes_broken_channels(self, test_broker):
        good_ch = AsyncMock()
        good_ch.channel_type = "browser"
        good_ch.is_open = True
        bad_ch = AsyncMock()
        bad_ch.channel_type = "browser"
        bad_ch.is_open = True
        bad_ch.send_event.side_effect = Exception("broken")
        test_broker._channels.add(good_ch)
        test_broker._channels.add(bad_ch)

        await test_broker._handle_cli_event({"type": "assistant"})

        assert bad_ch not in test_broker._channels.channels
        assert good_ch in test_broker._channels.channels

    @pytest.mark.asyncio
    async def test_handle_cli_event_broadcasts_available_commands_on_init(self, test_broker):
        mock_ch = AsyncMock()
        mock_ch.channel_type = "browser"
        mock_ch.is_open = True
        test_broker._channels.add(mock_ch)

        data = {
            "type": "system",
            "subtype": "init",
            "session_id": "s1",
            "model": "opus",
            "tools": [],
            "slash_commands": ["help", "clear"],
            "skills": ["simplify"],
        }
        await test_broker._handle_cli_event(data)

        # First call is the raw event broadcast, second is available_commands
        assert mock_ch.send_event.call_count == 2
        commands_call = mock_ch.send_event.call_args_list[1]
        sent = commands_call[0][0]
        assert sent["type"] == "available_commands"
        assert sent["slash_commands"] == ["help", "clear"]
        assert sent["skills"] == ["simplify"]

    @pytest.mark.asyncio
    async def test_handle_cli_event_skips_commands_broadcast_when_empty(self, test_broker):
        mock_ch = AsyncMock()
        mock_ch.channel_type = "browser"
        mock_ch.is_open = True
        test_broker._channels.add(mock_ch)

        data = {
            "type": "system",
            "subtype": "init",
            "session_id": "s1",
            "model": "opus",
            "tools": [],
        }
        await test_broker._handle_cli_event(data)

        # Only the raw event broadcast, no available_commands
        mock_ch.send_event.assert_called_once_with(data)

    # --- Phase 2: Permission control config pass-through ---

    def test_create_transport_sdk_passes_skip_permissions(self, tmp_path):
        settings = SkuldSettings(
            transport="sdk",
            skip_permissions=False,
            session={"id": "s1", "workspace_dir": str(tmp_path)},
        )
        b = Broker(settings=settings)
        transport = b._create_transport()
        assert isinstance(transport, SdkWebSocketTransport)
        assert transport._skip_permissions is False

    def test_create_transport_sdk_passes_agent_teams(self, tmp_path):
        settings = SkuldSettings(
            transport="sdk",
            agent_teams=True,
            session={"id": "s1", "workspace_dir": str(tmp_path)},
        )
        b = Broker(settings=settings)
        transport = b._create_transport()
        assert isinstance(transport, SdkWebSocketTransport)
        assert transport._agent_teams is True

    # --- Dynamic transport adapter tests ---

    def test_create_transport_explicit_adapter(self, tmp_path):
        """Direct transport_adapter bypasses legacy field resolution."""
        settings = SkuldSettings(
            transport_adapter="skuld.transports.codex.CodexSubprocessTransport",
            session={"id": "s1", "workspace_dir": str(tmp_path), "model": "o4-mini"},
        )
        b = Broker(settings=settings)
        transport = b._create_transport()
        assert isinstance(transport, CodexSubprocessTransport)

    def test_create_transport_invalid_module(self, tmp_path):
        """Non-existent module raises ValueError via ImportError."""
        settings = SkuldSettings(
            session={"id": "s1", "workspace_dir": str(tmp_path)},
        )
        settings.transport_adapter = "skuld.transports.nonexistent.FakeTransport"
        b = Broker(settings=settings)
        with pytest.raises(ValueError, match="Cannot load transport adapter"):
            b._create_transport()

    def test_create_transport_invalid_class(self, tmp_path):
        """Valid module but missing class raises ValueError via AttributeError."""
        settings = SkuldSettings(
            session={"id": "s1", "workspace_dir": str(tmp_path)},
        )
        settings.transport_adapter = "skuld.transports.codex.NonexistentTransport"
        b = Broker(settings=settings)
        with pytest.raises(ValueError, match="Cannot load transport adapter"):
            b._create_transport()

    def test_create_transport_invalid_path_no_dot(self, tmp_path):
        """Adapter path without a dot raises ValueError."""
        settings = SkuldSettings(
            session={"id": "s1", "workspace_dir": str(tmp_path)},
        )
        settings.transport_adapter = "NotAFullyQualifiedPath"
        b = Broker(settings=settings)
        with pytest.raises(ValueError, match="must be a fully-qualified class path"):
            b._create_transport()

    def test_build_transport_kwargs(self, tmp_path):
        """_build_transport_kwargs returns expected superset of settings."""
        settings = SkuldSettings(
            session={
                "id": "s1",
                "workspace_dir": str(tmp_path),
                "model": "opus",
                "system_prompt": "be helpful",
                "initial_prompt": "hello",
            },
            port=9999,
            skip_permissions=False,
            agent_teams=True,
        )
        b = Broker(settings=settings)
        kwargs = b._build_transport_kwargs()
        assert kwargs["workspace_dir"] == str(tmp_path)
        assert kwargs["model"] == "opus"
        assert kwargs["sdk_port"] == 9999
        assert kwargs["session_id"] == "s1"
        assert kwargs["skip_permissions"] is False
        assert kwargs["agent_teams"] is True
        assert kwargs["system_prompt"] == "be helpful"
        assert kwargs["initial_prompt"] == "hello"

    def test_create_transport_filters_kwargs(self, tmp_path):
        """Only kwargs matching the constructor signature are passed."""
        settings = SkuldSettings(
            transport="subprocess",
            session={"id": "s1", "workspace_dir": str(tmp_path)},
        )
        b = Broker(settings=settings)
        transport = b._create_transport()
        # SubprocessTransport only accepts workspace_dir
        assert isinstance(transport, SubprocessTransport)
        assert transport.workspace_dir == str(tmp_path)


class TestDispatchBrowserMessage:
    """Tests for Broker._dispatch_browser_message (Phase 2/3/4)."""

    @pytest.fixture
    def test_broker(self, tmp_path):
        settings = SkuldSettings(
            session={"id": "test-session", "workspace_dir": str(tmp_path)},
            transport="sdk",
            skip_permissions=False,
        )
        b = Broker(settings=settings)
        b._transport = AsyncMock()
        return b

    @pytest.mark.asyncio
    async def test_dispatch_user_message(self, test_broker):
        await test_broker._dispatch_browser_message({"content": "hello"})
        test_broker._transport.send_message.assert_called_once_with("hello")

    @pytest.mark.asyncio
    async def test_dispatch_user_message_empty_ignored(self, test_broker):
        await test_broker._dispatch_browser_message({"content": ""})
        test_broker._transport.send_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_dispatch_permission_response_allow(self, test_broker):
        await test_broker._dispatch_browser_message(
            {
                "type": "permission_response",
                "request_id": "req-999",
                "behavior": "allow",
                "updated_input": {"command": "ls -la"},
            }
        )
        test_broker._transport.send_control_response.assert_called_once_with(
            "req-999",
            {
                "behavior": "allow",
                "updatedInput": {"command": "ls -la"},
            },
        )

    @pytest.mark.asyncio
    async def test_dispatch_permission_response_deny(self, test_broker):
        await test_broker._dispatch_browser_message(
            {
                "type": "permission_response",
                "request_id": "req-888",
                "behavior": "deny",
            }
        )
        test_broker._transport.send_control_response.assert_called_once()
        args = test_broker._transport.send_control_response.call_args
        assert args[0][0] == "req-888"
        assert args[0][1]["behavior"] == "deny"

    @pytest.mark.asyncio
    async def test_dispatch_permission_response_with_updated_permissions(self, test_broker):
        await test_broker._dispatch_browser_message(
            {
                "type": "permission_response",
                "request_id": "req-777",
                "behavior": "allow",
                "updated_input": {"command": "ls"},
                "updated_permissions": [{"tool": "Bash", "behavior": "allow"}],
            }
        )
        args = test_broker._transport.send_control_response.call_args
        response = args[0][1]
        assert "updatedPermissions" in response
        assert response["updatedPermissions"] == [{"tool": "Bash", "behavior": "allow"}]

    @pytest.mark.asyncio
    async def test_dispatch_interrupt(self, test_broker):
        await test_broker._dispatch_browser_message({"type": "interrupt"})
        test_broker._transport.send_control.assert_called_once_with("interrupt")

    @pytest.mark.asyncio
    async def test_dispatch_set_model(self, test_broker):
        await test_broker._dispatch_browser_message(
            {
                "type": "set_model",
                "model": "claude-opus-4-6",
            }
        )
        test_broker._transport.send_control.assert_called_once_with(
            "set_model",
            model="claude-opus-4-6",
        )

    @pytest.mark.asyncio
    async def test_dispatch_set_model_empty_ignored(self, test_broker):
        await test_broker._dispatch_browser_message(
            {
                "type": "set_model",
                "model": "",
            }
        )
        test_broker._transport.send_control.assert_not_called()

    @pytest.mark.asyncio
    async def test_dispatch_set_max_thinking_tokens(self, test_broker):
        await test_broker._dispatch_browser_message(
            {
                "type": "set_max_thinking_tokens",
                "max_thinking_tokens": 4096,
            }
        )
        test_broker._transport.send_control.assert_called_once_with(
            "set_max_thinking_tokens",
            max_thinking_tokens=4096,
        )

    @pytest.mark.asyncio
    async def test_dispatch_set_permission_mode(self, test_broker):
        await test_broker._dispatch_browser_message(
            {
                "type": "set_permission_mode",
                "mode": "bypassPermissions",
            }
        )
        test_broker._transport.send_control.assert_called_once_with(
            "set_permission_mode",
            permissionMode="bypassPermissions",
        )

    @pytest.mark.asyncio
    async def test_dispatch_rewind_files(self, test_broker):
        await test_broker._dispatch_browser_message({"type": "rewind_files"})
        test_broker._transport.send_control.assert_called_once_with("rewind_files")

    @pytest.mark.asyncio
    async def test_dispatch_mcp_set_servers(self, test_broker):
        servers = [{"name": "my-mcp", "command": "node", "args": ["server.js"]}]
        await test_broker._dispatch_browser_message(
            {
                "type": "mcp_set_servers",
                "servers": servers,
            }
        )
        test_broker._transport.send_control.assert_called_once_with(
            "mcp_set_servers",
            servers=servers,
        )

    @pytest.mark.asyncio
    async def test_dispatch_no_transport_noop(self, test_broker):
        test_broker._transport = None
        # Should not raise
        await test_broker._dispatch_browser_message({"content": "hello"})

    @pytest.mark.asyncio
    async def test_dispatch_guard_blocks_unsupported_control(self, test_broker):
        """Unsupported control messages are rejected with an error to sender_ws."""
        test_broker._transport.capabilities = TransportCapabilities()  # all False
        sender_ws = AsyncMock()

        await test_broker._dispatch_browser_message({"type": "interrupt"}, sender_ws=sender_ws)

        # Control should NOT be forwarded
        test_broker._transport.send_control.assert_not_called()
        # Error should be sent back to the sender
        sender_ws.send_json.assert_called_once()
        sent = sender_ws.send_json.call_args[0][0]
        assert sent["type"] == "error"
        assert "interrupt" in sent["content"]
        assert "not supported" in sent["content"]

    @pytest.mark.asyncio
    async def test_dispatch_guard_blocks_all_guarded_controls(self, test_broker):
        """All six guarded control types are blocked when capabilities are False."""
        test_broker._transport.capabilities = TransportCapabilities()  # all False
        guarded = [
            "interrupt",
            "set_model",
            "set_max_thinking_tokens",
            "set_permission_mode",
            "rewind_files",
            "mcp_set_servers",
        ]
        for msg_type in guarded:
            sender_ws = AsyncMock()
            await test_broker._dispatch_browser_message({"type": msg_type}, sender_ws=sender_ws)
            sender_ws.send_json.assert_called_once()
            sent = sender_ws.send_json.call_args[0][0]
            assert sent["type"] == "error"
            assert msg_type in sent["content"]

        test_broker._transport.send_control.assert_not_called()

    @pytest.mark.asyncio
    async def test_dispatch_guard_allows_supported_control(self, test_broker):
        """Supported control messages pass through the guard."""
        test_broker._transport.capabilities = TransportCapabilities(interrupt=True)

        await test_broker._dispatch_browser_message({"type": "interrupt"})

        test_broker._transport.send_control.assert_called_once_with("interrupt")

    @pytest.mark.asyncio
    async def test_dispatch_guard_no_sender_ws_still_blocks(self, test_broker):
        """Unsupported control is blocked even without sender_ws (no crash)."""
        test_broker._transport.capabilities = TransportCapabilities()  # all False

        await test_broker._dispatch_browser_message({"type": "interrupt"})

        test_broker._transport.send_control.assert_not_called()

    @pytest.mark.asyncio
    async def test_dispatch_permission_response_not_guarded(self, test_broker):
        """permission_response is not in the guard map and always passes."""
        test_broker._transport.capabilities = TransportCapabilities()  # all False

        await test_broker._dispatch_browser_message(
            {
                "type": "permission_response",
                "request_id": "req-1",
                "behavior": "allow",
                "updated_input": {},
            }
        )
        test_broker._transport.send_control_response.assert_called_once()


class TestFastAPIEndpoints:
    """Tests for FastAPI endpoints."""

    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient

        return TestClient(app)

    def test_health_endpoint(self, client, monkeypatch):
        broker.session_id = "test-123"
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["session_id"] == "test-123"

    def test_ready_endpoint_not_ready(self, client):
        broker._transport = None
        response = client.get("/ready")
        assert response.status_code == 200
        data = response.json()
        assert data["ready"] is False

    def test_ready_endpoint_ready(self, client):
        broker._transport = MagicMock()
        response = client.get("/ready")
        assert response.status_code == 200
        data = response.json()
        assert data["ready"] is True
        broker._transport = None

    def test_logs_endpoint(self, client):
        _log_buffer.clear()
        _log_buffer.append(
            {
                "time": "",
                "timestamp": 1000.0,
                "level": "INFO",
                "logger": "test",
                "message": "hello from test",
            }
        )
        response = client.get("/api/logs?lines=10&level=INFO")
        assert response.status_code == 200
        data = response.json()
        assert data["returned"] >= 1
        msgs = [e["message"] for e in data["lines"]]
        assert "hello from test" in msgs

    def test_capabilities_endpoint_returns_transport_caps(self, client):
        """GET /api/capabilities returns transport capabilities as JSON."""
        mock_transport = MagicMock()
        mock_transport.capabilities = TransportCapabilities(
            interrupt=True, set_model=True, cli_websocket=True
        )
        broker._transport = mock_transport

        response = client.get("/api/capabilities")
        assert response.status_code == 200
        data = response.json()
        assert data["interrupt"] is True
        assert data["set_model"] is True
        assert data["cli_websocket"] is True
        assert data["rewind_files"] is False
        broker._transport = None

    def test_capabilities_endpoint_503_no_transport(self, client):
        """GET /api/capabilities returns 503 when transport not initialized."""
        broker._transport = None
        response = client.get("/api/capabilities")
        assert response.status_code == 503

    def test_logs_endpoint_level_filter(self, client):
        _log_buffer.clear()
        _log_buffer.append(
            {"time": "", "timestamp": 1.0, "level": "DEBUG", "logger": "x", "message": "dbg"}
        )
        _log_buffer.append(
            {"time": "", "timestamp": 2.0, "level": "ERROR", "logger": "x", "message": "err"}
        )
        response = client.get("/api/logs?lines=10&level=ERROR")
        assert response.status_code == 200
        data = response.json()
        msgs = [e["message"] for e in data["lines"]]
        assert "err" in msgs
        assert "dbg" not in msgs


class TestCORSMiddleware:
    """Tests for CORS middleware on the Skuld broker."""

    @pytest.fixture
    def client(self):
        return TestClient(app)

    def test_cors_allows_all_origins(self, client):
        """CORS preflight should succeed for any origin."""
        response = client.options(
            "/api/logs",
            headers={
                "Origin": "https://hlidskjalf.valhalla.asgard.niuu.world",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.status_code in (200, 204, 400)
        assert response.headers.get("access-control-allow-origin") in (
            "*",
            "https://hlidskjalf.valhalla.asgard.niuu.world",
        )

    def test_cors_headers_on_get(self, client):
        """Regular GET requests include CORS response headers."""
        _log_buffer.clear()
        response = client.get(
            "/api/logs",
            headers={"Origin": "https://hlidskjalf.valhalla.asgard.niuu.world"},
        )
        assert response.status_code == 200
        assert response.headers.get("access-control-allow-origin") in (
            "*",
            "https://hlidskjalf.valhalla.asgard.niuu.world",
        )


class TestReportUsage:
    """Tests for Broker._report_usage."""

    @pytest.fixture
    def test_broker(self, tmp_path):
        settings = SkuldSettings(
            session={"id": "sess-abc", "workspace_dir": str(tmp_path)},
            volundr_api_url="http://volundr.test:80",
        )
        return Broker(settings=settings)

    @pytest.mark.asyncio
    async def test_report_usage_posts_to_api(self, test_broker):
        result_data = {
            "modelUsage": {
                "claude-opus-4-5-20251101": {
                    "inputTokens": 3,
                    "outputTokens": 12,
                    "cacheReadInputTokens": 100,
                    "cacheCreationInputTokens": 50,
                    "costUSD": 0.05,
                }
            }
        }

        mock_response = MagicMock()
        mock_response.status_code = 201
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        test_broker._http_client = mock_client

        await test_broker._report_usage(result_data)

        mock_client.post.assert_called_once()
        args, kwargs = mock_client.post.call_args
        assert args[0] == "/api/v1/volundr/sessions/sess-abc/usage"
        payload = kwargs["json"]
        assert payload["tokens"] == 3 + 12 + 100 + 50
        assert payload["provider"] == "cloud"
        assert payload["model"] == "claude-opus-4-5-20251101"
        assert payload["cost"] == 0.05

    @pytest.mark.asyncio
    async def test_report_usage_skips_when_no_url(self, tmp_path):
        settings = SkuldSettings(
            session={"id": "x", "workspace_dir": str(tmp_path)},
            volundr_api_url="",
        )
        b = Broker(settings=settings)

        mock_client = AsyncMock()
        b._http_client = mock_client

        await b._report_usage({"modelUsage": {"m": {"inputTokens": 1, "outputTokens": 1}}})
        mock_client.post.assert_not_called()

    @pytest.mark.asyncio
    async def test_report_usage_handles_http_error(self, test_broker):
        result_data = {
            "modelUsage": {
                "claude-sonnet-4-20250514": {
                    "inputTokens": 10,
                    "outputTokens": 20,
                }
            }
        }

        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "Internal Server Error"
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        test_broker._http_client = mock_client

        # Should not raise
        await test_broker._report_usage(result_data)

    @pytest.mark.asyncio
    async def test_report_usage_empty_model_usage(self, test_broker):
        """Skip reporting when modelUsage is empty."""
        mock_client = AsyncMock()
        test_broker._http_client = mock_client

        await test_broker._report_usage({"modelUsage": {}})
        mock_client.post.assert_not_called()

    @pytest.mark.asyncio
    async def test_report_usage_zero_tokens_skipped(self, test_broker):
        """Skip models with zero total tokens."""
        mock_client = AsyncMock()
        test_broker._http_client = mock_client

        await test_broker._report_usage(
            {"modelUsage": {"m": {"inputTokens": 0, "outputTokens": 0}}}
        )
        mock_client.post.assert_not_called()

    @pytest.mark.asyncio
    async def test_report_usage_handles_exception(self, test_broker):
        """Network errors are caught without propagating."""
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(side_effect=Exception("connection refused"))
        test_broker._http_client = mock_client

        # Should not raise
        await test_broker._report_usage(
            {"modelUsage": {"m": {"inputTokens": 10, "outputTokens": 5}}}
        )

    @pytest.mark.asyncio
    async def test_get_http_client_lazy_init(self, test_broker):
        """HTTP client is created lazily on first use."""
        assert test_broker._http_client is None
        client = await test_broker._get_http_client()
        assert client is not None
        assert test_broker._http_client is client

        # Second call returns same instance
        client2 = await test_broker._get_http_client()
        assert client2 is client
        await client.aclose()

    @pytest.mark.asyncio
    async def test_get_http_client_uses_pat_for_auth(self, tmp_path, monkeypatch):
        """HTTP client uses VOLUNDR_API_TOKEN (PAT) for Bearer auth."""
        monkeypatch.setenv("VOLUNDR_API_TOKEN", "test-pat-token")
        settings = SkuldSettings(
            session={"id": "s1", "workspace_dir": str(tmp_path)},
            volundr_api_url="http://volundr-internal.volundr.svc",
        )
        b = Broker(settings=settings)
        headers = b._build_auth_headers()
        assert headers["Authorization"] == "Bearer test-pat-token"


class TestSessionArtifacts:
    """Tests for SessionArtifacts accumulator."""

    def test_record_tool_use_extracts_file_paths(self):
        from skuld.broker import SessionArtifacts

        artifacts = SessionArtifacts()
        data = {
            "content": [
                {
                    "type": "tool_use",
                    "input": {"file_path": "/src/main.py"},
                },
                {
                    "type": "tool_use",
                    "input": {"path": "/tests/test_main.py"},
                },
                {
                    "type": "text",
                    "text": "I edited the files",
                },
            ]
        }
        artifacts.record_tool_use(data)
        assert artifacts.files_changed == ["/src/main.py", "/tests/test_main.py"]

    def test_record_tool_use_deduplicates(self):
        from skuld.broker import SessionArtifacts

        artifacts = SessionArtifacts()
        data = {"content": [{"type": "tool_use", "input": {"file_path": "/src/main.py"}}]}
        artifacts.record_tool_use(data)
        artifacts.record_tool_use(data)
        assert artifacts.files_changed == ["/src/main.py"]

    def test_record_tool_use_empty_content(self):
        from skuld.broker import SessionArtifacts

        artifacts = SessionArtifacts()
        artifacts.record_tool_use({"content": []})
        artifacts.record_tool_use({})
        assert artifacts.files_changed == []

    def test_record_result_increments_turns(self):
        from skuld.broker import SessionArtifacts

        artifacts = SessionArtifacts()
        assert artifacts.turn_count == 0
        artifacts.record_result()
        artifacts.record_result()
        assert artifacts.turn_count == 2

    def test_duration_seconds(self):
        from skuld.broker import SessionArtifacts

        artifacts = SessionArtifacts()
        # duration should be >= 0
        assert artifacts.duration_seconds >= 0


class TestHandleCliEventArtifacts:
    """Tests for artifact accumulation in _handle_cli_event."""

    @pytest.fixture
    def test_broker(self, tmp_path):
        settings = SkuldSettings(
            session={"id": "test-session", "workspace_dir": str(tmp_path)},
            transport="subprocess",
        )
        return Broker(settings=settings)

    @pytest.mark.asyncio
    async def test_assistant_event_records_tool_use(self, test_broker):
        data = {
            "type": "assistant",
            "content": [
                {"type": "tool_use", "input": {"file_path": "/src/app.py"}},
            ],
        }
        await test_broker._handle_cli_event(data)
        assert "/src/app.py" in test_broker._artifacts.files_changed

    @pytest.mark.asyncio
    async def test_result_event_increments_turn_count(self, test_broker):
        test_broker.volundr_api_url = ""  # disable usage reporting
        data = {"type": "result", "modelUsage": {}}
        await test_broker._handle_cli_event(data)
        assert test_broker._artifacts.turn_count == 1


class TestReportChronicle:
    """Tests for Broker._report_chronicle."""

    @pytest.fixture
    def test_broker(self, tmp_path):
        settings = SkuldSettings(
            session={"id": "sess-chronicle", "workspace_dir": str(tmp_path)},
            volundr_api_url="http://volundr.test:80",
        )
        return Broker(settings=settings)

    @pytest.mark.asyncio
    async def test_report_chronicle_posts_to_api(self, test_broker):
        test_broker._artifacts.turn_count = 3
        test_broker._artifacts.files_changed = ["/src/main.py"]

        mock_response = MagicMock()
        mock_response.status_code = 201
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        test_broker._http_client = mock_client
        test_broker._transport = None  # skip AI summary

        await test_broker._report_chronicle()

        # Two POST calls: chronicle report + session_stop pipeline event
        assert mock_client.post.call_count == 2
        chronicle_call = mock_client.post.call_args_list[0]
        args, kwargs = chronicle_call
        assert args[0] == "/api/v1/volundr/sessions/sess-chronicle/chronicle"
        payload = kwargs["json"]
        assert "duration_seconds" in payload
        assert payload["key_changes"] == ["/src/main.py"]

        pipeline_call = mock_client.post.call_args_list[1]
        p_args, p_kwargs = pipeline_call
        assert p_args[0] == "/api/v1/volundr/events"
        assert p_kwargs["json"]["event_type"] == "session_stop"

    @pytest.mark.asyncio
    async def test_report_chronicle_skips_when_no_url(self, tmp_path):
        settings = SkuldSettings(
            session={"id": "x", "workspace_dir": str(tmp_path)},
            volundr_api_url="",
        )
        b = Broker(settings=settings)
        b._artifacts.turn_count = 1

        mock_client = AsyncMock()
        b._http_client = mock_client

        await b._report_chronicle()
        mock_client.post.assert_not_called()

    @pytest.mark.asyncio
    async def test_report_chronicle_skips_when_no_turns(self, test_broker):
        mock_client = AsyncMock()
        test_broker._http_client = mock_client

        await test_broker._report_chronicle()
        mock_client.post.assert_not_called()

    @pytest.mark.asyncio
    async def test_report_chronicle_handles_exception(self, test_broker):
        test_broker._artifacts.turn_count = 1
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(side_effect=Exception("connection refused"))
        test_broker._http_client = mock_client
        test_broker._transport = None

        # Should not raise
        await test_broker._report_chronicle()

    @pytest.mark.asyncio
    async def test_report_chronicle_handles_http_error(self, test_broker):
        test_broker._artifacts.turn_count = 1

        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "Internal Server Error"
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        test_broker._http_client = mock_client
        test_broker._transport = None

        # Should not raise
        await test_broker._report_chronicle()


class TestGenerateSummary:
    """Tests for Broker._generate_summary."""

    @pytest.fixture
    def test_broker(self, tmp_path):
        settings = SkuldSettings(
            session={"id": "s1", "workspace_dir": str(tmp_path)},
            volundr_api_url="http://volundr.test:80",
        )
        return Broker(settings=settings)

    @pytest.mark.asyncio
    async def test_generate_summary_no_transport(self, test_broker):
        test_broker._transport = None
        test_broker._artifacts.files_changed = ["/src/app.py"]

        result = await test_broker._generate_summary()

        assert result["summary"] is None
        assert result["key_changes"] == ["/src/app.py"]

    @pytest.mark.asyncio
    async def test_generate_summary_transport_not_alive(self, test_broker):
        mock_transport = MagicMock()
        mock_transport.is_alive = False
        test_broker._transport = mock_transport

        result = await test_broker._generate_summary()

        assert result["summary"] is None

    @pytest.mark.asyncio
    async def test_generate_summary_parses_json_response(self, test_broker):
        mock_transport = AsyncMock()
        mock_transport.is_alive = True
        mock_transport.last_result = {
            "result": '{"summary": "Did stuff", '
            '"key_changes": ["a.py: edited"], '
            '"unfinished_work": null}'
        }
        test_broker._transport = mock_transport

        result = await test_broker._generate_summary()

        assert result["summary"] == "Did stuff"
        assert result["key_changes"] == ["a.py: edited"]
        assert result["unfinished_work"] is None

    @pytest.mark.asyncio
    async def test_generate_summary_handles_bad_json(self, test_broker):
        mock_transport = AsyncMock()
        mock_transport.is_alive = True
        mock_transport.last_result = {"result": "not json at all"}
        test_broker._transport = mock_transport
        test_broker._artifacts.files_changed = ["/fallback.py"]

        result = await test_broker._generate_summary()

        assert result["summary"] is None
        assert result["key_changes"] == ["/fallback.py"]


class TestShutdownWithChronicle:
    """Tests for shutdown calling _report_chronicle before transport.stop()."""

    @pytest.fixture
    def test_broker(self, tmp_path):
        settings = SkuldSettings(
            session={"id": "s1", "workspace_dir": str(tmp_path)},
            volundr_api_url="http://volundr.test:80",
        )
        return Broker(settings=settings)

    @pytest.mark.asyncio
    async def test_shutdown_calls_report_chronicle(self, test_broker):
        call_order = []

        async def mock_report():
            call_order.append("report_chronicle")

        async def mock_stop():
            call_order.append("transport_stop")

        mock_transport = AsyncMock()
        mock_transport.stop = mock_stop
        test_broker._transport = mock_transport

        with patch.object(test_broker, "_report_chronicle", side_effect=mock_report):
            await test_broker.shutdown()

        assert "report_chronicle" in call_order
        assert "transport_stop" in call_order
        # Chronicle report must happen BEFORE transport stop
        assert call_order.index("report_chronicle") < call_order.index("transport_stop")


class TestShutdownEdgeCases:
    """Tests for shutdown edge cases."""

    @pytest.fixture
    def test_broker(self, tmp_path):
        settings = SkuldSettings(
            session={"id": "s1", "workspace_dir": str(tmp_path)},
            volundr_api_url="http://volundr.test:80",
        )
        return Broker(settings=settings)

    @pytest.mark.asyncio
    async def test_shutdown_closes_http_client(self, test_broker):
        mock_client = AsyncMock()
        test_broker._http_client = mock_client

        await test_broker.shutdown()
        mock_client.aclose.assert_called_once()
        assert test_broker._http_client is None

    @pytest.mark.asyncio
    async def test_shutdown_close_channel_exception_ignored(self, test_broker):
        """Channel close errors during shutdown are silently ignored."""
        bad_ch = AsyncMock()
        bad_ch.channel_type = "browser"
        bad_ch.is_open = True
        bad_ch.close.side_effect = Exception("already closed")
        test_broker._channels.add(bad_ch)

        # Should not raise
        await test_broker.shutdown()

    @pytest.mark.asyncio
    async def test_startup_with_volundr_api_url(self, test_broker):
        """Startup logs when volundr_api_url is set."""
        await test_broker.startup()
        assert test_broker._transport is not None
        assert test_broker.service_manager is not None


class TestHandleWebSocket:
    """Tests for Broker.handle_websocket and handle_cli_websocket."""

    @pytest.fixture
    def test_broker(self, tmp_path):
        settings = SkuldSettings(
            session={"id": "ws-session", "workspace_dir": str(tmp_path)},
            transport="sdk",
        )
        return Broker(settings=settings)

    @pytest.mark.asyncio
    async def test_handle_websocket_no_transport(self, test_broker):
        """Returns error JSON when transport is not initialized."""
        mock_ws = AsyncMock()
        test_broker._transport = None

        await test_broker.handle_websocket(mock_ws)

        mock_ws.accept.assert_called_once()
        mock_ws.send_json.assert_called_once()
        sent = mock_ws.send_json.call_args[0][0]
        assert sent["type"] == "error"
        assert "not initialized" in sent["content"]

    @pytest.mark.asyncio
    async def test_handle_websocket_normal_flow(self, test_broker):
        """Browser connects, receives welcome, sends message, then disconnects."""
        mock_transport = AsyncMock()
        mock_transport.is_alive = True
        mock_transport.capabilities = TransportCapabilities()
        test_broker._transport = mock_transport

        mock_ws = AsyncMock()
        # First receive_json returns a message, second raises disconnect
        mock_ws.receive_json = AsyncMock(side_effect=[{"content": "hello"}, WebSocketDisconnect()])

        await test_broker.handle_websocket(mock_ws)

        mock_ws.accept.assert_called_once()
        # Welcome message + no error
        calls = mock_ws.send_json.call_args_list
        assert any("Connected to session" in str(c) for c in calls)
        mock_transport.send_message.assert_called_once_with("hello")

    @pytest.mark.asyncio
    async def test_handle_websocket_sends_capabilities(self, test_broker):
        """Browser receives a capabilities message after welcome, before history."""
        mock_transport = AsyncMock()
        mock_transport.is_alive = True
        mock_transport.capabilities = TransportCapabilities(interrupt=True, set_model=True)
        test_broker._transport = mock_transport

        mock_ws = AsyncMock()
        mock_ws.receive_json = AsyncMock(side_effect=WebSocketDisconnect())

        await test_broker.handle_websocket(mock_ws)

        # Collect all sent messages
        calls = [c[0][0] for c in mock_ws.send_json.call_args_list]
        # Find capabilities message
        caps_msgs = [c for c in calls if c.get("type") == "capabilities"]
        assert len(caps_msgs) == 1
        caps = caps_msgs[0]
        assert caps["interrupt"] is True
        assert caps["set_model"] is True
        assert caps["rewind_files"] is False

        # Capabilities should come after welcome (system) message
        types = [c.get("type") for c in calls]
        system_idx = types.index("system")
        caps_idx = types.index("capabilities")
        assert caps_idx > system_idx

    @pytest.mark.asyncio
    async def test_handle_websocket_starts_transport(self, test_broker):
        """Transport.start() is called when transport is not alive."""
        mock_transport = AsyncMock()
        mock_transport.is_alive = False
        mock_transport.capabilities = TransportCapabilities()
        test_broker._transport = mock_transport

        mock_ws = AsyncMock()
        mock_ws.receive_json = AsyncMock(side_effect=WebSocketDisconnect())

        await test_broker.handle_websocket(mock_ws)

        mock_transport.start.assert_called_once()

    @pytest.mark.asyncio
    async def test_handle_websocket_dispatch_error(self, test_broker):
        """Errors during dispatch are sent as error events to the browser."""
        mock_transport = AsyncMock()
        mock_transport.is_alive = True
        mock_transport.capabilities = TransportCapabilities()
        mock_transport.send_message.side_effect = RuntimeError("CLI error")
        test_broker._transport = mock_transport

        mock_ws = AsyncMock()
        mock_ws.receive_json = AsyncMock(side_effect=[{"content": "hello"}, WebSocketDisconnect()])

        await test_broker.handle_websocket(mock_ws)

        # Should have sent an error message
        error_calls = [
            c for c in mock_ws.send_json.call_args_list if c[0][0].get("type") == "error"
        ]
        assert len(error_calls) == 1
        assert "CLI error" in error_calls[0][0][0]["content"]

    @pytest.mark.asyncio
    async def test_handle_websocket_unexpected_exception(self, test_broker):
        """Unexpected exceptions are caught and cleaned up."""
        mock_transport = AsyncMock()
        mock_transport.is_alive = True
        mock_transport.capabilities = TransportCapabilities()
        test_broker._transport = mock_transport

        mock_ws = AsyncMock()
        mock_ws.receive_json = AsyncMock(side_effect=RuntimeError("boom"))

        await test_broker.handle_websocket(mock_ws)

        # Channel should be removed from registry
        assert test_broker._channels.count == 0

    @pytest.mark.asyncio
    async def test_handle_cli_websocket_wrong_transport(self, test_broker):
        """Rejects CLI WS when transport does not support SDK WebSocket."""
        mock_transport = AsyncMock(spec=SubprocessTransport)
        mock_transport.capabilities = TransportCapabilities(session_resume=True)
        test_broker._transport = mock_transport
        mock_ws = AsyncMock()

        await test_broker.handle_cli_websocket(mock_ws, "ws-session")

        mock_ws.close.assert_called_once()
        assert mock_ws.close.call_args[1]["code"] == 1008

    @pytest.mark.asyncio
    async def test_handle_cli_websocket_codex_rejected(self, test_broker):
        """Rejects CLI WS for Codex transport (subprocess only)."""
        mock_transport = AsyncMock(spec=CodexSubprocessTransport)
        mock_transport.capabilities = TransportCapabilities()
        test_broker._transport = mock_transport
        mock_ws = AsyncMock()

        await test_broker.handle_cli_websocket(mock_ws, "ws-session")

        mock_ws.close.assert_called_once()
        assert mock_ws.close.call_args[1]["code"] == 1008

    @pytest.mark.asyncio
    async def test_handle_cli_websocket_session_mismatch(self, test_broker):
        """Rejects CLI WS when session ID doesn't match."""
        mock_transport = AsyncMock(spec=SdkWebSocketTransport)
        mock_transport.capabilities = TransportCapabilities(cli_websocket=True)
        test_broker._transport = mock_transport
        mock_ws = AsyncMock()

        await test_broker.handle_cli_websocket(mock_ws, "wrong-session")

        mock_ws.close.assert_called_once()
        assert mock_ws.close.call_args[1]["code"] == 1008

    @pytest.mark.asyncio
    async def test_handle_cli_websocket_success(self, test_broker):
        """CLI WS attaches to transport and waits for disconnect."""
        mock_transport = AsyncMock(spec=SdkWebSocketTransport)
        mock_transport.capabilities = TransportCapabilities(cli_websocket=True)
        test_broker._transport = mock_transport
        mock_ws = AsyncMock()

        await test_broker.handle_cli_websocket(mock_ws, "ws-session")

        mock_transport.attach_cli_websocket.assert_called_once_with(mock_ws)
        mock_transport.wait_for_cli_disconnect.assert_called_once()


class TestServiceAPIEndpoints:
    """Tests for service management API endpoints."""

    @pytest.fixture
    def client(self):
        return TestClient(app)

    def test_create_service_no_manager(self, client):
        broker.service_manager = None
        response = client.post(
            "/api/services",
            json={"name": "test-svc", "command": "echo hello", "port": 3000},
        )
        assert response.status_code == 503

    def test_list_services_no_manager(self, client):
        broker.service_manager = None
        response = client.get("/api/services")
        assert response.status_code == 503

    def test_get_service_no_manager(self, client):
        broker.service_manager = None
        response = client.get("/api/services/foo")
        assert response.status_code == 503

    def test_delete_service_no_manager(self, client):
        broker.service_manager = None
        response = client.delete("/api/services/foo")
        assert response.status_code == 503

    def test_get_service_logs_no_manager(self, client):
        broker.service_manager = None
        response = client.get("/api/services/foo/logs")
        assert response.status_code == 503

    def test_restart_service_no_manager(self, client):
        broker.service_manager = None
        response = client.post("/api/services/foo/restart")
        assert response.status_code == 503

    def test_get_service_not_found(self, client):
        mock_manager = AsyncMock()
        mock_manager.get_service = AsyncMock(return_value=None)
        broker.service_manager = mock_manager

        response = client.get("/api/services/nonexistent")
        assert response.status_code == 404
        broker.service_manager = None

    def test_delete_service_not_found(self, client):
        mock_manager = AsyncMock()
        mock_manager.remove_service = AsyncMock(return_value=False)
        broker.service_manager = mock_manager

        response = client.delete("/api/services/nonexistent")
        assert response.status_code == 404
        broker.service_manager = None

    def test_get_service_logs_not_found(self, client):
        mock_manager = AsyncMock()
        mock_manager.get_logs = AsyncMock(return_value=None)
        broker.service_manager = mock_manager

        response = client.get("/api/services/notfound/logs")
        assert response.status_code == 404
        broker.service_manager = None

    def test_restart_service_not_found(self, client):
        mock_manager = AsyncMock()
        mock_manager.restart_service = AsyncMock(return_value=None)
        broker.service_manager = mock_manager

        response = client.post("/api/services/notfound/restart")
        assert response.status_code == 404
        broker.service_manager = None

    def test_create_service_success(self, client):
        mock_status = {
            "name": "my-svc",
            "status": "running",
            "port": 3000,
            "command": "node app.js",
        }
        mock_manager = AsyncMock()
        mock_manager.add_service = AsyncMock(return_value=mock_status)
        broker.service_manager = mock_manager

        response = client.post(
            "/api/services",
            json={"name": "my-svc", "command": "node app.js", "port": 3000},
        )
        assert response.status_code == 200
        broker.service_manager = None

    def test_list_services_success(self, client):
        mock_manager = AsyncMock()
        mock_manager.list_services = AsyncMock(return_value=[])
        broker.service_manager = mock_manager

        response = client.get("/api/services")
        assert response.status_code == 200
        assert response.json() == []
        broker.service_manager = None

    def test_get_service_success(self, client):
        mock_status = {
            "name": "svc1",
            "status": "running",
            "port": 8080,
            "command": "python app.py",
        }
        mock_manager = AsyncMock()
        mock_manager.get_service = AsyncMock(return_value=mock_status)
        broker.service_manager = mock_manager

        response = client.get("/api/services/svc1")
        assert response.status_code == 200
        assert response.json()["name"] == "svc1"
        broker.service_manager = None

    def test_delete_service_success(self, client):
        mock_manager = AsyncMock()
        mock_manager.remove_service = AsyncMock(return_value=True)
        broker.service_manager = mock_manager

        response = client.delete("/api/services/svc1")
        assert response.status_code == 200
        assert response.json()["status"] == "removed"
        broker.service_manager = None

    def test_get_service_logs_success(self, client):
        mock_manager = AsyncMock()
        mock_manager.get_logs = AsyncMock(return_value="line1\nline2")
        broker.service_manager = mock_manager

        response = client.get("/api/services/svc1/logs?lines=50")
        assert response.status_code == 200
        assert response.json()["logs"] == "line1\nline2"
        broker.service_manager = None

    def test_restart_service_success(self, client):
        mock_status = {
            "name": "svc1",
            "status": "running",
            "port": 8080,
            "command": "python app.py",
            "restart_count": 1,
        }
        mock_manager = AsyncMock()
        mock_manager.restart_service = AsyncMock(return_value=mock_status)
        broker.service_manager = mock_manager

        response = client.post("/api/services/svc1/restart")
        assert response.status_code == 200
        assert response.json()["restart_count"] == 1
        broker.service_manager = None


class TestRecordToolUseReturnsEvents:
    """Tests for record_tool_use returning timeline-reportable events."""

    def test_returns_file_event_for_edit(self):
        from skuld.broker import SessionArtifacts

        artifacts = SessionArtifacts()
        data = {
            "content": [
                {
                    "type": "tool_use",
                    "name": "Edit",
                    "input": {"file_path": "/src/main.py"},
                },
            ]
        }
        events = artifacts.record_tool_use(data)
        assert len(events) == 1
        assert events[0]["type"] == "file"
        assert events[0]["label"] == "/src/main.py"
        assert events[0]["action"] == "modified"

    def test_returns_file_event_for_write(self):
        from skuld.broker import SessionArtifacts

        artifacts = SessionArtifacts()
        data = {
            "content": [
                {
                    "type": "tool_use",
                    "name": "Write",
                    "input": {"file_path": "/src/new.py"},
                },
            ]
        }
        events = artifacts.record_tool_use(data)
        assert len(events) == 1
        assert events[0]["type"] == "file"
        assert events[0]["action"] == "created"

    def test_returns_terminal_event_for_bash(self):
        from skuld.broker import SessionArtifacts

        artifacts = SessionArtifacts()
        data = {
            "content": [
                {
                    "type": "tool_use",
                    "name": "Bash",
                    "input": {"command": "python -m pytest tests/"},
                },
            ]
        }
        events = artifacts.record_tool_use(data)
        assert len(events) == 1
        assert events[0]["type"] == "terminal"
        assert "pytest" in events[0]["label"]

    def test_returns_git_event_for_git_commit(self):
        from skuld.broker import SessionArtifacts

        artifacts = SessionArtifacts()
        data = {
            "content": [
                {
                    "type": "tool_use",
                    "name": "Bash",
                    "input": {"command": 'git commit -m "feat: add feature"'},
                },
            ]
        }
        events = artifacts.record_tool_use(data)
        assert len(events) == 1
        assert events[0]["type"] == "git"
        assert "git commit" in events[0]["label"]

    def test_returns_git_event_for_chained_commit(self):
        from skuld.broker import SessionArtifacts

        artifacts = SessionArtifacts()
        data = {
            "content": [
                {
                    "type": "tool_use",
                    "name": "Bash",
                    "input": {"command": 'git add . && git commit -m "fix"'},
                },
            ]
        }
        events = artifacts.record_tool_use(data)
        assert len(events) == 1
        assert events[0]["type"] == "git"

    def test_returns_multiple_events(self):
        from skuld.broker import SessionArtifacts

        artifacts = SessionArtifacts()
        data = {
            "content": [
                {
                    "type": "tool_use",
                    "name": "Edit",
                    "input": {"file_path": "/src/a.py"},
                },
                {
                    "type": "tool_use",
                    "name": "Bash",
                    "input": {"command": "make test"},
                },
            ]
        }
        events = artifacts.record_tool_use(data)
        assert len(events) == 2
        assert events[0]["type"] == "file"
        assert events[1]["type"] == "terminal"

    def test_returns_empty_for_unknown_tools(self):
        from skuld.broker import SessionArtifacts

        artifacts = SessionArtifacts()
        data = {
            "content": [
                {
                    "type": "tool_use",
                    "name": "Read",
                    "input": {"file_path": "/src/a.py"},
                },
            ]
        }
        events = artifacts.record_tool_use(data)
        assert len(events) == 0
        # But file_path is still tracked
        assert artifacts.files_changed == ["/src/a.py"]

    def test_returns_empty_for_no_content(self):
        from skuld.broker import SessionArtifacts

        artifacts = SessionArtifacts()
        events = artifacts.record_tool_use({})
        assert events == []


class TestIsGitCommit:
    """Tests for _is_git_commit helper."""

    def test_simple_git_commit(self):
        from skuld.broker import _is_git_commit

        assert _is_git_commit('git commit -m "msg"') is True

    def test_git_commit_with_flags(self):
        from skuld.broker import _is_git_commit

        assert _is_git_commit("git commit --amend --no-edit") is True

    def test_chained_git_add_and_commit(self):
        from skuld.broker import _is_git_commit

        assert _is_git_commit('git add . && git commit -m "feat"') is True

    def test_git_config_prefix(self):
        from skuld.broker import _is_git_commit

        assert _is_git_commit('git -c user.name="x" commit -m "y"') is True

    def test_not_git_commit(self):
        from skuld.broker import _is_git_commit

        assert _is_git_commit("git status") is False
        assert _is_git_commit("git push origin main") is False
        assert _is_git_commit("python -m pytest") is False

    def test_empty_string(self):
        from skuld.broker import _is_git_commit

        assert _is_git_commit("") is False


class TestReportTimelineEvent:
    """Tests for Broker._report_timeline_event."""

    @pytest.fixture
    def test_broker(self, tmp_path):
        settings = SkuldSettings(
            session={"id": "sess-tl", "workspace_dir": str(tmp_path)},
            volundr_api_url="http://volundr.test:80",
        )
        return Broker(settings=settings)

    @pytest.mark.asyncio
    async def test_posts_event_to_api(self, test_broker):
        mock_response = MagicMock()
        mock_response.status_code = 201
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        test_broker._http_client = mock_client

        event = {"t": 10, "type": "message", "label": "Turn 1", "tokens": 500}
        await test_broker._report_timeline_event(event)

        mock_client.post.assert_called_once()
        args, kwargs = mock_client.post.call_args
        assert "/chronicles/sess-tl/timeline" in args[0]
        assert kwargs["json"]["type"] == "message"
        assert kwargs["json"]["tokens"] == 500

    @pytest.mark.asyncio
    async def test_skips_when_no_url(self, tmp_path):
        settings = SkuldSettings(
            session={"id": "x", "workspace_dir": str(tmp_path)},
            volundr_api_url="",
        )
        b = Broker(settings=settings)
        mock_client = AsyncMock()
        b._http_client = mock_client

        await b._report_timeline_event({"t": 0, "type": "session", "label": "start"})
        mock_client.post.assert_not_called()

    @pytest.mark.asyncio
    async def test_handles_http_error(self, test_broker):
        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_response.text = "Not Found"
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        test_broker._http_client = mock_client

        # Should not raise
        await test_broker._report_timeline_event({"t": 0, "type": "session", "label": "start"})

    @pytest.mark.asyncio
    async def test_handles_exception(self, test_broker):
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(side_effect=Exception("connection refused"))
        test_broker._http_client = mock_client

        # Should not raise
        await test_broker._report_timeline_event({"t": 0, "type": "session", "label": "start"})


class TestReportSessionStart:
    """Tests for Broker._report_session_start."""

    @pytest.fixture
    def test_broker(self, tmp_path):
        settings = SkuldSettings(
            session={"id": "sess-start", "workspace_dir": str(tmp_path)},
            volundr_api_url="http://volundr.test:80",
        )
        return Broker(settings=settings)

    @pytest.mark.asyncio
    async def test_reports_session_start_once(self, test_broker):
        with (
            patch.object(
                test_broker, "_report_timeline_event", new_callable=AsyncMock
            ) as mock_report,
            patch.object(test_broker, "_emit_pipeline_event", new_callable=AsyncMock),
        ):
            await test_broker._report_session_start()
            await test_broker._report_session_start()

            # Should only be called once (idempotent)
            mock_report.assert_called_once()
            event = mock_report.call_args[0][0]
            assert event["type"] == "session"
            assert event["t"] == 0

    @pytest.mark.asyncio
    async def test_sets_flag_after_first_call(self, test_broker):
        with (
            patch.object(test_broker, "_report_timeline_event", new_callable=AsyncMock),
            patch.object(test_broker, "_emit_pipeline_event", new_callable=AsyncMock),
        ):
            assert test_broker._session_start_reported is False
            await test_broker._report_session_start()
            assert test_broker._session_start_reported is True


class TestHandleCliEventTimeline:
    """Tests for timeline events in _handle_cli_event."""

    @pytest.fixture
    def test_broker(self, tmp_path):
        settings = SkuldSettings(
            session={"id": "sess-evt", "workspace_dir": str(tmp_path)},
            volundr_api_url="http://volundr.test:80",
        )
        return Broker(settings=settings)

    @pytest.mark.asyncio
    async def test_result_event_reports_message_timeline(self, test_broker):
        with (
            patch.object(
                test_broker, "_report_timeline_event", new_callable=AsyncMock
            ) as mock_report,
            patch.object(test_broker, "_report_usage", new_callable=AsyncMock),
        ):
            data = {
                "type": "result",
                "modelUsage": {
                    "claude-opus-4-6": {
                        "inputTokens": 100,
                        "outputTokens": 200,
                    }
                },
            }
            await test_broker._handle_cli_event(data)

            # Let background tasks complete
            import asyncio

            await asyncio.sleep(0.05)

            # Should have reported a message timeline event
            calls = mock_report.call_args_list
            message_calls = [c for c in calls if c[0][0]["type"] == "message"]
            assert len(message_calls) == 1
            assert message_calls[0][0][0]["tokens"] == 300
            assert "Turn 1" in message_calls[0][0][0]["label"]

    @pytest.mark.asyncio
    async def test_assistant_event_reports_file_timeline(self, test_broker):
        with patch.object(
            test_broker, "_report_timeline_event", new_callable=AsyncMock
        ) as mock_report:
            data = {
                "type": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "name": "Edit",
                        "input": {"file_path": "/src/app.py"},
                    },
                ],
            }
            await test_broker._handle_cli_event(data)

            import asyncio

            await asyncio.sleep(0.05)

            calls = mock_report.call_args_list
            file_calls = [c for c in calls if c[0][0]["type"] == "file"]
            assert len(file_calls) == 1
            assert file_calls[0][0][0]["label"] == "/src/app.py"

    @pytest.mark.asyncio
    async def test_assistant_bash_reports_terminal_timeline(self, test_broker):
        with patch.object(
            test_broker, "_report_timeline_event", new_callable=AsyncMock
        ) as mock_report:
            data = {
                "type": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "name": "Bash",
                        "input": {"command": "npm test"},
                    },
                ],
            }
            await test_broker._handle_cli_event(data)

            import asyncio

            await asyncio.sleep(0.05)

            calls = mock_report.call_args_list
            terminal_calls = [c for c in calls if c[0][0]["type"] == "terminal"]
            assert len(terminal_calls) == 1
            assert "npm test" in terminal_calls[0][0][0]["label"]

    @pytest.mark.asyncio
    async def test_result_with_zero_tokens_skips_timeline(self, test_broker):
        with (
            patch.object(
                test_broker, "_report_timeline_event", new_callable=AsyncMock
            ) as mock_report,
            patch.object(test_broker, "_report_usage", new_callable=AsyncMock),
        ):
            data = {"type": "result", "modelUsage": {}}
            await test_broker._handle_cli_event(data)

            import asyncio

            await asyncio.sleep(0.05)

            mock_report.assert_not_called()


class TestPipelineEventEmission:
    """Tests for Broker._emit_pipeline_event and _classify_pipeline_event."""

    @pytest.fixture
    def test_broker(self, tmp_path):
        settings = SkuldSettings(
            session={"id": "sess-pipeline", "workspace_dir": str(tmp_path)},
            volundr_api_url="http://volundr.test:80",
        )
        return Broker(settings=settings)

    def test_classify_file_created(self):
        ev = {"type": "file", "action": "created"}
        assert Broker._classify_pipeline_event(ev) == "file_created"

    def test_classify_file_modified(self):
        ev = {"type": "file", "action": "modified"}
        assert Broker._classify_pipeline_event(ev) == "file_modified"

    def test_classify_file_deleted(self):
        ev = {"type": "file", "action": "deleted"}
        assert Broker._classify_pipeline_event(ev) == "file_deleted"

    def test_classify_file_default(self):
        assert Broker._classify_pipeline_event({"type": "file"}) == "file_modified"

    def test_classify_git(self):
        assert Broker._classify_pipeline_event({"type": "git"}) == "git_commit"

    def test_classify_terminal(self):
        assert Broker._classify_pipeline_event({"type": "terminal"}) == "terminal_command"

    def test_classify_unknown(self):
        assert Broker._classify_pipeline_event({"type": "something"}) == "tool_use"

    @pytest.mark.asyncio
    async def test_emit_pipeline_event_posts(self, test_broker):
        mock_response = MagicMock()
        mock_response.status_code = 201
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        test_broker._http_client = mock_client

        await test_broker._emit_pipeline_event(
            "file_modified",
            {"path": "/src/main.py"},
            tokens_in=10,
            model="claude-sonnet-4-20250514",
        )

        mock_client.post.assert_called_once()
        args, kwargs = mock_client.post.call_args
        assert args[0] == "/api/v1/volundr/events"
        payload = kwargs["json"]
        assert payload["event_type"] == "file_modified"
        assert payload["session_id"] == "sess-pipeline"
        assert payload["tokens_in"] == 10
        assert payload["model"] == "claude-sonnet-4-20250514"
        assert "timestamp" in payload
        assert "sequence" in payload

    @pytest.mark.asyncio
    async def test_emit_pipeline_event_skips_when_no_url(self, tmp_path):
        settings = SkuldSettings(
            session={"id": "x", "workspace_dir": str(tmp_path)},
            volundr_api_url="",
        )
        b = Broker(settings=settings)
        mock_client = AsyncMock()
        b._http_client = mock_client

        await b._emit_pipeline_event("session_start", {})
        mock_client.post.assert_not_called()

    @pytest.mark.asyncio
    async def test_emit_pipeline_event_handles_error(self, test_broker):
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(side_effect=Exception("network error"))
        test_broker._http_client = mock_client

        # Should not raise
        await test_broker._emit_pipeline_event("error", {"message": "test"})

    @pytest.mark.asyncio
    async def test_sequence_increments(self, test_broker):
        assert test_broker._next_sequence() == 0
        assert test_broker._next_sequence() == 1
        assert test_broker._next_sequence() == 2

    @pytest.mark.asyncio
    async def test_session_start_emits_pipeline_event(self, test_broker):
        mock_response = MagicMock()
        mock_response.status_code = 201
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        test_broker._http_client = mock_client

        await test_broker._report_session_start()

        # Should have called timeline + pipeline events
        calls = mock_client.post.call_args_list
        pipeline_calls = [c for c in calls if c[0][0] == "/api/v1/volundr/events"]
        assert len(pipeline_calls) == 1
        payload = pipeline_calls[0][1]["json"]
        assert payload["event_type"] == "session_start"


class TestTokenRedactFilter:
    """Tests for JWT redaction in log output."""

    def test_redacts_access_token_in_msg(self):
        """access_token values are replaced with [REDACTED]."""
        f = _TokenRedactFilter()
        record = logging.LogRecord(
            name="uvicorn",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="WebSocket /session?access_token=eyJhbGciOiJSUzI1NiJ9.payload.sig [accepted]",
            args=None,
            exc_info=None,
        )
        f.filter(record)
        assert "eyJ" not in record.msg
        assert "access_token=[REDACTED]" in record.msg
        assert "[accepted]" in record.msg

    def test_leaves_messages_without_token(self):
        """Messages without access_token are unchanged."""
        f = _TokenRedactFilter()
        original = "GET /api/files HTTP/1.1 200"
        record = logging.LogRecord(
            name="uvicorn",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg=original,
            args=None,
            exc_info=None,
        )
        f.filter(record)
        assert record.msg == original

    def test_always_returns_true(self):
        """Filter returns True (keep the record, just redact)."""
        f = _TokenRedactFilter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="access_token=secret",
            args=None,
            exc_info=None,
        )
        assert f.filter(record) is True

    def test_handles_non_string_msg(self):
        """Non-string msg is left alone without error."""
        f = _TokenRedactFilter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg=12345,
            args=None,
            exc_info=None,
        )
        f.filter(record)
        assert record.msg == 12345

    def test_redacts_multiple_tokens_in_one_message(self):
        """Multiple tokens in one message are all redacted."""
        f = _TokenRedactFilter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="first access_token=abc123 second access_token=xyz789",
            args=None,
            exc_info=None,
        )
        f.filter(record)
        assert record.msg == "first access_token=[REDACTED] second access_token=[REDACTED]"

    def test_filter_attached_during_lifespan(self):
        """Lifespan attaches redact filter to uvicorn loggers."""
        import asyncio

        from skuld.broker import lifespan

        async def check():
            for name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
                logging.getLogger(name).filters = []

            with patch.object(broker, "startup", new_callable=AsyncMock):
                with patch.object(broker, "shutdown", new_callable=AsyncMock):
                    async with lifespan(app):
                        for name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
                            lgr = logging.getLogger(name)
                            has_redact = any(isinstance(f, _TokenRedactFilter) for f in lgr.filters)
                            assert has_redact, f"{name} missing _TokenRedactFilter"

        asyncio.run(check())
