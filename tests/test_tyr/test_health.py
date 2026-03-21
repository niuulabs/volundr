"""Tests for Tyr health endpoint."""

import httpx
import pytest

from tyr.config import Settings
from tyr.main import create_app


@pytest.fixture
def tyr_app():
    """Create a test FastAPI app."""
    return create_app()


async def test_health_returns_healthy(tyr_app) -> None:
    """Health endpoint returns status healthy."""
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=tyr_app),
        base_url="http://test",
    ) as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


async def test_health_method_not_allowed(tyr_app) -> None:
    """Health endpoint rejects non-GET methods."""
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=tyr_app),
        base_url="http://test",
    ) as client:
        response = await client.post("/health")

    assert response.status_code == 405


async def test_create_app_with_custom_settings() -> None:
    """App can be created with explicit settings."""
    settings = Settings()
    app = create_app(settings)

    assert app.state.settings is settings
    assert app.title == "Tyr"


async def test_create_app_default_settings() -> None:
    """App created without args uses default settings."""
    app = create_app()

    assert app.state.settings is not None
    assert app.version == "0.1.0"
