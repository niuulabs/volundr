"""Tests for the flock_flows REST API — full CRUD + persona name validation.

Uses FastAPI TestClient with an in-memory ConfigFlockFlowProvider wired via
app.state so no real database or k8s dependency is needed.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tyr.adapters.flows.config import ConfigFlockFlowProvider
from tyr.api.flock_flows import create_flock_flows_router

# ---------------------------------------------------------------------------
# Test app factory
# ---------------------------------------------------------------------------


def _make_app(
    provider: ConfigFlockFlowProvider | None = None,
    persona_source: object | None = None,
) -> FastAPI:
    app = FastAPI()
    app.include_router(create_flock_flows_router())
    app.state.flock_flow_provider = provider or ConfigFlockFlowProvider(path="")
    app.state.flock_flow_persona_source = persona_source
    return app


def _known_persona_source(*names: str) -> MagicMock:
    """Return a mock persona source that recognises the given names."""
    source = MagicMock()
    source.list_names.return_value = list(names)
    return source


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_make_app())


@pytest.fixture()
def client_with_source() -> TestClient:
    source = _known_persona_source("coordinator", "reviewer", "coder")
    return TestClient(_make_app(persona_source=source))


# ---------------------------------------------------------------------------
# GET /flock_flows
# ---------------------------------------------------------------------------


class TestListFlows:
    def test_returns_empty_list(self, client: TestClient) -> None:
        resp = client.get("/api/v1/tyr/flock_flows")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_saved_flow(self, client: TestClient) -> None:
        client.post(
            "/api/v1/tyr/flock_flows",
            json={"name": "my-flow", "personas": [{"name": "coordinator"}]},
        )
        resp = client.get("/api/v1/tyr/flock_flows")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "my-flow"


# ---------------------------------------------------------------------------
# GET /flock_flows/{name}
# ---------------------------------------------------------------------------


class TestGetFlow:
    def test_returns_404_for_unknown_flow(self, client: TestClient) -> None:
        resp = client.get("/api/v1/tyr/flock_flows/nonexistent")
        assert resp.status_code == 404

    def test_returns_flow_by_name(self, client: TestClient) -> None:
        client.post(
            "/api/v1/tyr/flock_flows",
            json={"name": "target-flow", "description": "hello"},
        )
        resp = client.get("/api/v1/tyr/flock_flows/target-flow")
        assert resp.status_code == 200
        assert resp.json()["description"] == "hello"


# ---------------------------------------------------------------------------
# POST /flock_flows
# ---------------------------------------------------------------------------


class TestCreateFlow:
    def test_creates_flow_returns_201(self, client: TestClient) -> None:
        resp = client.post(
            "/api/v1/tyr/flock_flows",
            json={"name": "new-flow"},
        )
        assert resp.status_code == 201
        assert resp.json()["name"] == "new-flow"

    def test_creates_flow_with_personas(self, client: TestClient) -> None:
        resp = client.post(
            "/api/v1/tyr/flock_flows",
            json={
                "name": "review-flow",
                "personas": [
                    {"name": "coordinator"},
                    {
                        "name": "reviewer",
                        "llm": {"primary_alias": "powerful", "thinking_enabled": True},
                        "iteration_budget": 15,
                    },
                ],
            },
        )
        assert resp.status_code == 201
        personas = resp.json()["personas"]
        assert len(personas) == 2
        reviewer = next(p for p in personas if p["name"] == "reviewer")
        assert reviewer["llm"]["primary_alias"] == "powerful"
        assert reviewer["iteration_budget"] == 15

    def test_validation_rejects_unknown_persona_names(self, client_with_source: TestClient) -> None:
        resp = client_with_source.post(
            "/api/v1/tyr/flock_flows",
            json={
                "name": "bad-flow",
                "personas": [
                    {"name": "coordinator"},
                    {"name": "does-not-exist"},
                ],
            },
        )
        assert resp.status_code == 422
        assert "does-not-exist" in resp.json()["detail"]

    def test_validation_accepts_known_persona_names(self, client_with_source: TestClient) -> None:
        resp = client_with_source.post(
            "/api/v1/tyr/flock_flows",
            json={
                "name": "good-flow",
                "personas": [{"name": "coordinator"}, {"name": "reviewer"}],
            },
        )
        assert resp.status_code == 201

    def test_skips_validation_when_no_persona_source(self, client: TestClient) -> None:
        """Without a persona source, any name is accepted."""
        resp = client.post(
            "/api/v1/tyr/flock_flows",
            json={"name": "any-flow", "personas": [{"name": "completely-unknown-persona"}]},
        )
        assert resp.status_code == 201

    def test_validation_error_lists_all_missing_names(self, client_with_source: TestClient) -> None:
        resp = client_with_source.post(
            "/api/v1/tyr/flock_flows",
            json={
                "name": "bad-flow",
                "personas": [
                    {"name": "missing-a"},
                    {"name": "missing-b"},
                    {"name": "coordinator"},
                ],
            },
        )
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert "missing-a" in detail
        assert "missing-b" in detail


# ---------------------------------------------------------------------------
# PUT /flock_flows/{name}
# ---------------------------------------------------------------------------


class TestUpdateFlow:
    def test_creates_when_not_exists(self, client: TestClient) -> None:
        resp = client.put(
            "/api/v1/tyr/flock_flows/new-flow",
            json={"name": "new-flow", "description": "brand new"},
        )
        assert resp.status_code == 200
        assert resp.json()["description"] == "brand new"

    def test_updates_existing_flow(self, client: TestClient) -> None:
        client.post("/api/v1/tyr/flock_flows", json={"name": "my-flow", "description": "v1"})
        resp = client.put(
            "/api/v1/tyr/flock_flows/my-flow",
            json={"name": "my-flow", "description": "v2"},
        )
        assert resp.status_code == 200
        assert resp.json()["description"] == "v2"

    def test_rejects_name_mismatch(self, client: TestClient) -> None:
        resp = client.put(
            "/api/v1/tyr/flock_flows/url-name",
            json={"name": "body-name"},
        )
        assert resp.status_code == 422

    def test_validates_persona_names_on_put(self, client_with_source: TestClient) -> None:
        resp = client_with_source.put(
            "/api/v1/tyr/flock_flows/bad-flow",
            json={
                "name": "bad-flow",
                "personas": [{"name": "ghost-persona"}],
            },
        )
        assert resp.status_code == 422
        assert "ghost-persona" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# DELETE /flock_flows/{name}
# ---------------------------------------------------------------------------


class TestDeleteFlow:
    def test_deletes_existing_flow(self, client: TestClient) -> None:
        client.post("/api/v1/tyr/flock_flows", json={"name": "to-delete"})
        resp = client.delete("/api/v1/tyr/flock_flows/to-delete")
        assert resp.status_code == 204
        assert client.get("/api/v1/tyr/flock_flows/to-delete").status_code == 404

    def test_returns_404_for_missing_flow(self, client: TestClient) -> None:
        resp = client.delete("/api/v1/tyr/flock_flows/ghost")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Service unavailable when provider is None
# ---------------------------------------------------------------------------


class TestProviderUnavailable:
    def test_list_returns_503_when_no_provider(self) -> None:
        app = FastAPI()
        app.include_router(create_flock_flows_router())
        # Intentionally do NOT set flock_flow_provider on app.state
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/api/v1/tyr/flock_flows")
        assert resp.status_code == 503
