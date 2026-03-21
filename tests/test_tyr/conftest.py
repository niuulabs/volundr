"""Shared test fixtures for Tyr tests."""

import pytest

from tyr.config import Settings
from tyr.main import create_app


@pytest.fixture
def tyr_settings() -> Settings:
    """Create test settings."""
    return Settings()


@pytest.fixture
def tyr_app(tyr_settings: Settings):
    """Create a test FastAPI app."""
    return create_app(tyr_settings)
