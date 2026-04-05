"""Tests for the Ravn agent loop."""

from __future__ import annotations

from collections.abc import AsyncIterator
from unittest.mock import AsyncMock

import pytest

from ravn.agent import RavnAgent, _build_assistant_content
from ravn.domain.events import RavnEventType
from ravn.domain.exceptions import MaxIterationsError
from ravn.domain.models import (
    LLMResponse,
    StopReason,
    StreamEvent,
    StreamEventType,
    TokenUsage,
    ToolCall,
    ToolResult,
)
from ravn.ports.llm import LLMPort
from tests.test_ravn.conftest import (
    AllowAllPermission,
    DenyAllPermission,
    EchoTool,
    FailingTool,
    InMemoryChannel,
    make_simple_llm,
)


def make_agent(
    llm: LLMPort,
    tools=None,
    *,
    channel: InMemoryChannel | None = None,
    permission=None,
    max_iterations: int = 10,
) -> tuple[RavnAgent, InMemoryChannel]:
    ch = channel or InMemoryChannel()
    perm = permission or AllowAllPermission()
    agent = RavnAgent(
        llm=llm,
        tools=tools or [],
        channel=ch,
        permission=perm,
        system_prompt="You are a test assistant.",
        model="claude-sonnet-4-6",
        max_tokens=1024,
        max_iterations=max_iterations,
    )
    return agent, ch


class TestRavnAgentSimpleTurn:
    async def test_simple_response(self) -> None:
        llm = make_simple_llm("Hello, world!")
        agent, channel = make_agent(llm)

        result = await agent.run_turn("Hi")

        assert result.response == "Hello, world!"
        assert result.tool_calls == []
        assert result.tool_results == []
        assert result.usage.input_tokens == 10
        assert result.usage.output_tokens == 5

    async def test_session_updated(self) -> None:
        llm = make_simple_llm("response")
        agent, _ = make_agent(llm)

        await agent.run_turn("Hello")

        assert agent.session.turn_count == 1
        assert len(agent.session.messages) == 2
        assert agent.session.messages[0].role == "user"
        assert agent.session.messages[1].role == "assistant"

    async def test_channel_receives_thought_and_response(self) -> None:
        llm = make_simple_llm("Hi!")
        agent, channel = make_agent(llm)

        await agent.run_turn("Hey")

        event_types = [e.type for e in channel.events]
        assert RavnEventType.THOUGHT in event_types
        assert RavnEventType.RESPONSE in event_types

    async def test_cumulative_usage_tracked(self) -> None:
        llm = make_simple_llm("ok")
        agent, _ = make_agent(llm)

        await agent.run_turn("turn 1")
        await agent.run_turn("turn 2")

        assert agent.session.turn_count == 2
        assert agent.session.total_usage.input_tokens == 20


