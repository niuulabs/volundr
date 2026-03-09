"""Tests for the Bifröst app factory."""

from __future__ import annotations

from fastapi.testclient import TestClient

from volundr.bifrost.app import create_bifrost_app
from volundr.bifrost.config import (
    BifrostConfig,
    UpstreamConfig,
    UpstreamEntryConfig,
)


class TestHealthEndpoint:
    def test_health_returns_ok(self):
        config = BifrostConfig()
        app = create_bifrost_app(config)

        with TestClient(app) as client:
            resp = client.get("/health")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["service"] == "bifrost"


class TestMessagesEndpointWiring:
    def test_messages_endpoint_exists(self):
        # Point at a non-routable host so we get 502, not a real response
        config = BifrostConfig(
            upstream=UpstreamConfig(
                url="http://192.0.2.1:1",  # RFC 5737 TEST-NET
                connect_timeout_s=0.5,
            ),
        )
        app = create_bifrost_app(config)

        with TestClient(app) as client:
            resp = client.post(
                "/v1/messages",
                json={
                    "model": "claude-sonnet-4-5-20250929",
                    "messages": [{"role": "user", "content": "hi"}],
                },
            )

        # Upstream is unreachable so we get a 5xx — but NOT 404/405
        assert resp.status_code not in (404, 405)
        assert resp.status_code >= 500


class TestMultiUpstreamWiring:
    def test_creates_app_with_multiple_upstreams(self):
        config = BifrostConfig(
            upstreams={
                "default": UpstreamEntryConfig(
                    url="http://192.0.2.1:1",
                    connect_timeout_s=0.5,
                ),
                "secondary": UpstreamEntryConfig(
                    url="http://192.0.2.2:1",
                    connect_timeout_s=0.5,
                ),
            },
        )
        app = create_bifrost_app(config)

        with TestClient(app) as client:
            resp = client.get("/health")

        assert resp.status_code == 200


class TestAppLifecycle:
    def test_starts_and_stops_cleanly(self):
        config = BifrostConfig()
        app = create_bifrost_app(config)

        # TestClient context manager triggers lifespan startup/shutdown
        with TestClient(app) as client:
            assert client.get("/health").status_code == 200
        # If we get here without error, lifecycle is clean
