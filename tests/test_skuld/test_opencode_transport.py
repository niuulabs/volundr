"""Tests for OpenCodeHttpTransport (OpenCode via HTTP REST + SSE)."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from skuld.transports.opencode import OpenCodeHttpTransport, _pick_free_port

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_transport(tmp_path, **kwargs):
    defaults = {
        "workspace_dir": str(tmp_path),
        "model": "",
        "opencode_port": 19998,
    }
    defaults.update(kwargs)
    return OpenCodeHttpTransport(**defaults)


def _collect_emits(transport):
    mock = AsyncMock()
    transport._emit = mock
    return mock


def _emitted_events(mock):
    return [call[0][0] for call in mock.call_args_list]


def _events_of_type(mock, event_type):
    return [e for e in _emitted_events(mock) if e.get("type") == event_type]


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


class TestConstruction:
    def test_defaults(self, tmp_path):
        t = _make_transport(tmp_path)
        assert t.workspace_dir == str(tmp_path)
        assert t._opencode_port == 19998
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

    def test_pick_free_port(self):
        port = _pick_free_port()
        assert 1024 <= port <= 65535


# ---------------------------------------------------------------------------
# SSE event normalization
# ---------------------------------------------------------------------------


class TestSSEEventNormalization:
    @pytest.mark.asyncio
    async def test_text_delta(self, tmp_path):
        t = _make_transport(tmp_path)
        emit = _collect_emits(t)

        await t._handle_sse_event(
            {
                "type": "message.part.delta",
                "properties": {
                    "sessionID": "s1",
                    "messageID": "m1",
                    "partID": "p1",
                    "field": "text",
                    "delta": "Hello ",
                },
            }
        )

        events = _emitted_events(emit)
        assert len(events) == 1
        assert events[0]["type"] == "content_block_delta"
        assert events[0]["delta"]["type"] == "text_delta"
        assert events[0]["delta"]["text"] == "Hello "

    @pytest.mark.asyncio
    async def test_thinking_delta(self, tmp_path):
        t = _make_transport(tmp_path)
        emit = _collect_emits(t)

        await t._handle_sse_event(
            {
                "type": "message.part.delta",
                "properties": {
                    "sessionID": "s1",
                    "messageID": "m1",
                    "partID": "p1",
                    "field": "thinking",
                    "delta": "reasoning...",
                },
            }
        )

        event = emit.call_args[0][0]
        assert event["delta"]["type"] == "thinking_delta"
        assert event["delta"]["thinking"] == "reasoning..."

    @pytest.mark.asyncio
    async def test_empty_delta_ignored(self, tmp_path):
        t = _make_transport(tmp_path)
        emit = _collect_emits(t)

        await t._handle_sse_event(
            {
                "type": "message.part.delta",
                "properties": {"field": "text", "delta": ""},
            }
        )

        emit.assert_not_called()

    @pytest.mark.asyncio
    async def test_session_idle_emits_result(self, tmp_path):
        t = _make_transport(tmp_path, model="claude-sonnet-4-6")
        t._last_usage = {
            "claude-sonnet-4-6": {
                "inputTokens": 100,
                "outputTokens": 50,
                "cacheReadInputTokens": 0,
                "cacheCreationInputTokens": 0,
            }
        }
        emit = _collect_emits(t)

        await t._handle_sse_event({"type": "session.idle", "properties": {"sessionID": "s1"}})

        result = _events_of_type(emit, "result")[0]
        assert result["stop_reason"] == "end_turn"
        assert result["modelUsage"]["claude-sonnet-4-6"]["inputTokens"] == 100

    @pytest.mark.asyncio
    async def test_session_error(self, tmp_path):
        t = _make_transport(tmp_path)
        emit = _collect_emits(t)

        await t._handle_sse_event(
            {
                "type": "session.error",
                "properties": {"error": "model rate limited"},
            }
        )

        event = emit.call_args[0][0]
        assert event["type"] == "error"
        assert event["error"] == "model rate limited"

    @pytest.mark.asyncio
    async def test_session_status_analyzing_emits_assistant(self, tmp_path):
        t = _make_transport(tmp_path, model="gpt-4o")
        emit = _collect_emits(t)

        await t._handle_sse_event(
            {
                "type": "session.status",
                "properties": {"status": "analyzing"},
            }
        )

        assistant_events = _events_of_type(emit, "assistant")
        assert len(assistant_events) == 1
        assert assistant_events[0]["message"]["model"] == "gpt-4o"

    @pytest.mark.asyncio
    async def test_permission_request(self, tmp_path):
        t = _make_transport(tmp_path)
        emit = _collect_emits(t)

        await t._handle_sse_event(
            {
                "type": "question.asked",
                "properties": {
                    "id": "perm-42",
                    "tool": "shell",
                    "question": "Run: rm -rf /tmp/test",
                },
            }
        )

        event = emit.call_args[0][0]
        assert event["type"] == "control_request"
        assert event["request_id"] == "perm-42"
        assert event["tool"] == "Bash"
        assert "perm-42" in t._pending_permissions

    @pytest.mark.asyncio
    async def test_heartbeat_ignored(self, tmp_path):
        t = _make_transport(tmp_path)
        emit = _collect_emits(t)

        await t._handle_sse_event({"type": "server.heartbeat", "properties": {}})

        emit.assert_not_called()

    @pytest.mark.asyncio
    async def test_connected_ignored(self, tmp_path):
        t = _make_transport(tmp_path)
        emit = _collect_emits(t)

        await t._handle_sse_event({"type": "server.connected", "properties": {}})

        emit.assert_not_called()


# ---------------------------------------------------------------------------
# Part handling
# ---------------------------------------------------------------------------


class TestPartHandling:
    @pytest.mark.asyncio
    async def test_tool_invocation_emits_assistant_and_blocks(self, tmp_path):
        t = _make_transport(tmp_path, model="gpt-4o")
        emit = _collect_emits(t)

        await t._handle_part_updated(
            {
                "type": "tool-invocation",
                "id": "tool-1",
                "toolName": "shell",
                "args": {"command": "ls -la"},
            },
            {},
        )

        events = _emitted_events(emit)

        # Assistant event for broker tracking
        assistant_events = _events_of_type(emit, "assistant")
        assert len(assistant_events) == 1
        tool_block = assistant_events[0]["message"]["content"][0]
        assert tool_block["name"] == "Bash"
        assert tool_block["input"]["command"] == "ls -la"

        # content_block_start for browser
        block_starts = _events_of_type(emit, "content_block_start")
        assert block_starts[0]["content_block"]["type"] == "tool_use"

        # input_json_delta
        deltas = [
            e
            for e in events
            if e.get("type") == "content_block_delta"
            and e.get("delta", {}).get("type") == "input_json_delta"
        ]
        assert len(deltas) == 1

    @pytest.mark.asyncio
    async def test_tool_result_emits_stop_and_text(self, tmp_path):
        t = _make_transport(tmp_path)
        emit = _collect_emits(t)

        await t._handle_part_updated(
            {
                "type": "tool-result",
                "result": "file1.py\nfile2.py",
                "isError": False,
            },
            {},
        )

        events = _emitted_events(emit)

        stops = _events_of_type(emit, "content_block_stop")
        assert len(stops) >= 1

        text_deltas = [
            e
            for e in events
            if e.get("type") == "content_block_delta"
            and e.get("delta", {}).get("type") == "text_delta"
        ]
        assert any("file1.py" in d["delta"]["text"] for d in text_deltas)

    @pytest.mark.asyncio
    async def test_tool_result_error(self, tmp_path):
        t = _make_transport(tmp_path)
        emit = _collect_emits(t)

        await t._handle_part_updated(
            {
                "type": "tool-result",
                "result": "command not found",
                "isError": True,
            },
            {},
        )

        text_deltas = [
            e
            for e in _emitted_events(emit)
            if e.get("type") == "content_block_delta"
            and e.get("delta", {}).get("type") == "text_delta"
        ]
        assert any("[error]" in d["delta"]["text"] for d in text_deltas)

    @pytest.mark.asyncio
    async def test_text_part_emits_block_start(self, tmp_path):
        t = _make_transport(tmp_path)
        emit = _collect_emits(t)

        await t._handle_part_updated(
            {"type": "text", "text": "Initial text"},
            {},
        )

        block_starts = _events_of_type(emit, "content_block_start")
        assert block_starts[0]["content_block"]["type"] == "text"

    @pytest.mark.asyncio
    async def test_reasoning_part_emits_thinking_block(self, tmp_path):
        t = _make_transport(tmp_path)
        emit = _collect_emits(t)

        await t._handle_part_updated(
            {"type": "reasoning"},
            {},
        )

        block_starts = _events_of_type(emit, "content_block_start")
        assert block_starts[0]["content_block"]["type"] == "thinking"

    @pytest.mark.asyncio
    async def test_finish_part_saves_usage(self, tmp_path):
        t = _make_transport(tmp_path, model="gpt-4o")
        _collect_emits(t)

        await t._handle_part_updated(
            {"type": "finish", "reason": "end_turn"},
            {},
        )

        assert t._last_usage is not None
        assert "gpt-4o" in t._last_usage

    @pytest.mark.asyncio
    async def test_block_index_increments(self, tmp_path):
        t = _make_transport(tmp_path)
        emit = _collect_emits(t)

        await t._handle_part_updated({"type": "text", "text": ""}, {})
        await t._handle_part_updated({"type": "reasoning"}, {})

        block_starts = _events_of_type(emit, "content_block_start")
        assert block_starts[0]["index"] == 0
        assert block_starts[1]["index"] == 1


# ---------------------------------------------------------------------------
# send_message
# ---------------------------------------------------------------------------


class TestSendMessage:
    @pytest.mark.asyncio
    async def test_send_message_without_session_raises(self, tmp_path):
        t = _make_transport(tmp_path)
        with pytest.raises(RuntimeError, match="No active session"):
            await t.send_message("test")

    @pytest.mark.asyncio
    async def test_send_message_resets_state(self, tmp_path):
        t = _make_transport(tmp_path)
        t._session_id = "s1"
        t._last_result = {"old": True}
        t._last_usage = {"old": True}
        t._block_index = 5

        mock_client = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 204
        mock_client.post = AsyncMock(return_value=mock_resp)
        t._client = mock_client

        await t.send_message("test")

        assert t._last_result is None
        assert t._last_usage is None
        assert t._block_index == 0

    @pytest.mark.asyncio
    async def test_send_message_posts_prompt_async(self, tmp_path):
        t = _make_transport(tmp_path, model="gpt-4o", system_prompt="Be helpful")
        t._session_id = "s1"

        mock_client = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 204
        mock_client.post = AsyncMock(return_value=mock_resp)
        t._client = mock_client

        await t.send_message("What is 2+2?")

        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[0][0] == "/session/s1/prompt_async"
        body = call_args[1]["json"]
        assert body["parts"][0]["type"] == "text"
        assert body["parts"][0]["text"] == "What is 2+2?"
        assert body["system"] == "Be helpful"
        assert body["model"]["modelID"] == "gpt-4o"


# ---------------------------------------------------------------------------
# Control: interrupt, set_model, permissions
# ---------------------------------------------------------------------------


class TestControl:
    @pytest.mark.asyncio
    async def test_set_model(self, tmp_path):
        t = _make_transport(tmp_path)
        await t.send_control("set_model", model="claude-opus-4-6")
        assert t._model == "claude-opus-4-6"

    @pytest.mark.asyncio
    async def test_interrupt_posts_abort(self, tmp_path):
        t = _make_transport(tmp_path)
        t._session_id = "s1"

        mock_client = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_client.post = AsyncMock(return_value=mock_resp)
        t._client = mock_client

        await t.send_control("interrupt")

        mock_client.post.assert_called_once_with("/session/s1/abort")


class TestPermissions:
    @pytest.mark.asyncio
    async def test_permission_allow(self, tmp_path):
        t = _make_transport(tmp_path)
        t._pending_permissions["perm-1"] = {"id": "perm-1"}

        mock_client = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_client.post = AsyncMock(return_value=mock_resp)
        t._client = mock_client

        await t.send_control_response("perm-1", {"behavior": "allow"})

        call_args = mock_client.post.call_args
        assert call_args[0][0] == "/permission/perm-1/reply"
        assert call_args[1]["json"]["reply"] == "allow"
        assert "perm-1" not in t._pending_permissions

    @pytest.mark.asyncio
    async def test_permission_deny(self, tmp_path):
        t = _make_transport(tmp_path)
        t._pending_permissions["perm-2"] = {"id": "perm-2"}

        mock_client = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_client.post = AsyncMock(return_value=mock_resp)
        t._client = mock_client

        await t.send_control_response("perm-2", {"behavior": "deny"})

        call_args = mock_client.post.call_args
        assert call_args[1]["json"]["reply"] == "deny"


# ---------------------------------------------------------------------------
# Resume
# ---------------------------------------------------------------------------


class TestResume:
    @pytest.mark.asyncio
    async def test_resume(self, tmp_path):
        t = _make_transport(tmp_path)
        emit = _collect_emits(t)

        await t.resume("existing-session-id")

        assert t._session_id == "existing-session-id"
        init_event = emit.call_args[0][0]
        assert init_event["type"] == "system"
        assert init_event["session_id"] == "existing-session-id"


# ---------------------------------------------------------------------------
# Stop / cleanup
# ---------------------------------------------------------------------------


class TestStopCleanup:
    @pytest.mark.asyncio
    async def test_stop_cleans_up(self, tmp_path):
        t = _make_transport(tmp_path)
        t._alive = True

        mock_client = AsyncMock()
        t._client = mock_client

        mock_process = MagicMock()
        mock_process.returncode = None
        mock_process.terminate = MagicMock()
        mock_process.kill = MagicMock()
        mock_process.wait = AsyncMock(return_value=0)
        mock_process.pid = 12345
        t._process = mock_process

        await t.stop()

        assert t._alive is False
        assert t._client is None
        assert t._process is None
        mock_client.aclose.assert_called_once()


# ---------------------------------------------------------------------------
# Config integration
# ---------------------------------------------------------------------------


class TestConfigIntegration:
    def test_opencode_cli_type_resolves_adapter(self):
        from skuld.config import SkuldSettings

        settings = SkuldSettings(cli_type="opencode")
        assert settings.transport_adapter == "skuld.transports.opencode.OpenCodeHttpTransport"


# ---------------------------------------------------------------------------
# End-to-end: full turn simulation
# ---------------------------------------------------------------------------


class TestFullTurnFlow:
    @pytest.mark.asyncio
    async def test_text_turn_lifecycle(self, tmp_path):
        """session.status → text block → deltas → session.idle."""
        t = _make_transport(tmp_path, model="claude-sonnet-4-6")
        emit = _collect_emits(t)

        # 1. Status: analyzing
        await t._handle_sse_event({"type": "session.status", "properties": {"status": "analyzing"}})

        # 2. Text part created
        await t._handle_sse_event(
            {
                "type": "message.part.updated",
                "properties": {
                    "part": {"type": "text", "text": ""},
                    "sessionID": "s1",
                    "messageID": "m1",
                    "partID": "p1",
                },
            }
        )

        # 3. Text deltas
        await t._handle_sse_event(
            {
                "type": "message.part.delta",
                "properties": {
                    "sessionID": "s1",
                    "messageID": "m1",
                    "partID": "p1",
                    "field": "text",
                    "delta": "Four.",
                },
            }
        )

        # 4. Finish part
        await t._handle_sse_event(
            {
                "type": "message.part.updated",
                "properties": {
                    "part": {"type": "finish", "reason": "end_turn"},
                    "sessionID": "s1",
                    "messageID": "m1",
                    "partID": "p2",
                },
            }
        )

        # 5. Session idle
        await t._handle_sse_event({"type": "session.idle", "properties": {"sessionID": "s1"}})

        events = _emitted_events(emit)
        types = [e["type"] for e in events]

        assert "assistant" in types
        assert "content_block_start" in types
        assert "content_block_delta" in types
        assert "result" in types

        result = _events_of_type(emit, "result")[0]
        assert result["stop_reason"] == "end_turn"
        assert "claude-sonnet-4-6" in result["modelUsage"]

    @pytest.mark.asyncio
    async def test_tool_turn_lifecycle(self, tmp_path):
        """Tool call: tool-invocation → tool-result → session.idle."""
        t = _make_transport(tmp_path, model="gpt-4o")
        emit = _collect_emits(t)

        # Status
        await t._handle_sse_event({"type": "session.status", "properties": {"status": "executing"}})

        # Tool invocation
        await t._handle_sse_event(
            {
                "type": "message.part.updated",
                "properties": {
                    "part": {
                        "type": "tool-invocation",
                        "id": "tool-1",
                        "toolName": "read_file",
                        "args": {"path": "/tmp/test.py"},
                    },
                    "sessionID": "s1",
                    "messageID": "m1",
                    "partID": "p1",
                },
            }
        )

        # Tool result
        await t._handle_sse_event(
            {
                "type": "message.part.updated",
                "properties": {
                    "part": {
                        "type": "tool-result",
                        "result": "print('hello')",
                        "isError": False,
                    },
                    "sessionID": "s1",
                    "messageID": "m1",
                    "partID": "p2",
                },
            }
        )

        events = _emitted_events(emit)

        # Assistant event for broker
        assistant_events = _events_of_type(emit, "assistant")
        assert len(assistant_events) >= 1
        tool_assistants = [e for e in assistant_events if e.get("message", {}).get("content")]
        tool_block = tool_assistants[-1]["message"]["content"][0]
        assert tool_block["name"] == "Read"

        # Output visible
        text_deltas = [
            e
            for e in events
            if e.get("type") == "content_block_delta"
            and e.get("delta", {}).get("type") == "text_delta"
        ]
        assert any("hello" in d["delta"]["text"] for d in text_deltas)
