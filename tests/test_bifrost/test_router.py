"""Tests for ModelRouter: alias expansion, provider selection, failover."""

from __future__ import annotations

from collections.abc import AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from bifrost.config import BifrostConfig, ProviderConfig
from bifrost.ports.provider import ProviderError, ProviderPort
from bifrost.router import ModelRouter, RouterError
from bifrost.translation.models import (
    AnthropicRequest,
    AnthropicResponse,
    Message,
    TextBlock,
    UsageInfo,
)


def _make_response(text: str = "OK") -> AnthropicResponse:
    return AnthropicResponse(
        id="msg_test",
        content=[TextBlock(text=text)],
        model="some-model",
        stop_reason="end_turn",
        usage=UsageInfo(input_tokens=5, output_tokens=3),
    )


def _make_request(model: str = "gpt-4o") -> AnthropicRequest:
    return AnthropicRequest(
        model=model,
        max_tokens=100,
        messages=[Message(role="user", content="Hello")],
    )


class FakeProvider(ProviderPort):
    """Test double for a provider adapter."""

    def __init__(self, response: AnthropicResponse | None = None, raises: Exception | None = None):
        self._response = response or _make_response()
        self._raises = raises
        self.complete_calls: list = []
        self.stream_calls: list = []
        self.closed = False

    async def complete(self, request: AnthropicRequest, model: str) -> AnthropicResponse:
        self.complete_calls.append((request, model))
        if self._raises:
            raise self._raises
        return self._response

    async def stream(self, request: AnthropicRequest, model: str) -> AsyncIterator[str]:
        self.stream_calls.append((request, model))
        if self._raises:
            raise self._raises
        yield "data: test\n\n"

    async def close(self) -> None:
        self.closed = True


def _make_router(providers_cfg: dict, aliases: dict | None = None) -> tuple[ModelRouter, dict]:
    """Create a router with injected fake providers."""
    cfg = BifrostConfig(
        providers=providers_cfg,
        aliases=aliases or {},
        failover_enabled=True,
    )
    router = ModelRouter(cfg)
    return router, {}


class TestAliasResolution:
    @pytest.mark.asyncio
    async def test_alias_expanded_before_routing(self):
        cfg = BifrostConfig(
            providers={"openai": ProviderConfig(models=["gpt-4o"])},
            aliases={"smart": "gpt-4o"},
        )
        router = ModelRouter(cfg)
        fake = FakeProvider()
        router._adapters["openai"] = fake

        req = _make_request(model="smart")
        await router.complete(req)

        # The adapter should have been called with the canonical model name.
        assert fake.complete_calls[0][1] == "gpt-4o"

    @pytest.mark.asyncio
    async def test_unknown_model_raises_router_error(self):
        cfg = BifrostConfig(providers={"openai": ProviderConfig(models=["gpt-4o"])})
        router = ModelRouter(cfg)

        req = _make_request(model="unknown-model-xyz")
        with pytest.raises(RouterError, match="No provider configured"):
            await router.complete(req)

    @pytest.mark.asyncio
    async def test_alias_to_unknown_model_raises(self):
        cfg = BifrostConfig(
            providers={"openai": ProviderConfig(models=["gpt-4o"])},
            aliases={"mystery": "non-existent-model"},
        )
        router = ModelRouter(cfg)
        req = _make_request(model="mystery")
        with pytest.raises(RouterError):
            await router.complete(req)


class TestProviderRouting:
    @pytest.mark.asyncio
    async def test_routes_to_correct_provider(self):
        cfg = BifrostConfig(
            providers={
                "anthropic": ProviderConfig(models=["claude-sonnet-4-20250514"]),
                "openai": ProviderConfig(models=["gpt-4o"]),
            }
        )
        router = ModelRouter(cfg)
        fake_anthropic = FakeProvider()
        fake_openai = FakeProvider()
        router._adapters["anthropic"] = fake_anthropic
        router._adapters["openai"] = fake_openai

        req_openai = _make_request(model="gpt-4o")
        await router.complete(req_openai)
        assert len(fake_openai.complete_calls) == 1
        assert len(fake_anthropic.complete_calls) == 0

        req_anthropic = _make_request(model="claude-sonnet-4-20250514")
        await router.complete(req_anthropic)
        assert len(fake_anthropic.complete_calls) == 1

    @pytest.mark.asyncio
    async def test_correct_model_forwarded_to_adapter(self):
        cfg = BifrostConfig(
            providers={"openai": ProviderConfig(models=["gpt-4o-mini"])},
        )
        router = ModelRouter(cfg)
        fake = FakeProvider()
        router._adapters["openai"] = fake

        req = _make_request(model="gpt-4o-mini")
        await router.complete(req)
        assert fake.complete_calls[0][1] == "gpt-4o-mini"


