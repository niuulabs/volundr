"""Unit tests for Ravn domain models."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

import pytest

from ravn.domain.models import (
    LLMResponse,
    Message,
    Session,
    StopReason,
    StreamEvent,
    StreamEventType,
    TokenUsage,
    ToolCall,
    ToolResult,
    TurnResult,
)


class TestTokenUsage:
    def test_total_tokens(self) -> None:
        u = TokenUsage(input_tokens=10, output_tokens=5)
        assert u.total_tokens == 15

    def test_add_accumulates_all_fields(self) -> None:
        a = TokenUsage(input_tokens=10, output_tokens=5, cache_read_tokens=2, cache_write_tokens=1)
        b = TokenUsage(input_tokens=20, output_tokens=10, cache_read_tokens=3, cache_write_tokens=4)
        result = a + b
        assert result.input_tokens == 30
        assert result.output_tokens == 15
        assert result.cache_read_tokens == 5
        assert result.cache_write_tokens == 5

    def test_add_identity(self) -> None:
        u = TokenUsage(input_tokens=5, output_tokens=3)
        zero = TokenUsage(input_tokens=0, output_tokens=0)
        assert (u + zero).total_tokens == u.total_tokens

    def test_defaults_to_zero_cache_tokens(self) -> None:
        u = TokenUsage(input_tokens=1, output_tokens=1)
        assert u.cache_read_tokens == 0
        assert u.cache_write_tokens == 0

    def test_is_frozen(self) -> None:
        u = TokenUsage(input_tokens=1, output_tokens=1)
        with pytest.raises(Exception):
            u.input_tokens = 99  # type: ignore[misc]


class TestToolCall:
    def test_fields_preserved(self) -> None:
        tc = ToolCall(id="abc", name="search", input={"query": "hello"})
        assert tc.id == "abc"
        assert tc.name == "search"
        assert tc.input == {"query": "hello"}

    def test_is_frozen(self) -> None:
        tc = ToolCall(id="x", name="echo", input={})
        with pytest.raises(Exception):
            tc.name = "other"  # type: ignore[misc]

    def test_empty_input_allowed(self) -> None:
        tc = ToolCall(id="1", name="no_args", input={})
        assert tc.input == {}


class TestToolResult:
    def test_default_not_error(self) -> None:
        r = ToolResult(tool_call_id="id1", content="ok")
        assert r.is_error is False

    def test_error_flag(self) -> None:
        r = ToolResult(tool_call_id="id1", content="boom", is_error=True)
        assert r.is_error is True

    def test_content_preserved(self) -> None:
        r = ToolResult(tool_call_id="id1", content="result text")
        assert r.content == "result text"


class TestMessage:
    def test_string_content(self) -> None:
        m = Message(role="user", content="Hello")
        assert m.role == "user"
        assert m.content == "Hello"

    def test_list_content(self) -> None:
        blocks = [{"type": "text", "text": "hi"}, {"type": "tool_use", "id": "x"}]
        m = Message(role="assistant", content=blocks)
        assert m.content == blocks

    def test_is_frozen(self) -> None:
        m = Message(role="user", content="Hi")
        with pytest.raises(Exception):
            m.content = "Other"  # type: ignore[misc]


class TestLLMResponse:
    def test_text_only_response(self) -> None:
        r = LLMResponse(
            content="Hello!",
            tool_calls=[],
            stop_reason=StopReason.END_TURN,
            usage=TokenUsage(input_tokens=5, output_tokens=3),
        )
        assert r.content == "Hello!"
        assert r.stop_reason == StopReason.END_TURN
        assert r.tool_calls == []

    def test_with_tool_calls(self) -> None:
        tc = ToolCall(id="1", name="search", input={"q": "x"})
        r = LLMResponse(
            content="",
            tool_calls=[tc],
            stop_reason=StopReason.TOOL_USE,
            usage=TokenUsage(input_tokens=5, output_tokens=3),
        )
        assert len(r.tool_calls) == 1
        assert r.stop_reason == StopReason.TOOL_USE


class TestStreamEvent:
    def test_text_delta(self) -> None:
        ev = StreamEvent(type=StreamEventType.TEXT_DELTA, text="chunk")
        assert ev.text == "chunk"
        assert ev.tool_call is None
        assert ev.usage is None

    def test_tool_call_event(self) -> None:
        tc = ToolCall(id="1", name="echo", input={})
        ev = StreamEvent(type=StreamEventType.TOOL_CALL, tool_call=tc)
        assert ev.tool_call is tc

    def test_message_done_with_usage(self) -> None:
        u = TokenUsage(input_tokens=5, output_tokens=3)
        ev = StreamEvent(type=StreamEventType.MESSAGE_DONE, usage=u)
        assert ev.usage is u


class TestTurnResult:
    def test_all_fields(self) -> None:
        tr = TurnResult(
            response="Done",
            tool_calls=[],
            tool_results=[],
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        )
        assert tr.response == "Done"
        assert tr.usage.total_tokens == 2


class TestSession:
    def test_initial_state(self) -> None:
        s = Session()
        assert isinstance(s.id, UUID)
        assert s.messages == []
        assert s.turn_count == 0
        assert s.total_usage.total_tokens == 0
        assert isinstance(s.created_at, datetime)
        assert s.created_at.tzinfo is UTC

    def test_add_message_appends(self) -> None:
        s = Session()
        s.add_message(Message(role="user", content="first"))
        s.add_message(Message(role="assistant", content="second"))
        assert len(s.messages) == 2
        assert s.messages[0].role == "user"
        assert s.messages[1].role == "assistant"

    def test_message_ordering_preserved(self) -> None:
        s = Session()
        for i in range(5):
            s.add_message(Message(role="user", content=str(i)))
        assert [m.content for m in s.messages] == ["0", "1", "2", "3", "4"]

    def test_record_turn_increments_count(self) -> None:
        s = Session()
        s.record_turn(TokenUsage(input_tokens=10, output_tokens=5))
        assert s.turn_count == 1
        s.record_turn(TokenUsage(input_tokens=20, output_tokens=8))
        assert s.turn_count == 2

    def test_record_turn_accumulates_usage(self) -> None:
        s = Session()
        s.record_turn(TokenUsage(input_tokens=10, output_tokens=5))
        s.record_turn(TokenUsage(input_tokens=20, output_tokens=8))
        assert s.total_usage.input_tokens == 30
        assert s.total_usage.output_tokens == 13

    def test_append_only_messages(self) -> None:
        """Messages can only be appended; removing is not part of the API."""
        s = Session()
        m = Message(role="user", content="hello")
        s.add_message(m)
        assert s.messages[0] is m
        # The only mutation supported is appending
        assert len(s.messages) == 1

    def test_current_turn_messages(self) -> None:
        """Messages added after the last record_turn belong to the current turn."""
        s = Session()
        s.add_message(Message(role="user", content="turn1-user"))
        s.add_message(Message(role="assistant", content="turn1-asst"))
        turn1_count = len(s.messages)
        s.record_turn(TokenUsage(input_tokens=5, output_tokens=2))

        s.add_message(Message(role="user", content="turn2-user"))
        current = s.messages[turn1_count:]
        assert len(current) == 1
        assert current[0].content == "turn2-user"
