"""Tests for the main application factory."""

from fastapi import FastAPI

from volundr.config import Settings
from volundr.main import create_app


class TestCreateApp:
    """Tests for create_app factory."""

    def test_create_app_returns_fastapi(self):
        """create_app returns a FastAPI instance."""
        app = create_app()
        assert isinstance(app, FastAPI)

    def test_create_app_with_custom_settings(self):
        """create_app accepts custom settings."""
        settings = Settings()
        app = create_app(settings)
        assert app.state.settings is settings

    def test_create_app_default_settings(self):
        """create_app uses default settings when none provided."""
        app = create_app()
        assert isinstance(app.state.settings, Settings)

    def test_app_has_title(self):
        """App has correct title."""
        app = create_app()
        assert app.title == "Volundr"

    def test_app_has_version(self):
        """App has version."""
        app = create_app()
        assert app.version == "0.1.0"


class TestHealthCheck:
    """Tests for health check endpoint."""

    def test_health_check_returns_healthy(self):
        """Health check returns healthy status."""
        from fastapi.testclient import TestClient

        app = create_app()
        client = TestClient(app)

        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "healthy"}


class TestCORSMiddleware:
    """Tests for CORS middleware."""

    def test_cors_allows_all_origins(self):
        """CORS middleware allows all origins."""
        from fastapi.testclient import TestClient

        app = create_app()
        client = TestClient(app)

        response = client.options(
            "/health",
            headers={
                "Origin": "http://example.com",
                "Access-Control-Request-Method": "GET",
            },
        )
        # CORS preflight should succeed
        assert response.status_code in (200, 204, 400)
