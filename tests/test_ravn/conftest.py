"""Shared fixtures for Ravn tests."""

from __future__ import annotations

from collections.abc import AsyncIterator
from unittest.mock import AsyncMock

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


class InMemoryChannel(ChannelPort):
    """Records all emitted events for assertion in tests."""

    def __init__(self) -> None:
        self.events: list[RavnEvent] = []

    async def emit(self, event: RavnEvent) -> None:
        self.events.append(event)


class AllowAllPermission(PermissionPort):
    async def check(self, permission: str) -> bool:
        return True


class DenyAllPermission(PermissionPort):
    async def check(self, permission: str) -> bool:
        return False


class EchoTool(ToolPort):
    """A test tool that echoes its input back."""

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
    """A test tool that always raises an exception."""

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


def make_simple_llm(response_text: str = "Hello!") -> LLMPort:
    """Build a mock LLM that returns a simple text response."""

    async def _stream(*args, **kwargs) -> AsyncIterator[StreamEvent]:
        yield StreamEvent(type=StreamEventType.TEXT_DELTA, text=response_text)
        yield StreamEvent(
            type=StreamEventType.MESSAGE_DONE,
            usage=TokenUsage(input_tokens=10, output_tokens=5),
        )

    llm = AsyncMock(spec=LLMPort)
    llm.stream = _stream
    llm.generate = AsyncMock(
        return_value=LLMResponse(
            content=response_text,
            tool_calls=[],
            stop_reason=StopReason.END_TURN,
            usage=TokenUsage(input_tokens=10, output_tokens=5),
        )
    )
    return llm


@pytest.fixture
def channel() -> InMemoryChannel:
    return InMemoryChannel()


@pytest.fixture
def allow_permission() -> AllowAllPermission:
    return AllowAllPermission()


@pytest.fixture
def deny_permission() -> DenyAllPermission:
    return DenyAllPermission()


@pytest.fixture
def echo_tool() -> EchoTool:
    return EchoTool()
