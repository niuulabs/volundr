"""Tests for GET /v1/models endpoint."""

from __future__ import annotations

from fastapi.testclient import TestClient


class TestModelsEndpoint:
    def test_list_models_returns_200(self, client: TestClient) -> None:
        response = client.get("/v1/models")
        assert response.status_code == 200

    def test_list_models_returns_data_list(self, client: TestClient) -> None:
        response = client.get("/v1/models")
        body = response.json()
        assert "data" in body
        assert isinstance(body["data"], list)

    def test_list_models_contains_expected_models(self, client: TestClient) -> None:
        response = client.get("/v1/models")
        data = response.json()["data"]
        ids = {m["id"] for m in data}
        assert "claude-sonnet-4-6" in ids
        assert "claude-opus-4-6" in ids

    def test_list_models_has_type_field(self, client: TestClient) -> None:
        response = client.get("/v1/models")
        data = response.json()["data"]
        assert all(m.get("type") == "model" for m in data)

    def test_list_models_has_display_name(self, client: TestClient) -> None:
        response = client.get("/v1/models")
        data = response.json()["data"]
        assert all("display_name" in m for m in data)