class TestRavnAgentToolUse:
    async def test_tool_executed_and_result_fed_back(self) -> None:
        """LLM requests tool_use → tool runs → second call returns final text."""
        tool = EchoTool()
        tool_call = ToolCall(id="tc1", name="echo", input={"message": "ping"})

        call_count = 0

        async def _stream(*args, **kwargs) -> AsyncIterator[StreamEvent]:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # First call: return tool_use
                yield StreamEvent(type=StreamEventType.TOOL_CALL, tool_call=tool_call)
                yield StreamEvent(
                    type=StreamEventType.MESSAGE_DONE,
                    usage=TokenUsage(input_tokens=5, output_tokens=2),
                )
            else:
                # Second call: return final answer
                yield StreamEvent(type=StreamEventType.TEXT_DELTA, text="pong received")
                yield StreamEvent(
                    type=StreamEventType.MESSAGE_DONE,
                    usage=TokenUsage(input_tokens=8, output_tokens=3),
                )

        llm = AsyncMock(spec=LLMPort)
        llm.stream = _stream

        agent, channel = make_agent(llm, tools=[tool])
        result = await agent.run_turn("echo ping")

        assert result.response == "pong received"
        assert len(result.tool_calls) == 1
        assert result.tool_calls[0].name == "echo"
        assert len(result.tool_results) == 1
        assert result.tool_results[0].content == "ping"

    async def test_tool_start_event_emitted(self) -> None:
        tool = EchoTool()
        tool_call = ToolCall(id="tc1", name="echo", input={"message": "hi"})

        call_count = 0

        async def _stream(*args, **kwargs) -> AsyncIterator[StreamEvent]:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                yield StreamEvent(type=StreamEventType.TOOL_CALL, tool_call=tool_call)
                yield StreamEvent(
                    type=StreamEventType.MESSAGE_DONE,
                    usage=TokenUsage(input_tokens=5, output_tokens=2),
                )
            else:
                yield StreamEvent(type=StreamEventType.TEXT_DELTA, text="done")
                yield StreamEvent(
                    type=StreamEventType.MESSAGE_DONE,
                    usage=TokenUsage(input_tokens=5, output_tokens=2),
                )

        llm = AsyncMock(spec=LLMPort)
        llm.stream = _stream
        agent, channel = make_agent(llm, tools=[tool])
        await agent.run_turn("go")

        event_types = [e.type for e in channel.events]
        assert RavnEventType.TOOL_START in event_types
        assert RavnEventType.TOOL_RESULT in event_types

    async def test_unknown_tool_returns_error(self) -> None:
        tool_call = ToolCall(id="tc1", name="nonexistent", input={})

        async def _stream(*args, **kwargs) -> AsyncIterator[StreamEvent]:
            yield StreamEvent(type=StreamEventType.TOOL_CALL, tool_call=tool_call)
            yield StreamEvent(
                type=StreamEventType.MESSAGE_DONE,
                usage=TokenUsage(input_tokens=5, output_tokens=2),
            )
            # Need a second pass to end:

        call_count = 0

        async def _stream2(*args, **kwargs) -> AsyncIterator[StreamEvent]:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                yield StreamEvent(type=StreamEventType.TOOL_CALL, tool_call=tool_call)
                yield StreamEvent(
                    type=StreamEventType.MESSAGE_DONE,
                    usage=TokenUsage(input_tokens=5, output_tokens=2),
                )
            else:
                yield StreamEvent(type=StreamEventType.TEXT_DELTA, text="ok")
                yield StreamEvent(
                    type=StreamEventType.MESSAGE_DONE,
                    usage=TokenUsage(input_tokens=5, output_tokens=2),
                )

        llm = AsyncMock(spec=LLMPort)
        llm.stream = _stream2
        agent, channel = make_agent(llm, tools=[])
        await agent.run_turn("go")

        error_events = [e for e in channel.events if e.type == RavnEventType.TOOL_RESULT]
        assert any(e.metadata.get("is_error") for e in error_events)

    async def test_permission_denied_returns_error(self) -> None:
        tool = EchoTool()
        tool_call = ToolCall(id="tc1", name="echo", input={"message": "hi"})

        call_count = 0

        async def _stream(*args, **kwargs) -> AsyncIterator[StreamEvent]:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                yield StreamEvent(type=StreamEventType.TOOL_CALL, tool_call=tool_call)
                yield StreamEvent(
                    type=StreamEventType.MESSAGE_DONE,
                    usage=TokenUsage(input_tokens=5, output_tokens=2),
                )
            else:
                yield StreamEvent(type=StreamEventType.TEXT_DELTA, text="denied handled")
                yield StreamEvent(
                    type=StreamEventType.MESSAGE_DONE,
                    usage=TokenUsage(input_tokens=5, output_tokens=2),
                )

        llm = AsyncMock(spec=LLMPort)
        llm.stream = _stream
        agent, channel = make_agent(llm, tools=[tool], permission=DenyAllPermission())
        await agent.run_turn("go")

        tool_result_events = [e for e in channel.events if e.type == RavnEventType.TOOL_RESULT]
        assert any(e.metadata.get("is_error") for e in tool_result_events)

    async def test_tool_exception_returns_error_result(self) -> None:
        tool = FailingTool()
        tool_call = ToolCall(id="tc1", name="fail", input={})

        call_count = 0

        async def _stream(*args, **kwargs) -> AsyncIterator[StreamEvent]:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                yield StreamEvent(type=StreamEventType.TOOL_CALL, tool_call=tool_call)
                yield StreamEvent(
                    type=StreamEventType.MESSAGE_DONE,
                    usage=TokenUsage(input_tokens=5, output_tokens=2),
                )
            else:
                yield StreamEvent(type=StreamEventType.TEXT_DELTA, text="handled error")
                yield StreamEvent(
                    type=StreamEventType.MESSAGE_DONE,
                    usage=TokenUsage(input_tokens=5, output_tokens=2),
                )

        llm = AsyncMock(spec=LLMPort)
        llm.stream = _stream
        agent, channel = make_agent(llm, tools=[tool])
        result = await agent.run_turn("go")

        assert len(result.tool_results) == 1
        assert result.tool_results[0].is_error is True
        assert "intentional failure" in result.tool_results[0].content

    async def test_max_iterations_raises(self) -> None:
        """Agent that always returns tool_use should hit the iteration limit."""
        tool = EchoTool()
        tool_call = ToolCall(id="tc1", name="echo", input={"message": "loop"})

        async def _stream(*args, **kwargs) -> AsyncIterator[StreamEvent]:
            yield StreamEvent(type=StreamEventType.TOOL_CALL, tool_call=tool_call)
            yield StreamEvent(
                type=StreamEventType.MESSAGE_DONE,
                usage=TokenUsage(input_tokens=1, output_tokens=1),
            )

        llm = AsyncMock(spec=LLMPort)
        llm.stream = _stream

        agent, _ = make_agent(llm, tools=[tool], max_iterations=3)

        with pytest.raises(MaxIterationsError) as exc_info:
            await agent.run_turn("go")

        assert exc_info.value.max_iterations == 3


