"""Shared fixtures for Bifrost tests."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from bifrost.app import create_app
from bifrost.config import BifrostConfig, ProviderConfig
from bifrost.translation.models import AnthropicResponse, TextBlock, UsageInfo


def make_config(
    models: list[str] | None = None,
    aliases: dict[str, str] | None = None,
) -> BifrostConfig:
    """Return a minimal BifrostConfig suitable for unit tests."""
    return BifrostConfig(
        providers={
            "anthropic": ProviderConfig(models=models or ["claude-sonnet-4-6", "claude-opus-4-6"])
        },
        aliases=aliases or {},
    )


def make_response(
    text: str = "Hello!",
    input_tokens: int = 10,
    output_tokens: int = 5,
) -> AnthropicResponse:
    return AnthropicResponse(
        id="msg_test",
        content=[TextBlock(text=text)],
        model="claude-sonnet-4-6",
        stop_reason="end_turn",
        usage=UsageInfo(input_tokens=input_tokens, output_tokens=output_tokens),
    )


def make_pool_mock():
    """Return a mocked asyncpg pool that works as an async context manager."""
    conn = AsyncMock()
    conn.execute = AsyncMock(return_value=None)
    conn.fetchrow = AsyncMock()
    conn.fetch = AsyncMock(return_value=[])

    pool = MagicMock()
    pool.acquire = MagicMock(
        return_value=MagicMock(
            __aenter__=AsyncMock(return_value=conn),
            __aexit__=AsyncMock(return_value=False),
        )
    )
    pool.close = AsyncMock()
    return pool, conn


@pytest.fixture
def config() -> BifrostConfig:
    return make_config()


@pytest.fixture
def client(config: BifrostConfig) -> TestClient:
    """TestClient with ModelRouter.complete mocked to avoid real network calls."""
    app = create_app(config)
    with patch("bifrost.router.ModelRouter.complete", new_callable=AsyncMock) as mock_complete:
        mock_complete.return_value = make_response()
        with TestClient(app) as c:
            yield c
