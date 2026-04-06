"""Shared fixtures for Ravn tests."""

from __future__ import annotations

from collections.abc import AsyncIterator
from unittest.mock import AsyncMock

import pytest

from ravn.adapters.permission.allow_deny import AllowAllPermission, DenyAllPermission
from ravn.domain.models import (
    LLMResponse,
    StopReason,
    StreamEvent,
    StreamEventType,
    TokenUsage,
)
from ravn.ports.llm import LLMPort
from tests.ravn.fixtures.fakes import EchoTool, FailingTool, InMemoryChannel

# Re-export so existing test imports that used `from tests.test_ravn.conftest import X`
# continue to work without modification.
__all__ = [
    "AllowAllPermission",
    "DenyAllPermission",
    "EchoTool",
    "FailingTool",
    "InMemoryChannel",
    "make_simple_llm",
]


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
