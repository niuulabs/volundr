"""Shared test fixtures for Bifröst tests."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable

import pytest

from volundr.bifrost.config import BifrostConfig, UpstreamAuthConfig, UpstreamConfig
from volundr.bifrost.models import SynapseEnvelope
from volundr.bifrost.ports import Synapse, UpstreamProvider
from volundr.bifrost.router import ModelRouter, RouteConfig
from volundr.bifrost.rules import DefaultRule, RuleEngine
from volundr.bifrost.upstream_registry import UpstreamRegistry


class MockUpstreamProvider(UpstreamProvider):
    """Returns configurable responses without making HTTP calls."""

    def __init__(
        self,
        *,
        status: int = 200,
        response_headers: dict[str, str] | None = None,
        response_body: bytes = b"{}",
        stream_chunks: list[bytes] | None = None,
        error: Exception | None = None,
    ) -> None:
        self.status = status
        self.response_headers = response_headers or {"content-type": "application/json"}
        self.response_body = response_body
        self.stream_chunks = stream_chunks or []
        self.error = error

        self.forward_calls: list[tuple[bytes, dict[str, str]]] = []
        self.stream_forward_calls: list[tuple[bytes, dict[str, str]]] = []
        self.closed = False

    async def forward(
        self,
        body: bytes,
        headers: dict[str, str],
    ) -> tuple[int, dict[str, str], bytes]:
        self.forward_calls.append((body, headers))
        if self.error:
            raise self.error
        return self.status, dict(self.response_headers), self.response_body

    async def stream_forward(
        self,
        body: bytes,
        headers: dict[str, str],
    ) -> tuple[int, dict[str, str], AsyncIterator[bytes]]:
        self.stream_forward_calls.append((body, headers))
        if self.error:
            raise self.error

        async def chunks() -> AsyncIterator[bytes]:
            for chunk in self.stream_chunks:
                yield chunk

        return self.status, dict(self.response_headers), chunks()

    async def close(self) -> None:
        self.closed = True


class MockSynapse(Synapse):
    """Records all published messages for assertions."""

    def __init__(self) -> None:
        self.published: list[tuple[str, SynapseEnvelope]] = []
        self.subscriptions: dict[str, list[Callable[[SynapseEnvelope], Awaitable[None]]]] = {}
        self.closed = False

    async def publish(self, topic: str, message: SynapseEnvelope) -> None:
        self.published.append((topic, message))
        for handler in self.subscriptions.get(topic, []):
            await handler(message)

    async def subscribe(
        self,
        topic: str,
        handler: Callable[[SynapseEnvelope], Awaitable[None]],
    ) -> None:
        self.subscriptions.setdefault(topic, []).append(handler)

    async def close(self) -> None:
        self.closed = True


@pytest.fixture
def mock_upstream() -> MockUpstreamProvider:
    return MockUpstreamProvider()


@pytest.fixture
def mock_synapse() -> MockSynapse:
    return MockSynapse()


@pytest.fixture
def bifrost_config() -> BifrostConfig:
    return BifrostConfig(
        upstream=UpstreamConfig(
            url="https://api.anthropic.com",
            auth=UpstreamAuthConfig(mode="passthrough"),
        ),
    )


@pytest.fixture
def default_registry(mock_upstream: MockUpstreamProvider) -> UpstreamRegistry:
    return UpstreamRegistry({"default": mock_upstream})


@pytest.fixture
def default_rule_engine() -> RuleEngine:
    return RuleEngine([DefaultRule()])


@pytest.fixture
def default_router() -> ModelRouter:
    return ModelRouter({"default": RouteConfig()})


def make_non_streaming_response(
    *,
    model: str = "claude-sonnet-4-5-20250929",
    input_tokens: int = 100,
    output_tokens: int = 50,
    stop_reason: str = "end_turn",
) -> bytes:
    """Build a realistic non-streaming Anthropic response body."""
    import json

    return json.dumps(
        {
            "id": "msg_test123",
            "type": "message",
            "role": "assistant",
            "model": model,
            "content": [{"type": "text", "text": "Hello!"}],
            "stop_reason": stop_reason,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
            },
        }
    ).encode()


def make_streaming_chunks(
    *,
    model: str = "claude-sonnet-4-5-20250929",
    input_tokens: int = 100,
    output_tokens: int = 50,
    stop_reason: str = "end_turn",
) -> list[bytes]:
    """Build realistic Anthropic SSE stream chunks."""
    import json

    def _sse(event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data)}\n\n"

    msg_start = {
        "type": "message_start",
        "message": {
            "id": "msg_test123",
            "type": "message",
            "role": "assistant",
            "model": model,
            "usage": {"input_tokens": input_tokens, "output_tokens": 0},
        },
    }
    events = [
        _sse("message_start", msg_start),
        _sse(
            "content_block_start",
            {
                "type": "content_block_start",
                "index": 0,
                "content_block": {"type": "text", "text": ""},
            },
        ),
        _sse(
            "content_block_delta",
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "text_delta", "text": "Hello"},
            },
        ),
        _sse(
            "content_block_delta",
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "text_delta", "text": "!"},
            },
        ),
        _sse(
            "content_block_stop",
            {
                "type": "content_block_stop",
                "index": 0,
            },
        ),
        _sse(
            "message_delta",
            {
                "type": "message_delta",
                "delta": {"stop_reason": stop_reason},
                "usage": {"output_tokens": output_tokens},
            },
        ),
        _sse("message_stop", {"type": "message_stop"}),
    ]
    return [e.encode() for e in events]