class TestRavnAgentHooks:
    async def test_pre_and_post_hooks_called(self) -> None:
        tool = EchoTool()
        tool_call = ToolCall(id="tc1", name="echo", input={"message": "test"})
        pre_calls: list[ToolCall] = []
        post_calls: list[tuple[ToolCall, ToolResult]] = []

        async def pre_hook(tc: ToolCall) -> None:
            pre_calls.append(tc)

        async def post_hook(tc: ToolCall, tr: ToolResult) -> None:
            post_calls.append((tc, tr))

        call_count = 0

        async def _stream(*args, **kwargs) -> AsyncIterator[StreamEvent]:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                yield StreamEvent(type=StreamEventType.TOOL_CALL, tool_call=tool_call)
                yield StreamEvent(
                    type=StreamEventType.MESSAGE_DONE,
                    usage=TokenUsage(input_tokens=5, output_tokens=2),
                )
            else:
                yield StreamEvent(type=StreamEventType.TEXT_DELTA, text="done")
                yield StreamEvent(
                    type=StreamEventType.MESSAGE_DONE,
                    usage=TokenUsage(input_tokens=5, output_tokens=2),
                )

        llm = AsyncMock(spec=LLMPort)
        llm.stream = _stream
        ch = InMemoryChannel()
        agent = RavnAgent(
            llm=llm,
            tools=[tool],
            channel=ch,
            permission=AllowAllPermission(),
            system_prompt="",
            model="claude-sonnet-4-6",
            max_tokens=1024,
            max_iterations=10,
            pre_tool_hooks=[pre_hook],
            post_tool_hooks=[post_hook],
        )
        await agent.run_turn("go")

        assert len(pre_calls) == 1
        assert len(post_calls) == 1
        assert pre_calls[0].name == "echo"
        assert post_calls[0][1].content == "test"


class TestBuildAssistantContent:
    def test_text_only(self) -> None:
        resp = LLMResponse(
            content="hello",
            tool_calls=[],
            stop_reason=StopReason.END_TURN,
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        )
        blocks = _build_assistant_content(resp)
        assert len(blocks) == 1
        assert blocks[0] == {"type": "text", "text": "hello"}

    def test_tool_calls_only(self) -> None:
        tc = ToolCall(id="x", name="echo", input={"msg": "hi"})
        resp = LLMResponse(
            content="",
            tool_calls=[tc],
            stop_reason=StopReason.TOOL_USE,
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        )
        blocks = _build_assistant_content(resp)
        assert len(blocks) == 1
        assert blocks[0]["type"] == "tool_use"
        assert blocks[0]["id"] == "x"
        assert blocks[0]["name"] == "echo"

    def test_text_and_tool_calls(self) -> None:
        tc = ToolCall(id="y", name="run", input={})
        resp = LLMResponse(
            content="thinking...",
            tool_calls=[tc],
            stop_reason=StopReason.TOOL_USE,
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        )
        blocks = _build_assistant_content(resp)
        assert len(blocks) == 2
        assert blocks[0]["type"] == "text"
        assert blocks[1]["type"] == "tool_use"
