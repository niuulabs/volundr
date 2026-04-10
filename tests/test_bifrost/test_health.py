"""Tests for Bifrost health endpoint."""

from __future__ import annotations

from fastapi.testclient import TestClient


class TestHealthEndpoint:
    def test_health_returns_ok(self, client: TestClient) -> None:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    def test_health_has_correlation_id(self, client: TestClient) -> None:
        response = client.get("/health")
        assert "x-correlation-id" in response.headers

    def test_health_preserves_correlation_id(self, client: TestClient) -> None:
        response = client.get("/health", headers={"X-Correlation-ID": "bifrost-test-123"})
        assert response.headers["x-correlation-id"] == "bifrost-test-123"
