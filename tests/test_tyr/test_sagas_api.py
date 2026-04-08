"""Tests for saga REST API endpoints."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tyr.api.sagas import create_sagas_router, resolve_saga_repo
from tyr.api.tracker import resolve_trackers
from tyr.config import AuthConfig
from tyr.domain.models import (
    Saga,
    SagaStatus,
    TrackerIssue,
    TrackerMilestone,
    TrackerProject,
)

from .test_tracker_api import MockSagaRepo, MockTracker


def _dev_settings() -> MagicMock:
    """Create mock settings with anonymous dev enabled for test apps."""
    s = MagicMock()
    s.auth = AuthConfig(allow_anonymous_dev=True)
    return s


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
            feature_branch="feat/alpha",
            status=SagaStatus.ACTIVE,
            confidence=0.0,
            created_at=datetime.now(UTC),
            base_branch="dev",
            owner_id="dev-user",
        )
    )
    return repo


@pytest.fixture
def client(mock_tracker: MockTracker, saga_repo: MockSagaRepo) -> TestClient:
    app = FastAPI()
    app.include_router(create_sagas_router())
    app.dependency_overrides[resolve_trackers] = lambda: [mock_tracker]
    app.dependency_overrides[resolve_saga_repo] = lambda: saga_repo
    app.state.settings = _dev_settings()
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
        app.state.settings = _dev_settings()
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


class TestGetSagaErrors:
    def test_tracker_unavailable_returns_degraded_response(self, saga_repo: MockSagaRepo):
        """Returns 200 with empty tracker data when tracker is unavailable."""

        class FailingTracker(MockTracker):
            async def get_project(self, project_id: str) -> TrackerProject:
                raise ConnectionError("Tracker down")

            async def get_project_full(self, project_id: str):
                raise ConnectionError("Tracker down")

        app = FastAPI()
        app.include_router(create_sagas_router())
        failing = FailingTracker()
        app.dependency_overrides[resolve_trackers] = lambda: [failing]
        app.dependency_overrides[resolve_saga_repo] = lambda: saga_repo
        app.state.settings = _dev_settings()
        client = TestClient(app)

        saga_id = str(saga_repo.sagas[0].id)
        resp = client.get(f"/api/v1/tyr/sagas/{saga_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["phases"] == []

    def test_list_with_tracker_error(self, saga_repo: MockSagaRepo):
        """List sagas gracefully handles tracker errors."""

        class FailingTracker(MockTracker):
            async def list_projects(self) -> list[TrackerProject]:
                raise ConnectionError("Tracker down")

        app = FastAPI()
        app.include_router(create_sagas_router())
        failing = FailingTracker()
        app.dependency_overrides[resolve_trackers] = lambda: [failing]
        app.dependency_overrides[resolve_saga_repo] = lambda: saga_repo
        app.state.settings = _dev_settings()
        client = TestClient(app)

        resp = client.get("/api/v1/tyr/sagas")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        # Falls back to DB name
        assert data[0]["name"] == "Alpha"


class TestDeleteSaga:
    def test_delete_existing(self, client: TestClient, saga_repo: MockSagaRepo):
        saga_id = str(saga_repo.sagas[0].id)
        resp = client.delete(f"/api/v1/tyr/sagas/{saga_id}")
        assert resp.status_code == 204
        assert len(saga_repo.sagas) == 0

    def test_delete_not_found(self, client: TestClient):
        resp = client.delete(f"/api/v1/tyr/sagas/{uuid4()}")
        assert resp.status_code == 404


class TestExtractStructure:
    """Tests for the POST /sagas/extract-structure endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        app = FastAPI()
        app.state.settings = _dev_settings()
        app.include_router(create_sagas_router())
        return TestClient(app)

    def test_extracts_valid_structure_from_json_block(self, client: TestClient):
        text = (
            "Here is the plan:\n"
            "```json\n"
            '{"name": "Auth Refactor", "phases": [{"name": "Phase 1", "raids": [{'
            '"name": "Setup", "description": "Set up auth", '
            '"acceptance_criteria": ["AC1"], "declared_files": ["src/auth.py"], '
            '"estimate_hours": 4, "confidence": 0.8}]}]}\n'
            "```"
        )
        resp = client.post("/api/v1/tyr/sagas/extract-structure", json={"text": text})
        assert resp.status_code == 200
        data = resp.json()
        assert data["found"] is True
        assert data["structure"]["name"] == "Auth Refactor"
        assert len(data["structure"]["phases"]) == 1
        assert data["structure"]["phases"][0]["raids"][0]["name"] == "Setup"

    def test_returns_not_found_for_plain_text(self, client: TestClient):
        resp = client.post(
            "/api/v1/tyr/sagas/extract-structure",
            json={"text": "Just a regular message with no JSON."},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["found"] is False
        assert data["structure"] is None

    def test_returns_not_found_for_invalid_json(self, client: TestClient):
        text = "```json\n{not valid json}\n```"
        resp = client.post("/api/v1/tyr/sagas/extract-structure", json={"text": text})
        assert resp.status_code == 200
        data = resp.json()
        assert data["found"] is False

    def test_returns_not_found_for_json_missing_required_fields(self, client: TestClient):
        text = '```json\n{"key": "value"}\n```'
        resp = client.post("/api/v1/tyr/sagas/extract-structure", json={"text": text})
        assert resp.status_code == 200
        data = resp.json()
        assert data["found"] is False

    def test_rejects_empty_text(self, client: TestClient):
        resp = client.post("/api/v1/tyr/sagas/extract-structure", json={"text": ""})
        assert resp.status_code == 422


class TestUpdateSaga:
    def test_updates_status_returns_saga(
        self, client: TestClient, saga_repo: MockSagaRepo
    ):
        saga_id = str(saga_repo.sagas[0].id)
        resp = client.patch(
            f"/api/v1/tyr/sagas/{saga_id}", json={"status": "COMPLETE"}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == saga_id
        assert data["slug"] == "alpha"

    def test_lowercase_status_accepted(
        self, client: TestClient, saga_repo: MockSagaRepo
    ):
        saga_id = str(saga_repo.sagas[0].id)
        resp = client.patch(
            f"/api/v1/tyr/sagas/{saga_id}", json={"status": "complete"}
        )
        assert resp.status_code == 200

    def test_invalid_status_returns_422(
        self, client: TestClient, saga_repo: MockSagaRepo
    ):
        saga_id = str(saga_repo.sagas[0].id)
        resp = client.patch(
            f"/api/v1/tyr/sagas/{saga_id}", json={"status": "INVALID_STATUS"}
        )
        assert resp.status_code == 422

    def test_not_found_returns_404(self, client: TestClient):
        resp = client.patch(
            f"/api/v1/tyr/sagas/{uuid4()}", json={"status": "COMPLETE"}
        )
        assert resp.status_code == 404
