"""Tests for CodexWebSocketTransport (Codex app-server over WebSocket)."""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from skuld.transports.codex_ws import (
    CodexWebSocketTransport,
    _pick_free_port,
    _rpc_notification,
    _rpc_request,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_transport(tmp_path, **kwargs):
    """Create a transport with defaults suitable for testing."""
    defaults = {
        "workspace_dir": str(tmp_path),
        "model": "o4-mini",
        "codex_port": 19999,
    }
    defaults.update(kwargs)
    return CodexWebSocketTransport(**defaults)


class FakeWebSocket:
    """Simulates a websockets ClientConnection for testing."""

    def __init__(self, responses=None):
        self.sent: list[str] = []
        self._responses = list(responses or [])
        self._closed = False
        self._recv_queue: asyncio.Queue = asyncio.Queue()

    async def send(self, data: str) -> None:
        self.sent.append(data)

    async def recv(self) -> str:
        return await self._recv_queue.get()

    async def close(self) -> None:
        self._closed = True

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return await asyncio.wait_for(self._recv_queue.get(), timeout=0.1)
        except TimeoutError:
            raise StopAsyncIteration

    def inject(self, msg: dict) -> None:
        """Push a message into the receive queue."""
        self._recv_queue.put_nowait(json.dumps(msg))


# ---------------------------------------------------------------------------
# Unit tests: RPC helpers
# ---------------------------------------------------------------------------


class TestRpcHelpers:
    def test_rpc_request_structure(self):
        rid, msg = _rpc_request("test/method", {"key": "val"})
        assert msg["jsonrpc"] == "2.0"
        assert msg["id"] == rid
        assert msg["method"] == "test/method"
        assert msg["params"] == {"key": "val"}

    def test_rpc_request_no_params(self):
        rid, msg = _rpc_request("test/method")
        assert "params" not in msg

    def test_rpc_notification_structure(self):
        msg = _rpc_notification("initialized")
        assert msg["jsonrpc"] == "2.0"
        assert msg["method"] == "initialized"
        assert "id" not in msg

    def test_pick_free_port(self):
        port = _pick_free_port()
        assert isinstance(port, int)
        assert 1024 <= port <= 65535


# ---------------------------------------------------------------------------
# Transport construction
# ---------------------------------------------------------------------------


class TestConstruction:
    def test_defaults(self, tmp_path):
        t = _make_transport(tmp_path)
        assert t.workspace_dir == str(tmp_path)
        assert t._model == "o4-mini"
        assert t._codex_port == 19999
        assert t.session_id is None
        assert t.last_result is None
        assert t.is_alive is False

    def test_capabilities(self, tmp_path):
        t = _make_transport(tmp_path)
        caps = t.capabilities
        assert caps.session_resume is True
        assert caps.interrupt is True
        assert caps.set_model is True
        assert caps.permission_requests is True
        assert caps.cli_websocket is False
        assert caps.set_thinking_tokens is False
        assert caps.rewind_files is False
        assert caps.mcp_set_servers is False
        assert caps.slash_commands is False
        assert caps.skills is False


# ---------------------------------------------------------------------------
# Handshake
# ---------------------------------------------------------------------------


class TestHandshake:
    @pytest.mark.asyncio
    async def test_handshake_sends_initialize_and_thread_start(self, tmp_path):
        t = _make_transport(tmp_path)
        ws = FakeWebSocket()
        t._ws = ws
        t._alive = True

        # Mock _send_rpc to return expected responses
        call_count = 0
        original_params = []

        async def fake_send_rpc(method, params=None):
            nonlocal call_count
            original_params.append((method, params))
            call_count += 1
            if method == "initialize":
                return {"userAgent": "codex/0.114.0"}
            if method == "thread/start":
                return {"thread": {"id": "thread-abc-123"}}
            return {}

        t._send_rpc = fake_send_rpc
        t._send_notification = AsyncMock()
        t._emit = AsyncMock()

        await t._handshake()

        # Verify initialize was called
        assert original_params[0][0] == "initialize"
        assert original_params[0][1]["clientInfo"]["name"] == "skuld"

        # Verify initialized notification
        t._send_notification.assert_called_once_with("initialized")

        # Verify thread/start
        assert original_params[1][0] == "thread/start"
        assert t._thread_id == "thread-abc-123"

        # Verify synthetic init event emitted
        t._emit.assert_called_once()
        init_event = t._emit.call_args[0][0]
        assert init_event["type"] == "system"
        assert init_event["subtype"] == "init"
        assert init_event["session_id"] == "thread-abc-123"

    @pytest.mark.asyncio
    async def test_handshake_with_system_prompt(self, tmp_path):
        t = _make_transport(tmp_path, system_prompt="Be helpful")
        t._ws = FakeWebSocket()
        t._alive = True

        params_captured = []

        async def fake_send_rpc(method, params=None):
            params_captured.append((method, params))
            if method == "initialize":
                return {"userAgent": "codex"}
            if method == "thread/start":
                return {"thread": {"id": "t-1"}}
            return {}

        t._send_rpc = fake_send_rpc
        t._send_notification = AsyncMock()
        t._emit = AsyncMock()

        await t._handshake()

        thread_params = params_captured[1][1]
        assert thread_params["developerInstructions"] == "Be helpful"

    @pytest.mark.asyncio
    async def test_handshake_skip_permissions(self, tmp_path):
        t = _make_transport(tmp_path, skip_permissions=True)
        t._ws = FakeWebSocket()
        t._alive = True

        params_captured = []

        async def fake_send_rpc(method, params=None):
            params_captured.append((method, params))
            if method == "initialize":
                return {"userAgent": "codex"}
            if method == "thread/start":
                return {"thread": {"id": "t-1"}}
            return {}

        t._send_rpc = fake_send_rpc
        t._send_notification = AsyncMock()
        t._emit = AsyncMock()

        await t._handshake()

        thread_params = params_captured[1][1]
        assert thread_params["approvalPolicy"] == "never"
        assert thread_params["sandbox"] == "danger-full-access"


# ---------------------------------------------------------------------------
# send_message
# ---------------------------------------------------------------------------


class TestSendMessage:
    @pytest.mark.asyncio
    async def test_send_message_calls_turn_start(self, tmp_path):
        t = _make_transport(tmp_path)
        t._thread_id = "thread-1"
        t._alive = True

        calls = []

        async def fake_send_rpc(method, params=None):
            calls.append((method, params))
            return {}

        t._send_rpc = fake_send_rpc

        await t.send_message("hello world")

        assert len(calls) == 1
        assert calls[0][0] == "turn/start"
        params = calls[0][1]
        assert params["threadId"] == "thread-1"
        assert params["input"][0]["type"] == "text"
        assert params["input"][0]["text"] == "hello world"

    @pytest.mark.asyncio
    async def test_send_message_without_thread_raises(self, tmp_path):
        t = _make_transport(tmp_path)
        with pytest.raises(RuntimeError, match="No active thread"):
            await t.send_message("test")


# ---------------------------------------------------------------------------
# Event normalization (notifications)
# ---------------------------------------------------------------------------


class TestEventNormalization:
    @pytest.mark.asyncio
    async def test_agent_message_delta(self, tmp_path):
        t = _make_transport(tmp_path)
        t._emit = AsyncMock()

        await t._handle_server_message(
            {
                "method": "item/agentMessage/delta",
                "params": {
                    "threadId": "t1",
                    "turnId": "turn1",
                    "itemId": "i1",
                    "delta": "Hello ",
                },
            }
        )

        t._emit.assert_called_once()
        event = t._emit.call_args[0][0]
        assert event["type"] == "content_block_delta"
        assert event["delta"]["type"] == "text_delta"
        assert event["delta"]["text"] == "Hello "

    @pytest.mark.asyncio
    async def test_reasoning_delta(self, tmp_path):
        t = _make_transport(tmp_path)
        t._emit = AsyncMock()

        await t._handle_server_message(
            {
                "method": "item/reasoning/textDelta",
                "params": {"threadId": "t1", "turnId": "turn1", "delta": "thinking..."},
            }
        )

        event = t._emit.call_args[0][0]
        assert event["delta"]["type"] == "thinking_delta"
        assert event["delta"]["thinking"] == "thinking..."

    @pytest.mark.asyncio
    async def test_turn_started_sets_turn_id(self, tmp_path):
        t = _make_transport(tmp_path)
        t._emit = AsyncMock()

        await t._handle_server_message(
            {
                "method": "turn/started",
                "params": {
                    "threadId": "t1",
                    "turn": {"id": "turn-42", "items": [], "status": "running", "error": None},
                },
            }
        )

        assert t._current_turn_id == "turn-42"

    @pytest.mark.asyncio
    async def test_turn_completed_emits_result(self, tmp_path):
        t = _make_transport(tmp_path)
        t._current_turn_id = "turn-42"
        t._emit = AsyncMock()

        await t._handle_server_message(
            {
                "method": "turn/completed",
                "params": {
                    "threadId": "t1",
                    "turn": {
                        "id": "turn-42",
                        "items": [],
                        "status": "completed",
                        "error": None,
                    },
                },
            }
        )

        assert t._current_turn_id is None
        t._emit.assert_called_once()
        event = t._emit.call_args[0][0]
        assert event["type"] == "result"
        assert event["stop_reason"] == "end_turn"

    @pytest.mark.asyncio
    async def test_token_usage_updated(self, tmp_path):
        t = _make_transport(tmp_path, model="o4-mini")
        t._emit = AsyncMock()

        await t._handle_server_message(
            {
                "method": "thread/tokenUsage/updated",
                "params": {
                    "threadId": "t1",
                    "turnId": "turn1",
                    "tokenUsage": {
                        "total": {
                            "totalTokens": 1500,
                            "inputTokens": 1000,
                            "cachedInputTokens": 200,
                            "outputTokens": 300,
                            "reasoningOutputTokens": 0,
                        },
                        "last": {},
                    },
                },
            }
        )

        assert t._last_result is not None
        usage = t._last_result["modelUsage"]["o4-mini"]
        assert usage["inputTokens"] == 1000
        assert usage["outputTokens"] == 300
        assert usage["cacheReadInputTokens"] == 200

    @pytest.mark.asyncio
    async def test_error_notification(self, tmp_path):
        t = _make_transport(tmp_path)
        t._emit = AsyncMock()

        await t._handle_server_message(
            {
                "method": "error",
                "params": {
                    "error": {"message": "rate limit exceeded"},
                    "willRetry": False,
                    "threadId": "t1",
                    "turnId": "turn1",
                },
            }
        )

        event = t._emit.call_args[0][0]
        assert event["type"] == "error"
        assert "rate limit" in event["content"]

    @pytest.mark.asyncio
    async def test_thread_closed_sets_not_alive(self, tmp_path):
        t = _make_transport(tmp_path)
        t._alive = True
        t._emit = AsyncMock()

        await t._handle_server_message({"method": "thread/closed", "params": {"threadId": "t1"}})

        assert t._alive is False


# ---------------------------------------------------------------------------
# Item lifecycle (tool calls)
# ---------------------------------------------------------------------------


class TestItemLifecycle:
    @pytest.mark.asyncio
    async def test_command_execution_started(self, tmp_path):
        t = _make_transport(tmp_path)
        t._emit = AsyncMock()

        await t._handle_item_started(
            {
                "type": "commandExecution",
                "id": "cmd-1",
                "command": "ls -la",
                "cwd": "/workspace",
            }
        )

        event = t._emit.call_args[0][0]
        assert event["type"] == "assistant"
        assert event["content"][0]["name"] == "Bash"
        assert event["content"][0]["input"]["command"] == "ls -la"

    @pytest.mark.asyncio
    async def test_file_change_started(self, tmp_path):
        t = _make_transport(tmp_path)
        t._emit = AsyncMock()

        await t._handle_item_started(
            {
                "type": "fileChange",
                "id": "fc-1",
                "changes": [{"path": "foo.py", "diff": "+hello"}],
            }
        )

        event = t._emit.call_args[0][0]
        assert event["content"][0]["name"] == "Edit"

    @pytest.mark.asyncio
    async def test_command_execution_completed(self, tmp_path):
        t = _make_transport(tmp_path)
        t._emit = AsyncMock()

        await t._handle_item_completed(
            {
                "type": "commandExecution",
                "id": "cmd-1",
                "aggregatedOutput": "file1.py\nfile2.py",
                "exitCode": 0,
            }
        )

        event = t._emit.call_args[0][0]
        assert event["type"] == "tool_result"
        assert event["is_error"] is False

    @pytest.mark.asyncio
    async def test_command_execution_failed(self, tmp_path):
        t = _make_transport(tmp_path)
        t._emit = AsyncMock()

        await t._handle_item_completed(
            {
                "type": "commandExecution",
                "id": "cmd-1",
                "aggregatedOutput": "error: not found",
                "exitCode": 1,
            }
        )

        event = t._emit.call_args[0][0]
        assert event["is_error"] is True

    @pytest.mark.asyncio
    async def test_mcp_tool_call_started(self, tmp_path):
        t = _make_transport(tmp_path)
        t._emit = AsyncMock()

        await t._handle_item_started(
            {
                "type": "mcpToolCall",
                "id": "mcp-1",
                "server": "mimir",
                "tool": "read_file",
                "arguments": {"path": "/tmp/test.py"},
            }
        )

        event = t._emit.call_args[0][0]
        assert event["content"][0]["name"] == "Read"


# ---------------------------------------------------------------------------
# Control: interrupt, set_model
# ---------------------------------------------------------------------------


class TestControl:
    @pytest.mark.asyncio
    async def test_interrupt_sends_turn_interrupt(self, tmp_path):
        t = _make_transport(tmp_path)
        t._thread_id = "thread-1"
        t._current_turn_id = "turn-5"

        calls = []

        async def fake_send_rpc(method, params=None):
            calls.append((method, params))
            return {}

        t._send_rpc = fake_send_rpc

        await t.send_control("interrupt")

        assert calls[0][0] == "turn/interrupt"
        assert calls[0][1]["threadId"] == "thread-1"
        assert calls[0][1]["turnId"] == "turn-5"

    @pytest.mark.asyncio
    async def test_interrupt_no_turn_does_nothing(self, tmp_path):
        t = _make_transport(tmp_path)
        t._thread_id = "thread-1"
        t._current_turn_id = None

        calls = []

        async def fake_send_rpc(method, params=None):
            calls.append((method, params))
            return {}

        t._send_rpc = fake_send_rpc

        await t.send_control("interrupt")
        assert len(calls) == 0

    @pytest.mark.asyncio
    async def test_set_model(self, tmp_path):
        t = _make_transport(tmp_path, model="o4-mini")
        await t.send_control("set_model", model="o3")
        assert t._model == "o3"


# ---------------------------------------------------------------------------
# Approval / permission requests
# ---------------------------------------------------------------------------


class TestApprovals:
    @pytest.mark.asyncio
    async def test_command_approval_emits_control_request(self, tmp_path):
        t = _make_transport(tmp_path)
        t._emit = AsyncMock()

        await t._handle_server_request(
            {
                "id": 42,
                "method": "item/commandExecution/requestApproval",
                "params": {
                    "threadId": "t1",
                    "turnId": "turn1",
                    "itemId": "cmd-1",
                    "command": "rm -rf /tmp/test",
                },
            }
        )

        event = t._emit.call_args[0][0]
        assert event["type"] == "control_request"
        assert event["tool"] == "Bash"
        assert event["input"]["command"] == "rm -rf /tmp/test"

        # Verify the approval is stored for later response
        assert "42" in t._pending_approvals

    @pytest.mark.asyncio
    async def test_send_control_response_approves(self, tmp_path):
        t = _make_transport(tmp_path)
        t._ws = FakeWebSocket()
        t._pending_approvals = {"42": 42}

        await t.send_control_response("42", {"behavior": "allow"})

        sent = json.loads(t._ws.sent[0])
        assert sent["id"] == 42
        assert sent["result"]["decision"] == "allow"

    @pytest.mark.asyncio
    async def test_send_control_response_denies(self, tmp_path):
        t = _make_transport(tmp_path)
        t._ws = FakeWebSocket()
        t._pending_approvals = {"42": 42}

        await t.send_control_response("42", {"behavior": "deny"})

        sent = json.loads(t._ws.sent[0])
        assert sent["result"]["decision"] == "deny"


# ---------------------------------------------------------------------------
# Session resume
# ---------------------------------------------------------------------------


class TestResume:
    @pytest.mark.asyncio
    async def test_resume_sends_thread_resume(self, tmp_path):
        t = _make_transport(tmp_path)

        calls = []

        async def fake_send_rpc(method, params=None):
            calls.append((method, params))
            return {"thread": {"id": "resumed-thread"}}

        t._send_rpc = fake_send_rpc
        t._emit = AsyncMock()

        await t.resume("old-thread-id")

        assert calls[0][0] == "thread/resume"
        assert calls[0][1]["threadId"] == "old-thread-id"
        assert t._thread_id == "resumed-thread"

        init_event = t._emit.call_args[0][0]
        assert init_event["type"] == "system"
        assert init_event["session_id"] == "resumed-thread"


# ---------------------------------------------------------------------------
# Receive loop
# ---------------------------------------------------------------------------


class TestReceiveLoop:
    @pytest.mark.asyncio
    async def test_rpc_response_resolves_future(self, tmp_path):
        t = _make_transport(tmp_path)
        ws = FakeWebSocket()
        t._ws = ws
        t._alive = True

        loop = asyncio.get_event_loop()
        fut = loop.create_future()
        t._pending[1] = fut

        t._resolve_pending({"id": 1, "result": {"ok": True}})

        assert fut.done()
        assert fut.result() == {"ok": True}

    @pytest.mark.asyncio
    async def test_rpc_error_sets_exception(self, tmp_path):
        t = _make_transport(tmp_path)
        loop = asyncio.get_event_loop()
        fut = loop.create_future()
        t._pending[2] = fut

        t._resolve_pending({"id": 2, "error": {"code": -32600, "message": "bad request"}})

        assert fut.done()
        with pytest.raises(RuntimeError, match="bad request"):
            fut.result()


# ---------------------------------------------------------------------------
# Stop / cleanup
# ---------------------------------------------------------------------------


class TestStopCleanup:
    @pytest.mark.asyncio
    async def test_stop_closes_ws_and_process(self, tmp_path):
        t = _make_transport(tmp_path)
        ws = FakeWebSocket()
        t._ws = ws
        t._alive = True

        mock_process = MagicMock()
        mock_process.returncode = None
        mock_process.terminate = MagicMock()
        mock_process.kill = MagicMock()
        mock_process.wait = AsyncMock(return_value=0)
        mock_process.pid = 12345
        t._process = mock_process

        loop = asyncio.get_event_loop()
        fut = loop.create_future()
        t._pending[99] = fut

        await t.stop()

        assert t._alive is False
        assert t._ws is None
        assert t._process is None
        assert ws._closed is True
        assert fut.cancelled()


# ---------------------------------------------------------------------------
# Config integration
# ---------------------------------------------------------------------------


class TestConfigIntegration:
    def test_codex_ws_cli_type_resolves_adapter(self):
        from skuld.config import SkuldSettings

        settings = SkuldSettings(cli_type="codex-ws")
        assert settings.transport_adapter == "skuld.transports.codex_ws.CodexWebSocketTransport"

    def test_codex_cli_type_still_works(self):
        from skuld.config import SkuldSettings

        settings = SkuldSettings(cli_type="codex")
        assert settings.transport_adapter == "skuld.transports.codex.CodexSubprocessTransport"
