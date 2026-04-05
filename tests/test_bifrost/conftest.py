"""Shared fixtures for Bifrost tests."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from bifrost.app import create_app
from bifrost.config import BifrostConfig, ProviderConfig
from bifrost.translation.models import AnthropicResponse, TextBlock, UsageInfo


def make_config(models: list[str] | None = None) -> BifrostConfig:
    """Return a minimal BifrostConfig suitable for unit tests."""
    return BifrostConfig(
        providers={
            "anthropic": ProviderConfig(
                models=models or ["claude-sonnet-4-6", "claude-opus-4-6"]
            )
        }
    )


def make_response(text: str = "Hello!") -> AnthropicResponse:
    return AnthropicResponse(
        id="msg_test",
        content=[TextBlock(text=text)],
        model="claude-sonnet-4-6",
        stop_reason="end_turn",
        usage=UsageInfo(input_tokens=10, output_tokens=5),
    )


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