class TestFailover:
    @pytest.mark.asyncio
    async def test_failover_on_http_503(self):
        cfg = BifrostConfig(
            providers={
                "openai": ProviderConfig(models=["gpt-4o"]),
                "backup": ProviderConfig(models=["gpt-4o"]),
            },
            failover_enabled=True,
        )
        router = ModelRouter(cfg)

        mock_resp = MagicMock()
        mock_resp.status_code = 503
        primary = FakeProvider(
            raises=httpx.HTTPStatusError("fail", request=MagicMock(), response=mock_resp)
        )
        backup = FakeProvider()
        router._adapters["openai"] = primary
        router._adapters["backup"] = backup

        req = _make_request(model="gpt-4o")
        result = await router.complete(req)
        assert result.content[0].text == "OK"
        assert len(backup.complete_calls) == 1

    @pytest.mark.asyncio
    async def test_failover_not_triggered_on_non_retryable_http_error(self):
        cfg = BifrostConfig(
            providers={
                "openai": ProviderConfig(models=["gpt-4o"]),
                "backup": ProviderConfig(models=["gpt-4o"]),
            },
            failover_enabled=True,
        )
        router = ModelRouter(cfg)

        mock_resp = MagicMock()
        mock_resp.status_code = 401
        primary = FakeProvider(
            raises=httpx.HTTPStatusError("auth", request=MagicMock(), response=mock_resp)
        )
        backup = FakeProvider()
        router._adapters["openai"] = primary
        router._adapters["backup"] = backup

        req = _make_request(model="gpt-4o")
        with pytest.raises(httpx.HTTPStatusError):
            await router.complete(req)
        assert len(backup.complete_calls) == 0

    @pytest.mark.asyncio
    async def test_failover_disabled(self):
        cfg = BifrostConfig(
            providers={
                "openai": ProviderConfig(models=["gpt-4o"]),
                "backup": ProviderConfig(models=["gpt-4o"]),
            },
            failover_enabled=False,
        )
        router = ModelRouter(cfg)

        mock_resp = MagicMock()
        mock_resp.status_code = 503
        primary = FakeProvider(
            raises=httpx.HTTPStatusError("fail", request=MagicMock(), response=mock_resp)
        )
        backup = FakeProvider()
        router._adapters["openai"] = primary
        router._adapters["backup"] = backup

        req = _make_request(model="gpt-4o")
        with pytest.raises(RouterError):
            await router.complete(req)
        # Backup should NOT have been tried.
        assert len(backup.complete_calls) == 0

    @pytest.mark.asyncio
    async def test_all_providers_fail_raises_router_error(self):
        cfg = BifrostConfig(
            providers={
                "openai": ProviderConfig(models=["gpt-4o"]),
                "backup": ProviderConfig(models=["gpt-4o"]),
            },
            failover_enabled=True,
        )
        router = ModelRouter(cfg)

        mock_resp = MagicMock()
        mock_resp.status_code = 503
        exc = httpx.HTTPStatusError("fail", request=MagicMock(), response=mock_resp)
        router._adapters["openai"] = FakeProvider(raises=exc)
        router._adapters["backup"] = FakeProvider(raises=exc)

        req = _make_request(model="gpt-4o")
        with pytest.raises(RouterError, match="All providers failed"):
            await router.complete(req)

    @pytest.mark.asyncio
    async def test_failover_on_provider_error(self):
        cfg = BifrostConfig(
            providers={
                "openai": ProviderConfig(models=["gpt-4o"]),
                "backup": ProviderConfig(models=["gpt-4o"]),
            },
            failover_enabled=True,
        )
        router = ModelRouter(cfg)
        router._adapters["openai"] = FakeProvider(raises=ProviderError("down"))
        router._adapters["backup"] = FakeProvider()

        req = _make_request(model="gpt-4o")
        result = await router.complete(req)
        assert result.content[0].text == "OK"


class TestStreamingRouter:
    @pytest.mark.asyncio
    async def test_stream_routes_correctly(self):
        cfg = BifrostConfig(providers={"openai": ProviderConfig(models=["gpt-4o"])})
        router = ModelRouter(cfg)
        fake = FakeProvider()
        router._adapters["openai"] = fake

        req = _make_request(model="gpt-4o")
        req_stream = req.model_copy(update={"stream": True})
        chunks = []
        async for chunk in router.stream(req_stream):
            chunks.append(chunk)
        assert chunks == ["data: test\n\n"]

    @pytest.mark.asyncio
    async def test_stream_failover_on_provider_error(self):
        cfg = BifrostConfig(
            providers={
                "openai": ProviderConfig(models=["gpt-4o"]),
                "backup": ProviderConfig(models=["gpt-4o"]),
            },
            failover_enabled=True,
        )
        router = ModelRouter(cfg)
        router._adapters["openai"] = FakeProvider(raises=ProviderError("down"))
        router._adapters["backup"] = FakeProvider()

        req = _make_request(model="gpt-4o")
        chunks = []
        async for chunk in router.stream(req):
            chunks.append(chunk)
        assert chunks == ["data: test\n\n"]


class TestClose:
    @pytest.mark.asyncio
    async def test_close_closes_all_adapters(self):
        cfg = BifrostConfig(providers={"openai": ProviderConfig(models=["gpt-4o"])})
        router = ModelRouter(cfg)
        fake = FakeProvider()
        router._adapters["openai"] = fake
        await router.close()
        assert fake.closed is True
        assert router._adapters == {}


class TestAdapterLoading:
    @pytest.mark.asyncio
    async def test_adapter_loaded_lazily(self):
        cfg = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-20250514"])}
        )
        router = ModelRouter(cfg)
        assert router._adapters == {}

        # Patch to avoid real HTTP calls.
        with patch(
            "bifrost.adapters.anthropic.AnthropicAdapter.complete",
            new_callable=AsyncMock,
            return_value=_make_response(),
        ):
            req = _make_request(model="claude-sonnet-4-20250514")
            await router.complete(req)

        assert "anthropic" in router._adapters

    @pytest.mark.asyncio
    async def test_adapter_cached_on_second_call(self):
        cfg = BifrostConfig(providers={"openai": ProviderConfig(models=["gpt-4o"])})
        router = ModelRouter(cfg)
        fake = FakeProvider()
        router._adapters["openai"] = fake

        req = _make_request(model="gpt-4o")
        await router.complete(req)
        await router.complete(req)

        # Only one adapter instance should exist.
        assert router._adapters["openai"] is fake
