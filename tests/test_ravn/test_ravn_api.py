"""Tests for the Ravn FastAPI sub-application."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from ravn.api import create_app


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def test_status_endpoint(client: TestClient):
    resp = client.get("/api/v1/ravn/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["service"] == "ravn"
    assert data["healthy"] is True
    assert "session_count" in data


def test_list_sessions_returns_empty_list(client: TestClient):
    resp = client.get("/api/v1/ravn/sessions")
    assert resp.status_code == 200
    assert resp.json() == []


def test_stop_session(client: TestClient):
    resp = client.post("/api/v1/ravn/sessions/my-session-id/stop")
    assert resp.status_code == 200
    data = resp.json()
    assert data["session_id"] == "my-session-id"
    assert data["status"] == "stopped"
