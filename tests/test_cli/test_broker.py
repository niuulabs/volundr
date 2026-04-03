"""Tests for cli.broker.broker — SessionBroker multi-client broadcast and history."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from cli.broker.broker import SessionBroker


class FakeWebSocket:
    """Minimal fake WebSocket for testing."""

    def __init__(self) -> None:
        self.sent: list[str] = []
        self.closed = False

    async def send_text(self, data: str) -> None:
        self.sent.append(data)

    async def close(self) -> None:
        self.closed = True


class FakeTransport:
    """Fake Transport implementation for testing."""

    def __init__(self, session_id: str = "test-session") -> None:
        self._session_id = session_id
        self.user_messages: list[tuple[Any, str]] = []
        self.control_responses: list[dict[str, Any]] = []

    def send_user_message(self, content: Any, cli_session_id: str) -> None:
        self.user_messages.append((content, cli_session_id))

    def send_control_response(self, response: dict[str, Any]) -> None:
        self.control_responses.append(response)

    def cli_session_id(self) -> str:
        return self._session_id


@pytest.fixture
def transport() -> FakeTransport:
    return FakeTransport()


@pytest.fixture
def broker(transport: FakeTransport) -> SessionBroker:
    return SessionBroker(session_id="sess-1", transport=transport)


class TestSessionBrokerAddRemove:
    async def test_add_browser_sends_welcome(self, broker: SessionBroker) -> None:
        ws = FakeWebSocket()
        bc = await broker.add_browser(ws)
        await asyncio.sleep(0.05)
        assert len(ws.sent) >= 1
        welcome = json.loads(ws.sent[0])
        assert welcome["type"] == "system"
        assert "sess-1" in welcome["content"]
        await broker.remove_browser(bc)

    async def test_remove_browser(self, broker: SessionBroker) -> None:
        ws = FakeWebSocket()
        bc = await broker.add_browser(ws)
        await broker.remove_browser(bc)
        assert ws.closed


class TestSessionBrokerBroadcast:
    async def test_broadcast_to_multiple_clients(self, broker: SessionBroker) -> None:
        ws1 = FakeWebSocket()
        ws2 = FakeWebSocket()
        await broker.add_browser(ws1)
        await broker.add_browser(ws2)
        await asyncio.sleep(0.05)

        # Clear welcome messages.
        ws1.sent.clear()
        ws2.sent.clear()

        await broker._broadcast({"type": "test", "data": "hello"})
        await asyncio.sleep(0.05)

        assert len(ws1.sent) == 1
        assert len(ws2.sent) == 1
        assert json.loads(ws1.sent[0])["data"] == "hello"

        await broker.stop()


class TestSessionBrokerHandleBrowserMessage:
    async def test_user_message_forwarded_to_transport(
        self,
        broker: SessionBroker,
        transport: FakeTransport,
    ) -> None:
        ws = FakeWebSocket()
        await broker.add_browser(ws)

        await broker.handle_browser_message({"type": "user", "content": "hello"})

        assert len(transport.user_messages) == 1
        assert transport.user_messages[0][0] == "hello"
        await broker.stop()

    async def test_user_message_recorded_in_history(self, broker: SessionBroker) -> None:
        ws = FakeWebSocket()
        await broker.add_browser(ws)

        await broker.handle_browser_message({"type": "user", "content": "test"})

        history = broker.conversation_history()
        assert len(history["turns"]) == 1
        assert history["turns"][0]["role"] == "user"
        assert history["turns"][0]["content"] == "test"
        await broker.stop()

    async def test_legacy_format_handled(
        self,
        broker: SessionBroker,
        transport: FakeTransport,
    ) -> None:
        ws = FakeWebSocket()
        await broker.add_browser(ws)

        await broker.handle_browser_message({"content": "legacy msg"})

        assert len(transport.user_messages) == 1
        await broker.stop()

    async def test_permission_response_forwarded(
        self,
        broker: SessionBroker,
        transport: FakeTransport,
    ) -> None:
        ws = FakeWebSocket()
        await broker.add_browser(ws)

        await broker.handle_browser_message(
            {
                "type": "permission_response",
                "request_id": "r1",
                "behavior": "allow",
            }
        )

        assert len(transport.control_responses) == 1
        assert transport.control_responses[0]["subtype"] == "success"
        await broker.stop()

    async def test_interrupt_forwarded(
        self,
        broker: SessionBroker,
        transport: FakeTransport,
    ) -> None:
        ws = FakeWebSocket()
        await broker.add_browser(ws)

        await broker.handle_browser_message({"type": "interrupt"})

        assert len(transport.control_responses) == 1
        assert transport.control_responses[0]["subtype"] == "interrupt"
        await broker.stop()

    async def test_empty_content_ignored(
        self,
        broker: SessionBroker,
        transport: FakeTransport,
    ) -> None:
        ws = FakeWebSocket()
        await broker.add_browser(ws)

        await broker.handle_browser_message({"type": "user", "content": None})

        assert len(transport.user_messages) == 0
        await broker.stop()


class TestSessionBrokerOnCliEvent:
    async def test_assistant_result_flow(self, broker: SessionBroker) -> None:
        ws = FakeWebSocket()
        await broker.add_browser(ws)
        await asyncio.sleep(0.05)
        ws.sent.clear()

        # Simulate assistant turn.
        broker.on_cli_event({"type": "assistant", "message": {"model": "opus"}})
        broker.on_cli_event(
            {
                "type": "content_block_delta",
                "delta": {"text": "Hello "},
            }
        )
        broker.on_cli_event(
            {
                "type": "content_block_delta",
                "delta": {"text": "world"},
            }
        )
        broker.on_cli_event({"type": "result", "result": ""})
        await asyncio.sleep(0.1)

        history = broker.conversation_history()
        assert len(history["turns"]) == 1
        assert history["turns"][0]["content"] == "Hello world"
        assert history["turns"][0]["metadata"]["model"] == "opus"
        await broker.stop()

    async def test_result_fallback_text(self, broker: SessionBroker) -> None:
        ws = FakeWebSocket()
        await broker.add_browser(ws)
        await asyncio.sleep(0.05)

        broker.on_cli_event({"type": "assistant", "message": {}})
        broker.on_cli_event({"type": "result", "result": "fallback text"})
        await asyncio.sleep(0.05)

        history = broker.conversation_history()
        assert len(history["turns"]) == 1
        assert history["turns"][0]["content"] == "fallback text"
        await broker.stop()

    async def test_keep_alive_filtered(self, broker: SessionBroker) -> None:
        ws = FakeWebSocket()
        await broker.add_browser(ws)
        await asyncio.sleep(0.05)
        ws.sent.clear()

        result = broker.on_cli_event({"type": "keep_alive"})
        assert result is None
        await asyncio.sleep(0.05)
        assert len(ws.sent) == 0
        await broker.stop()

    async def test_system_init_broadcasts_commands(self, broker: SessionBroker) -> None:
        ws = FakeWebSocket()
        await broker.add_browser(ws)
        await asyncio.sleep(0.05)
        ws.sent.clear()

        broker.on_cli_event(
            {
                "type": "system",
                "subtype": "init",
                "slash_commands": ["/help"],
            }
        )
        await asyncio.sleep(0.05)

        # Should have both the system event broadcast and the available_commands broadcast
        messages = [json.loads(m) for m in ws.sent]
        cmd_msgs = [m for m in messages if m.get("type") == "available_commands"]
        assert len(cmd_msgs) >= 1
        assert cmd_msgs[0]["slash_commands"] == ["/help"]
        await broker.stop()


class TestSessionBrokerConversationHistory:
    async def test_empty_history(self, broker: SessionBroker) -> None:
        history = broker.conversation_history()
        assert history["turns"] == []
        assert history["is_active"] is False
        assert history["last_activity"] == ""

    async def test_history_replayed_for_late_joiner(self, broker: SessionBroker) -> None:
        ws1 = FakeWebSocket()
        await broker.add_browser(ws1)
        await broker.handle_browser_message({"type": "user", "content": "first message"})

        # Late joiner.
        history = broker.conversation_history()
        assert len(history["turns"]) == 1
        assert history["turns"][0]["content"] == "first message"
        await broker.stop()


class TestSessionBrokerInjectMessage:
    async def test_inject_message(
        self,
        broker: SessionBroker,
        transport: FakeTransport,
    ) -> None:
        await broker.inject_message("injected content")
        assert len(transport.user_messages) == 1
        assert transport.user_messages[0][0] == "injected content"
        history = broker.conversation_history()
        assert len(history["turns"]) == 1


class TestSessionBrokerStop:
    async def test_stop_closes_all_browsers(self, broker: SessionBroker) -> None:
        ws1 = FakeWebSocket()
        ws2 = FakeWebSocket()
        await broker.add_browser(ws1)
        await broker.add_browser(ws2)

        await broker.stop()

        assert ws1.closed
        assert ws2.closed
