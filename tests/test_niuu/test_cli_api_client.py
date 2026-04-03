"""Tests for niuu.cli_api_client."""

from __future__ import annotations

import httpx
import pytest
import respx

from niuu.cli_api_client import CLIAPIClient


@pytest.fixture
def client() -> CLIAPIClient:
    return CLIAPIClient(base_url="http://test-host:9999", auth_token="tok-123")


@pytest.fixture
def anon_client() -> CLIAPIClient:
    return CLIAPIClient(base_url="http://test-host:9999")


class TestCLIAPIClient:
    @respx.mock
    def test_get_sends_auth_header(self, client: CLIAPIClient) -> None:
        route = respx.get("http://test-host:9999/api/v1/test").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        resp = client.get("/api/v1/test")
        assert resp.status_code == 200
        assert route.called
        assert route.calls[0].request.headers["authorization"] == "Bearer tok-123"

    @respx.mock
    def test_get_no_auth_when_no_token(self, anon_client: CLIAPIClient) -> None:
        route = respx.get("http://test-host:9999/api/v1/test").mock(
            return_value=httpx.Response(200, json={})
        )
        anon_client.get("/api/v1/test")
        assert "authorization" not in route.calls[0].request.headers

    @respx.mock
    def test_post_with_json_body(self, client: CLIAPIClient) -> None:
        route = respx.post("http://test-host:9999/api/v1/items").mock(
            return_value=httpx.Response(201, json={"id": "abc"})
        )
        resp = client.post("/api/v1/items", json_body={"name": "test"})
        assert resp.status_code == 201
        assert route.called

    @respx.mock
    def test_delete(self, client: CLIAPIClient) -> None:
        respx.delete("http://test-host:9999/api/v1/items/1").mock(
            return_value=httpx.Response(204)
        )
        resp = client.delete("/api/v1/items/1")
        assert resp.status_code == 204

    @respx.mock
    def test_trailing_slash_stripped(self) -> None:
        c = CLIAPIClient(base_url="http://host:80/")
        route = respx.get("http://host:80/api").mock(
            return_value=httpx.Response(200, json={})
        )
        c.get("/api")
        assert route.called
