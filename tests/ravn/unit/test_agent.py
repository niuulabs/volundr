"""Unit tests for the Ravn agent loop using MockLLM."""

from __future__ import annotations

from collections.abc import AsyncIterator

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
from tests.ravn.conftest import (
    AllowAllPermission,
    DenyAllPermission,
    EchoTool,
    FailingTool,
    InMemoryChannel,
    MockLLM,
    make_text_response,
)


def _make_agent(
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


# ---------------------------------------------------------------------------
# Normal (no-tool) flow
# ---------------------------------------------------------------------------


class TestNoToolFlow:
    async def test_single_response(self) -> None:
        llm = MockLLM([make_text_response("Hello!")])
        agent, _ = _make_agent(llm)

        result = await agent.run_turn("Hi")

        assert result.response == "Hello!"
        assert result.tool_calls == []
        assert result.tool_results == []

    async def test_usage_returned(self) -> None:
        llm = MockLLM([make_text_response("ok", input_tokens=10, output_tokens=5)])
        agent, _ = _make_agent(llm)

        result = await agent.run_turn("test")

        assert result.usage.input_tokens == 10
        assert result.usage.output_tokens == 5

    async def test_session_updated_after_turn(self) -> None:
        llm = MockLLM([make_text_response("response")])
        agent, _ = _make_agent(llm)

        await agent.run_turn("Hello")

        assert agent.session.turn_count == 1
        assert len(agent.session.messages) == 2
        assert agent.session.messages[0].role == "user"
        assert agent.session.messages[1].role == "assistant"

    async def test_channel_receives_thought_and_response_events(self) -> None:
        llm = MockLLM([make_text_response("Hi!")])
        agent, ch = _make_agent(llm)

        await agent.run_turn("Hello")

        assert RavnEventType.THOUGHT in ch.events[0].type or any(
            e.type == RavnEventType.THOUGHT for e in ch.events
        )
        assert any(e.type == RavnEventType.RESPONSE for e in ch.events)

    async def test_multi_turn_accumulates_usage(self) -> None:
        llm = MockLLM(
            [
                make_text_response("turn1", input_tokens=10, output_tokens=5),
                make_text_response("turn2", input_tokens=15, output_tokens=7),
            ]
        )
        agent, _ = _make_agent(llm)

        await agent.run_turn("first")
        await agent.run_turn("second")

        assert agent.session.turn_count == 2
        assert agent.session.total_usage.input_tokens == 25
        assert agent.session.total_usage.output_tokens == 12

    async def test_multi_turn_history_grows(self) -> None:
        llm = MockLLM(
            [
                make_text_response("answer1"),
                make_text_response("answer2"),
            ]
        )
        agent, _ = _make_agent(llm)

        await agent.run_turn("q1")
        await agent.run_turn("q2")

        # user + assistant × 2 turns = 4 messages
        assert len(agent.session.messages) == 4


# ---------------------------------------------------------------------------
# Tool-call loop
# ---------------------------------------------------------------------------


class TestToolCallLoop:
    async def test_tool_executed_and_result_fed_back(self) -> None:
        tool = EchoTool()
        tool_call = ToolCall(id="tc1", name="echo", input={"message": "ping"})

        call_count = 0

        class _CountingLLM(LLMPort):
            async def generate(self, messages, *, tools, system, model, max_tokens) -> LLMResponse:
                raise NotImplementedError

            async def stream(
                self, messages, *, tools, system, model, max_tokens
            ) -> AsyncIterator[StreamEvent]:
                nonlocal call_count
                call_count += 1
                if call_count == 1:
                    yield StreamEvent(type=StreamEventType.TOOL_CALL, tool_call=tool_call)
                    yield StreamEvent(
                        type=StreamEventType.MESSAGE_DONE,
                        usage=TokenUsage(input_tokens=5, output_tokens=2),
                    )
                else:
                    yield StreamEvent(type=StreamEventType.TEXT_DELTA, text="pong received")
                    yield StreamEvent(
                        type=StreamEventType.MESSAGE_DONE,
                        usage=TokenUsage(input_tokens=8, output_tokens=3),
                    )

        agent, ch = _make_agent(_CountingLLM(), tools=[tool])
        result = await agent.run_turn("echo ping")

        assert result.response == "pong received"
        assert len(result.tool_calls) == 1
        assert result.tool_calls[0].name == "echo"
        assert result.tool_results[0].content == "ping"

    async def test_tool_start_event_emitted(self) -> None:
        tool = EchoTool()
        tool_call = ToolCall(id="tc1", name="echo", input={"message": "hi"})
        call_count = 0

        class _LLM(LLMPort):
            async def generate(self, messages, *, tools, system, model, max_tokens) -> LLMResponse:
                raise NotImplementedError

            async def stream(
                self, messages, *, tools, system, model, max_tokens
            ) -> AsyncIterator[StreamEvent]:
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

        agent, ch = _make_agent(_LLM(), tools=[tool])
        await agent.run_turn("go")

        assert any(e.type == RavnEventType.TOOL_START for e in ch.events)
        assert any(e.type == RavnEventType.TOOL_RESULT for e in ch.events)

    async def test_unknown_tool_emits_error_result(self) -> None:
        tool_call = ToolCall(id="tc1", name="nonexistent", input={})
        call_count = 0

        class _LLM(LLMPort):
            async def generate(self, messages, *, tools, system, model, max_tokens) -> LLMResponse:
                raise NotImplementedError

            async def stream(
                self, messages, *, tools, system, model, max_tokens
            ) -> AsyncIterator[StreamEvent]:
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

        agent, ch = _make_agent(_LLM(), tools=[])
        await agent.run_turn("go")

        error_results = [e for e in ch.events if e.type == RavnEventType.TOOL_RESULT]
        assert any(e.metadata.get("is_error") for e in error_results)


# ---------------------------------------------------------------------------
# Budget exhaustion
# ---------------------------------------------------------------------------


class TestBudgetExhaustion:
    async def test_max_iterations_raises(self) -> None:
        tool = EchoTool()
        tool_call = ToolCall(id="tc1", name="echo", input={"message": "loop"})

        class _InfiniteLLM(LLMPort):
            async def generate(self, messages, *, tools, system, model, max_tokens) -> LLMResponse:
                raise NotImplementedError

            async def stream(
                self, messages, *, tools, system, model, max_tokens
            ) -> AsyncIterator[StreamEvent]:
                yield StreamEvent(type=StreamEventType.TOOL_CALL, tool_call=tool_call)
                yield StreamEvent(
                    type=StreamEventType.MESSAGE_DONE,
                    usage=TokenUsage(input_tokens=1, output_tokens=1),
                )

        agent, _ = _make_agent(_InfiniteLLM(), tools=[tool], max_iterations=3)

        with pytest.raises(MaxIterationsError) as exc_info:
            await agent.run_turn("go")

        assert exc_info.value.max_iterations == 3


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------


class TestErrorHandling:
    async def test_permission_denied_error_result(self) -> None:
        tool = EchoTool()
        tool_call = ToolCall(id="tc1", name="echo", input={"message": "hi"})
        call_count = 0

        class _LLM(LLMPort):
            async def generate(self, messages, *, tools, system, model, max_tokens) -> LLMResponse:
                raise NotImplementedError

            async def stream(
                self, messages, *, tools, system, model, max_tokens
            ) -> AsyncIterator[StreamEvent]:
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

        agent, ch = _make_agent(_LLM(), tools=[tool], permission=DenyAllPermission())
        await agent.run_turn("go")

        error_results = [e for e in ch.events if e.type == RavnEventType.TOOL_RESULT]
        assert any(e.metadata.get("is_error") for e in error_results)

    async def test_tool_exception_becomes_error_result(self) -> None:
        tool = FailingTool()
        tool_call = ToolCall(id="tc1", name="fail", input={})
        call_count = 0

        class _LLM(LLMPort):
            async def generate(self, messages, *, tools, system, model, max_tokens) -> LLMResponse:
                raise NotImplementedError

            async def stream(
                self, messages, *, tools, system, model, max_tokens
            ) -> AsyncIterator[StreamEvent]:
                nonlocal call_count
                call_count += 1
                if call_count == 1:
                    yield StreamEvent(type=StreamEventType.TOOL_CALL, tool_call=tool_call)
                    yield StreamEvent(
                        type=StreamEventType.MESSAGE_DONE,
                        usage=TokenUsage(input_tokens=5, output_tokens=2),
                    )
                else:
                    yield StreamEvent(type=StreamEventType.TEXT_DELTA, text="handled")
                    yield StreamEvent(
                        type=StreamEventType.MESSAGE_DONE,
                        usage=TokenUsage(input_tokens=5, output_tokens=2),
                    )

        agent, _ = _make_agent(_LLM(), tools=[tool])
        result = await agent.run_turn("go")

        assert len(result.tool_results) == 1
        assert result.tool_results[0].is_error is True
        assert "intentional failure" in result.tool_results[0].content

    async def test_tool_error_fed_back_to_llm(self) -> None:
        """Verify the agent loop continues after a tool error."""
        tool = FailingTool()
        tool_call = ToolCall(id="tc1", name="fail", input={})
        call_count = 0

        class _LLM(LLMPort):
            async def generate(self, messages, *, tools, system, model, max_tokens) -> LLMResponse:
                raise NotImplementedError

            async def stream(
                self, messages, *, tools, system, model, max_tokens
            ) -> AsyncIterator[StreamEvent]:
                nonlocal call_count
                call_count += 1
                if call_count == 1:
                    yield StreamEvent(type=StreamEventType.TOOL_CALL, tool_call=tool_call)
                    yield StreamEvent(
                        type=StreamEventType.MESSAGE_DONE,
                        usage=TokenUsage(input_tokens=5, output_tokens=2),
                    )
                else:
                    yield StreamEvent(type=StreamEventType.TEXT_DELTA, text="I handled the error")
                    yield StreamEvent(
                        type=StreamEventType.MESSAGE_DONE,
                        usage=TokenUsage(input_tokens=5, output_tokens=2),
                    )

        agent, _ = _make_agent(_LLM(), tools=[tool])
        result = await agent.run_turn("go")

        assert call_count == 2
        assert result.response == "I handled the error"


# ---------------------------------------------------------------------------
# Pre/post hooks
# ---------------------------------------------------------------------------


class TestHooks:
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

        class _LLM(LLMPort):
            async def generate(self, messages, *, tools, system, model, max_tokens) -> LLMResponse:
                raise NotImplementedError

            async def stream(
                self, messages, *, tools, system, model, max_tokens
            ) -> AsyncIterator[StreamEvent]:
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

        ch = InMemoryChannel()
        agent = RavnAgent(
            llm=_LLM(),
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


# ---------------------------------------------------------------------------
# _build_assistant_content helper
# ---------------------------------------------------------------------------


class TestBuildAssistantContent:
    def test_text_only(self) -> None:
        resp = LLMResponse(
            content="hello",
            tool_calls=[],
            stop_reason=StopReason.END_TURN,
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        )
        blocks = _build_assistant_content(resp)
        assert blocks == [{"type": "text", "text": "hello"}]

    def test_tool_calls_only(self) -> None:
        tc = ToolCall(id="x", name="search", input={"q": "hi"})
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

    def test_text_and_tool_calls(self) -> None:
        tc = ToolCall(id="y", name="run", input={})
        resp = LLMResponse(
            content="thinking...",
            tool_calls=[tc],
            stop_reason=StopReason.TOOL_USE,
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        )
        blocks = _build_assistant_content(resp)
        assert blocks[0]["type"] == "text"
        assert blocks[1]["type"] == "tool_use"

    def test_empty_response(self) -> None:
        resp = LLMResponse(
            content="",
            tool_calls=[],
            stop_reason=StopReason.END_TURN,
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        )
        blocks = _build_assistant_content(resp)
        assert blocks == []
