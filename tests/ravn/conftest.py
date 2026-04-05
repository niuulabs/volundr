"""Shared fixtures for the tests/ravn test suite."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest

from ravn.domain.events import RavnEvent
from ravn.domain.models import (
    LLMResponse,
    StopReason,
    StreamEvent,
    StreamEventType,
    TokenUsage,
    ToolResult,
)
from ravn.ports.channel import ChannelPort
from ravn.ports.llm import LLMPort
from ravn.ports.permission import PermissionPort
from ravn.ports.tool import ToolPort

# ---------------------------------------------------------------------------
# MockLLM — scripted, deterministic LLM for testing
# ---------------------------------------------------------------------------


class MockLLM(LLMPort):
    """Scripted LLM that replays a fixed list of responses deterministically.

    Each call to ``generate`` or ``stream`` consumes the next response from the
    list.  When the list is exhausted, ``StopIteration`` is raised so tests
    fail clearly rather than silently repeating the last response.
    """

    def __init__(self, responses: list[LLMResponse]) -> None:
        self._responses = iter(responses)

    async def generate(
        self,
        messages: list[dict],
        *,
        tools: list[dict],
        system: str,
        model: str,
        max_tokens: int,
    ) -> LLMResponse:
        return next(self._responses)

    async def stream(
        self,
        messages: list[dict],
        *,
        tools: list[dict],
        system: str,
        model: str,
        max_tokens: int,
    ) -> AsyncIterator[StreamEvent]:
        response = next(self._responses)

        if response.content:
            yield StreamEvent(type=StreamEventType.TEXT_DELTA, text=response.content)

        for tool_call in response.tool_calls:
            yield StreamEvent(type=StreamEventType.TOOL_CALL, tool_call=tool_call)

        yield StreamEvent(type=StreamEventType.MESSAGE_DONE, usage=response.usage)


# ---------------------------------------------------------------------------
# InMemoryChannel — records all emitted events for assertion
# ---------------------------------------------------------------------------


class InMemoryChannel(ChannelPort):
    """Records every event emitted by the agent for inspection in tests."""

    def __init__(self) -> None:
        self.events: list[RavnEvent] = []

    async def emit(self, event: RavnEvent) -> None:
        self.events.append(event)

    def event_types(self) -> list[str]:
        return [str(e.type) for e in self.events]


# ---------------------------------------------------------------------------
# Test tool implementations
# ---------------------------------------------------------------------------


class EchoTool(ToolPort):
    """Returns the ``message`` input as its result."""

    @property
    def name(self) -> str:
        return "echo"

    @property
    def description(self) -> str:
        return "Echoes the message back."

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {"message": {"type": "string"}},
            "required": ["message"],
        }

    @property
    def required_permission(self) -> str:
        return "tool:echo"

    async def execute(self, input: dict) -> ToolResult:
        return ToolResult(tool_call_id="", content=input.get("message", ""))


class FailingTool(ToolPort):
    """Always raises a RuntimeError when executed."""

    @property
    def name(self) -> str:
        return "fail"

    @property
    def description(self) -> str:
        return "Always fails."

    @property
    def input_schema(self) -> dict:
        return {"type": "object", "properties": {}}

    @property
    def required_permission(self) -> str:
        return "tool:fail"

    async def execute(self, input: dict) -> ToolResult:
        raise RuntimeError("intentional failure")


# ---------------------------------------------------------------------------
# Permission implementations
# ---------------------------------------------------------------------------


class AllowAllPermission(PermissionPort):
    async def check(self, permission: str) -> bool:
        return True


class DenyAllPermission(PermissionPort):
    async def check(self, permission: str) -> bool:
        return False


# ---------------------------------------------------------------------------
# Pytest fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_channel() -> InMemoryChannel:
    return InMemoryChannel()


@pytest.fixture
def mock_permission_enforcer() -> AllowAllPermission:
    return AllowAllPermission()


@pytest.fixture
def deny_permission() -> DenyAllPermission:
    return DenyAllPermission()


@pytest.fixture
def echo_tool() -> EchoTool:
    return EchoTool()


@pytest.fixture
def failing_tool() -> FailingTool:
    return FailingTool()


def make_text_response(
    text: str = "Hello!",
    *,
    input_tokens: int = 10,
    output_tokens: int = 5,
) -> LLMResponse:
    """Build a simple text-only LLMResponse for scripting the MockLLM."""
    return LLMResponse(
        content=text,
        tool_calls=[],
        stop_reason=StopReason.END_TURN,
        usage=TokenUsage(input_tokens=input_tokens, output_tokens=output_tokens),
    )


@pytest.fixture
def mock_llm() -> MockLLM:
    """A MockLLM pre-loaded with a single text response."""
    return MockLLM([make_text_response("Hello!")])
