"""Tests for the CliChannel adapter."""

from __future__ import annotations

import io

from ravn.adapters.cli_channel import CliChannel, _format_input
from ravn.domain.events import RavnEvent


def make_channel() -> tuple[CliChannel, io.StringIO]:
    buf = io.StringIO()
    return CliChannel(file=buf), buf


class TestCliChannel:
    async def test_thought_emitted_inline(self) -> None:
        ch, buf = make_channel()
        await ch.emit(RavnEvent.thought("hello "))
        await ch.emit(RavnEvent.thought("world"))
        output = buf.getvalue()
        assert "hello world" in output

    async def test_response_adds_newline(self) -> None:
        ch, buf = make_channel()
        await ch.emit(RavnEvent.thought("text"))
        await ch.emit(RavnEvent.response("text"))
        output = buf.getvalue()
        assert output.endswith("\n")

    async def test_tool_start_printed(self) -> None:
        ch, buf = make_channel()
        await ch.emit(RavnEvent.tool_start("echo", {"message": "hi"}))
        output = buf.getvalue()
        assert "echo" in output

    async def test_tool_result_success(self) -> None:
        ch, buf = make_channel()
        await ch.emit(RavnEvent.tool_result("echo", "pong"))
        output = buf.getvalue()
        assert "✓" in output
        assert "pong" in output

    async def test_tool_result_error(self) -> None:
        ch, buf = make_channel()
        await ch.emit(RavnEvent.tool_result("fail", "boom", is_error=True))
        output = buf.getvalue()
        assert "✗" in output

    async def test_error_event(self) -> None:
        ch, buf = make_channel()
        await ch.emit(RavnEvent.error("bad thing"))
        output = buf.getvalue()
        assert "bad thing" in output
        assert "error" in output

    async def test_long_tool_result_truncated(self) -> None:
        ch, buf = make_channel()
        long_content = "x" * 600
        await ch.emit(RavnEvent.tool_result("tool", long_content))
        output = buf.getvalue()
        assert "…" in output
        assert len(output) < 600

    def test_finish_adds_newline_if_in_response(self) -> None:
        ch, buf = make_channel()
        # Simulate a streaming response that hasn't ended yet.
        ch._in_response = True
        ch.finish()
        assert buf.getvalue() == "\n"

    def test_finish_noop_if_not_in_response(self) -> None:
        ch, buf = make_channel()
        ch.finish()
        assert buf.getvalue() == ""

    async def test_tool_start_after_thought_adds_newline(self) -> None:
        ch, buf = make_channel()
        await ch.emit(RavnEvent.thought("thinking"))
        await ch.emit(RavnEvent.tool_start("echo", {}))
        output = buf.getvalue()
        assert "thinking" in output
        assert "echo" in output


class TestFormatInput:
    def test_empty(self) -> None:
        assert _format_input({}) == ""

    def test_simple(self) -> None:
        result = _format_input({"key": "value"})
        assert "key=" in result
        assert "value" in result

    def test_long_value_truncated(self) -> None:
        result = _format_input({"k": "v" * 100})
        assert "…" in result

    def test_multiple_keys(self) -> None:
        result = _format_input({"a": "1", "b": "2"})
        assert "a=" in result
        assert "b=" in result
        assert ", " in result
