"""Tests for saga REST API endpoints."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tyr.api.sagas import create_sagas_router, resolve_saga_repo
from tyr.api.tracker import resolve_trackers
from tyr.domain.models import (
    Saga,
    SagaStatus,
    TrackerIssue,
    TrackerMilestone,
    TrackerProject,
)
from tyr.ports.saga_repository import SagaRepository
from tyr.ports.tracker import TrackerPort

from .test_tracker_api import MockSagaRepo, MockTracker


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_tracker() -> MockTracker:
    tracker = MockTracker()
    tracker.projects = [
        TrackerProject(
            id="proj-1",
            name="Alpha",
            description="First project",
            status="started",
            url="https://linear.app/test/project/alpha-abc123",
            milestone_count=2,
            issue_count=3,
            slug="alpha",
            progress=0.5,
        ),
    ]
    tracker.milestones = {
        "proj-1": [
            TrackerMilestone(
                id="ms-1",
                project_id="proj-1",
                name="Phase 1",
                description="First phase",
                sort_order=1,
                progress=1.0,
            ),
            TrackerMilestone(
                id="ms-2",
                project_id="proj-1",
                name="Phase 2",
                description="Second phase",
                sort_order=2,
                progress=0.0,
            ),
        ],
    }
    tracker.issues = {
        "proj-1": [
            TrackerIssue(
                id="i-1",
                identifier="A-1",
                title="Done task",
                description="",
                status="Done",
                status_type="completed",
            ),
            TrackerIssue(
                id="i-2",
                identifier="A-2",
                title="Open task",
                description="",
                status="Todo",
                status_type="unstarted",
                milestone_id="ms-1",
            ),
            TrackerIssue(
                id="i-3",
                identifier="A-3",
                title="In progress",
                description="",
                status="In Progress",
                status_type="started",
                milestone_id="ms-2",
            ),
        ],
    }
    return tracker


@pytest.fixture
def saga_repo() -> MockSagaRepo:
    repo = MockSagaRepo()
    repo.sagas.append(
        Saga(
            id=uuid4(),
            tracker_id="proj-1",
            tracker_type="mock",
            slug="alpha",
            name="Alpha",
            repos=["org/repo"],
            status=SagaStatus.ACTIVE,
            confidence=0.0,
            created_at=datetime.now(UTC),
        )
    )
    return repo


@pytest.fixture
def client(mock_tracker: MockTracker, saga_repo: MockSagaRepo) -> TestClient:
    app = FastAPI()
    app.include_router(create_sagas_router())
    app.dependency_overrides[resolve_trackers] = lambda: [mock_tracker]
    app.dependency_overrides[resolve_saga_repo] = lambda: saga_repo
    return TestClient(app)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestListSagas:
    def test_returns_sagas_with_tracker_data(self, client: TestClient):
        resp = client.get("/api/v1/tyr/sagas")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        saga = data[0]
        assert saga["name"] == "Alpha"
        assert saga["tracker_id"] == "proj-1"
        assert saga["repos"] == ["org/repo"]
        assert saga["milestone_count"] == 2
        assert saga["issue_count"] == 3
        assert saga["status"] == "started"
        assert saga["url"] == "https://linear.app/test/project/alpha-abc123"

    def test_empty_when_no_sagas(self, mock_tracker: MockTracker):
        app = FastAPI()
        app.include_router(create_sagas_router())
        app.dependency_overrides[resolve_trackers] = lambda: [mock_tracker]
        app.dependency_overrides[resolve_saga_repo] = lambda: MockSagaRepo()
        client = TestClient(app)
        resp = client.get("/api/v1/tyr/sagas")
        assert resp.status_code == 200
        assert resp.json() == []


class TestGetSaga:
    def test_returns_detail_with_phases(self, client: TestClient, saga_repo: MockSagaRepo):
        saga_id = str(saga_repo.sagas[0].id)
        resp = client.get(f"/api/v1/tyr/sagas/{saga_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Alpha"
        assert data["description"] == "First project"
        assert len(data["phases"]) == 3  # 2 milestones + unassigned
        assert data["phases"][0]["name"] == "Phase 1"
        assert data["phases"][1]["name"] == "Phase 2"
        assert data["phases"][2]["name"] == "Unassigned"

    def test_phases_contain_raids(self, client: TestClient, saga_repo: MockSagaRepo):
        saga_id = str(saga_repo.sagas[0].id)
        resp = client.get(f"/api/v1/tyr/sagas/{saga_id}")
        data = resp.json()
        # ms-1 has i-2
        assert len(data["phases"][0]["raids"]) == 1
        assert data["phases"][0]["raids"][0]["identifier"] == "A-2"
        # ms-2 has i-3
        assert len(data["phases"][1]["raids"]) == 1
        # unassigned has i-1
        assert len(data["phases"][2]["raids"]) == 1

    def test_not_found(self, client: TestClient):
        resp = client.get(f"/api/v1/tyr/sagas/{uuid4()}")
        assert resp.status_code == 404


class TestDeleteSaga:
    def test_delete_existing(self, client: TestClient, saga_repo: MockSagaRepo):
        saga_id = str(saga_repo.sagas[0].id)
        resp = client.delete(f"/api/v1/tyr/sagas/{saga_id}")
        assert resp.status_code == 204
        assert len(saga_repo.sagas) == 0

    def test_delete_not_found(self, client: TestClient):
        resp = client.delete(f"/api/v1/tyr/sagas/{uuid4()}")
        assert resp.status_code == 404
