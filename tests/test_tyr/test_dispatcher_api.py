"""Tests for the dispatcher state REST API endpoints.

Tests GET /api/v1/tyr/dispatcher and PATCH /api/v1/tyr/dispatcher by
overriding the DispatcherRepository dependency with an in-memory mock.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tyr.api.dispatcher import (
    create_dispatcher_router,
    resolve_dispatcher_repo,
)
from tyr.domain.models import DispatcherState
from tyr.ports.dispatcher_repository import DispatcherRepository

# -------------------------------------------------------------------
# In-memory mock
# -------------------------------------------------------------------

_DEFAULT_RUNNING = True
_DEFAULT_THRESHOLD = 0.75
_DEFAULT_MAX_CONCURRENT_RAIDS = 3


class MockDispatcherRepo(DispatcherRepository):
    """In-memory dispatcher repository for tests."""

    def __init__(self) -> None:
        self.states: dict[str, DispatcherState] = {}

    async def get_or_create(self, owner_id: str) -> DispatcherState:
        if owner_id in self.states:
            return self.states[owner_id]
        state = DispatcherState(
            id=uuid4(),
            owner_id=owner_id,
            running=_DEFAULT_RUNNING,
            threshold=_DEFAULT_THRESHOLD,
            max_concurrent_raids=_DEFAULT_MAX_CONCURRENT_RAIDS,
            updated_at=datetime.now(UTC),
        )
        self.states[owner_id] = state
        return state

    async def update(self, owner_id: str, **fields: object) -> DispatcherState:
        current = await self.get_or_create(owner_id)
        allowed = {"running", "threshold", "max_concurrent_raids"}
        updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
        if not updates:
            return current
        new_state = DispatcherState(
            id=current.id,
            owner_id=current.owner_id,
            running=updates.get("running", current.running),
            threshold=updates.get("threshold", current.threshold),
            max_concurrent_raids=updates.get("max_concurrent_raids", current.max_concurrent_raids),
            updated_at=datetime.now(UTC),
        )
        self.states[owner_id] = new_state
        return new_state


# -------------------------------------------------------------------
# Fixtures
# -------------------------------------------------------------------


@pytest.fixture
def mock_repo() -> MockDispatcherRepo:
    return MockDispatcherRepo()


@pytest.fixture
def client(mock_repo: MockDispatcherRepo) -> TestClient:
    app = FastAPI()
    app.include_router(create_dispatcher_router())
    app.dependency_overrides[resolve_dispatcher_repo] = lambda: mock_repo
    return TestClient(app)


def _auth_headers(user_id: str = "user-1") -> dict[str, str]:
    return {"x-auth-user-id": user_id}


# -------------------------------------------------------------------
# GET /api/v1/tyr/dispatcher
# -------------------------------------------------------------------


class TestGetDispatcherState:
    def test_creates_default_when_none_exists(self, client: TestClient):
        resp = client.get("/api/v1/tyr/dispatcher", headers=_auth_headers())
        assert resp.status_code == 200
        data = resp.json()
        assert data["running"] is True
        assert data["threshold"] == 0.75
        assert data["max_concurrent_raids"] == 3
        assert "id" in data
        assert "updated_at" in data

    def test_returns_existing_state(self, client: TestClient, mock_repo: MockDispatcherRepo):
        # Pre-populate a state
        existing = DispatcherState(
            id=uuid4(),
            owner_id="user-1",
            running=False,
            threshold=0.5,
            max_concurrent_raids=5,
            updated_at=datetime.now(UTC),
        )
        mock_repo.states["user-1"] = existing

        resp = client.get("/api/v1/tyr/dispatcher", headers=_auth_headers())
        assert resp.status_code == 200
        data = resp.json()
        assert data["running"] is False
        assert data["threshold"] == 0.5
        assert data["max_concurrent_raids"] == 5
        assert data["id"] == str(existing.id)

    def test_scoped_to_user(self, client: TestClient, mock_repo: MockDispatcherRepo):
        # User-1 gets state
        client.get("/api/v1/tyr/dispatcher", headers=_auth_headers("user-1"))
        # User-2 gets their own state
        client.get("/api/v1/tyr/dispatcher", headers=_auth_headers("user-2"))
        assert len(mock_repo.states) == 2
        assert "user-1" in mock_repo.states
        assert "user-2" in mock_repo.states

    def test_default_principal_when_no_auth_headers(self, client: TestClient):
        resp = client.get("/api/v1/tyr/dispatcher")
        assert resp.status_code == 200
        data = resp.json()
        assert data["running"] is True


# -------------------------------------------------------------------
# PATCH /api/v1/tyr/dispatcher
# -------------------------------------------------------------------


class TestPatchDispatcherState:
    def test_updates_running_flag(self, client: TestClient):
        # First GET to create default
        client.get("/api/v1/tyr/dispatcher", headers=_auth_headers())

        resp = client.patch(
            "/api/v1/tyr/dispatcher",
            json={"running": False},
            headers=_auth_headers(),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["running"] is False
        assert data["threshold"] == 0.75  # unchanged

    def test_updates_threshold(self, client: TestClient):
        client.get("/api/v1/tyr/dispatcher", headers=_auth_headers())

        resp = client.patch(
            "/api/v1/tyr/dispatcher",
            json={"threshold": 0.9},
            headers=_auth_headers(),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["threshold"] == 0.9
        assert data["running"] is True  # unchanged

    def test_updates_max_concurrent_raids(self, client: TestClient):
        client.get("/api/v1/tyr/dispatcher", headers=_auth_headers())

        resp = client.patch(
            "/api/v1/tyr/dispatcher",
            json={"max_concurrent_raids": 10},
            headers=_auth_headers(),
        )
        assert resp.status_code == 200
        assert resp.json()["max_concurrent_raids"] == 10

    def test_validates_threshold_range_too_high(self, client: TestClient):
        resp = client.patch(
            "/api/v1/tyr/dispatcher",
            json={"threshold": 1.5},
            headers=_auth_headers(),
        )
        assert resp.status_code == 422

    def test_validates_threshold_range_too_low(self, client: TestClient):
        resp = client.patch(
            "/api/v1/tyr/dispatcher",
            json={"threshold": -0.1},
            headers=_auth_headers(),
        )
        assert resp.status_code == 422

    def test_validates_max_concurrent_raids_too_low(self, client: TestClient):
        resp = client.patch(
            "/api/v1/tyr/dispatcher",
            json={"max_concurrent_raids": 0},
            headers=_auth_headers(),
        )
        assert resp.status_code == 422

    def test_validates_max_concurrent_raids_too_high(self, client: TestClient):
        resp = client.patch(
            "/api/v1/tyr/dispatcher",
            json={"max_concurrent_raids": 21},
            headers=_auth_headers(),
        )
        assert resp.status_code == 422

    def test_empty_body_returns_current_state(self, client: TestClient):
        client.get("/api/v1/tyr/dispatcher", headers=_auth_headers())

        resp = client.patch(
            "/api/v1/tyr/dispatcher",
            json={},
            headers=_auth_headers(),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["running"] is True
        assert data["threshold"] == 0.75
        assert data["max_concurrent_raids"] == 3

    def test_multiple_fields_at_once(self, client: TestClient):
        resp = client.patch(
            "/api/v1/tyr/dispatcher",
            json={"running": False, "threshold": 0.6, "max_concurrent_raids": 7},
            headers=_auth_headers(),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["running"] is False
        assert data["threshold"] == 0.6
        assert data["max_concurrent_raids"] == 7


# -------------------------------------------------------------------
# PostgresDispatcherRepository unit tests
# -------------------------------------------------------------------


class TestPostgresDispatcherRepository:
    def test_row_to_state(self):
        from tyr.adapters.postgres_dispatcher import PostgresDispatcherRepository

        now = datetime.now(UTC)
        uid = uuid4()

        class FakeRow(dict):
            def __getitem__(self, key):
                return super().__getitem__(key)

        row = FakeRow(
            id=uid,
            owner_id="owner-1",
            running=True,
            threshold=0.8,
            max_concurrent_raids=5,
            updated_at=now,
        )

        state = PostgresDispatcherRepository._row_to_state(row)
        assert state.id == uid
        assert state.owner_id == "owner-1"
        assert state.running is True
        assert state.threshold == 0.8
        assert state.max_concurrent_raids == 5
        assert state.updated_at == now
