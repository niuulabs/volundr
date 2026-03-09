"""Tests for the Anthropic direct upstream adapter."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from volundr.bifrost.adapters.upstream_anthropic import AnthropicDirectAdapter
from volundr.bifrost.config import UpstreamAuthConfig, UpstreamConfig


@pytest.fixture
def passthrough_config() -> UpstreamConfig:
    return UpstreamConfig(
        url="https://api.anthropic.com",
        auth=UpstreamAuthConfig(mode="passthrough"),
    )


@pytest.fixture
def apikey_config() -> UpstreamConfig:
    return UpstreamConfig(
        url="https://api.anthropic.com",
        auth=UpstreamAuthConfig(mode="api_key", key="sk-test-key-123"),
    )


class TestHeaderFiltering:
    async def test_forwards_anthropic_headers(self, passthrough_config: UpstreamConfig):
        adapter = AnthropicDirectAdapter(passthrough_config)
        try:
            headers = adapter._build_upstream_headers(
                {
                    "content-type": "application/json",
                    "anthropic-version": "2023-06-01",
                    "anthropic-beta": "tools-2024-04-04",
                    "accept": "application/json",
                    "host": "localhost:8200",
                    "connection": "keep-alive",
                }
            )

            assert headers["content-type"] == "application/json"
            assert headers["anthropic-version"] == "2023-06-01"
            assert headers["anthropic-beta"] == "tools-2024-04-04"
            assert "host" not in headers
            assert "connection" not in headers
        finally:
            await adapter.close()

    async def test_passthrough_forwards_auth_headers(self, passthrough_config: UpstreamConfig):
        adapter = AnthropicDirectAdapter(passthrough_config)
        try:
            headers = adapter._build_upstream_headers(
                {
                    "x-api-key": "sk-client-key",
                    "authorization": "Bearer token123",
                    "content-type": "application/json",
                }
            )

            assert headers["x-api-key"] == "sk-client-key"
            assert headers["authorization"] == "Bearer token123"
        finally:
            await adapter.close()

    async def test_apikey_mode_injects_key_and_strips_client_auth(
        self, apikey_config: UpstreamConfig
    ):
        adapter = AnthropicDirectAdapter(apikey_config)
        try:
            headers = adapter._build_upstream_headers(
                {
                    "x-api-key": "sk-client-key-should-be-stripped",
                    "content-type": "application/json",
                }
            )

            assert headers["x-api-key"] == "sk-test-key-123"
            assert "authorization" not in headers
        finally:
            await adapter.close()

    async def test_apikey_mode_resolves_env_var(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("MY_TEST_KEY", "sk-from-env")
        config = UpstreamConfig(
            url="https://api.anthropic.com",
            auth=UpstreamAuthConfig(mode="api_key", key="${MY_TEST_KEY}"),
        )
        adapter = AnthropicDirectAdapter(config)
        try:
            headers = adapter._build_upstream_headers({"content-type": "application/json"})
            assert headers["x-api-key"] == "sk-from-env"
        finally:
            await adapter.close()


class TestNonStreamingForward:
    @respx.mock
    async def test_forwards_and_returns_response(self, passthrough_config: UpstreamConfig):
        response_body = {
            "id": "msg_123",
            "model": "claude-sonnet-4-5-20250929",
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
        respx.post("https://api.anthropic.com/v1/messages").mock(
            return_value=httpx.Response(200, json=response_body)
        )

        adapter = AnthropicDirectAdapter(passthrough_config)
        try:
            status, headers, body = await adapter.forward(
                json.dumps({"model": "claude-sonnet-4-5-20250929", "messages": []}).encode(),
                {"content-type": "application/json", "x-api-key": "sk-test"},
            )

            assert status == 200
            data = json.loads(body)
            assert data["model"] == "claude-sonnet-4-5-20250929"
        finally:
            await adapter.close()

    @respx.mock
    async def test_forwards_error_responses(self, passthrough_config: UpstreamConfig):
        respx.post("https://api.anthropic.com/v1/messages").mock(
            return_value=httpx.Response(
                429,
                json={"type": "error", "error": {"type": "rate_limit_error"}},
            )
        )

        adapter = AnthropicDirectAdapter(passthrough_config)
        try:
            status, _, body = await adapter.forward(
                b'{"model": "test", "messages": []}',
                {"content-type": "application/json"},
            )

            assert status == 429
            assert b"rate_limit_error" in body
        finally:
            await adapter.close()


class TestStreamingForward:
    @respx.mock
    async def test_streams_raw_bytes(self, passthrough_config: UpstreamConfig):
        msg_start = (
            b"event: message_start\ndata: "
            b'{"type":"message_start","message":'
            b'{"model":"claude-sonnet-4-5-20250929",'
            b'"usage":{"input_tokens":10}}}\n\n'
        )
        msg_stop = b'event: message_stop\ndata: {"type":"message_stop"}\n\n'
        sse_content = msg_start + msg_stop
        respx.post("https://api.anthropic.com/v1/messages").mock(
            return_value=httpx.Response(
                200,
                content=sse_content,
                headers={"content-type": "text/event-stream"},
            )
        )

        adapter = AnthropicDirectAdapter(passthrough_config)
        try:
            status, headers, chunk_iter = await adapter.stream_forward(
                b'{"model": "test", "stream": true, "messages": []}',
                {"content-type": "application/json", "x-api-key": "sk-test"},
            )

            assert status == 200
            collected = bytearray()
            async for chunk in chunk_iter:
                collected.extend(chunk)

            assert b"message_start" in collected
            assert b"message_stop" in collected
        finally:
            await adapter.close()


class TestResponseHeaderFiltering:
    def test_strips_transport_headers(self):
        headers = {
            "content-type": "application/json",
            "x-request-id": "req-123",
            "transfer-encoding": "chunked",
            "connection": "keep-alive",
            "content-length": "42",
        }
        filtered = AnthropicDirectAdapter._filter_response_headers(headers)

        assert "content-type" in filtered
        assert "x-request-id" in filtered
        assert "transfer-encoding" not in filtered
        assert "connection" not in filtered
        assert "content-length" not in filtered


class TestClose:
    async def test_closes_client(self, passthrough_config: UpstreamConfig):
        adapter = AnthropicDirectAdapter(passthrough_config)
        await adapter.close()
        assert adapter._client.is_closed
