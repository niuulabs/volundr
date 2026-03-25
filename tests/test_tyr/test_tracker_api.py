"""Tests for tracker REST API endpoints.

Tests the tracker browsing endpoints by overriding the
_resolve_tracker_adapters FastAPI dependency with a mock TrackerPort.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tyr.api.tracker import create_tracker_router, resolve_trackers
from tyr.config import AuthConfig
from tyr.domain.models import (
    Phase,
    PhaseStatus,
    Raid,
    RaidStatus,
    Saga,
    SagaStatus,
    TrackerIssue,
    TrackerMilestone,
    TrackerProject,
)
from tyr.ports.saga_repository import SagaRepository
from tyr.ports.tracker import TrackerPort

# ---------------------------------------------------------------------------
# Mock TrackerPort implementation
# ---------------------------------------------------------------------------


class MockTracker(TrackerPort):
    """In-memory mock tracker for API tests."""

    def __init__(self) -> None:
        self.projects: list[TrackerProject] = []
        self.milestones: dict[str, list[TrackerMilestone]] = {}
        self.issues: dict[str, list[TrackerIssue]] = {}

    async def create_saga(self, saga: Saga) -> str:
        return "saga-created"

    async def create_phase(self, phase: Phase) -> str:
        return "phase-created"

    async def create_raid(self, raid: Raid) -> str:
        return "raid-created"

    async def update_raid_state(self, raid_id: str, state: RaidStatus) -> None:
        pass

    async def close_raid(self, raid_id: str) -> None:
        pass

    async def get_saga(self, saga_id: str) -> Saga:
        now = datetime.now(UTC)
        return Saga(
            id=uuid4(),
            tracker_id=saga_id,
            tracker_type="mock",
            slug="test",
            name="Test",
            repos=[],
            feature_branch="feat/test",
            status=SagaStatus.ACTIVE,
            confidence=0.0,
            created_at=now,
        )

    async def get_phase(self, tracker_id: str) -> Phase:
        return Phase(
            id=uuid4(),
            saga_id=UUID(int=0),
            tracker_id=tracker_id,
            number=1,
            name="P1",
            status=PhaseStatus.PENDING,
            confidence=0.0,
        )

    async def get_raid(self, tracker_id: str) -> Raid:
        now = datetime.now(UTC)
        return Raid(
            id=uuid4(),
            phase_id=UUID(int=0),
            tracker_id=tracker_id,
            name="R1",
            description="",
            acceptance_criteria=[],
            declared_files=[],
            estimate_hours=None,
            status=RaidStatus.PENDING,
            confidence=0.0,
            session_id=None,
            branch=None,
            chronicle_summary=None,
            pr_url=None,
            pr_id=None,
            retry_count=0,
            created_at=now,
            updated_at=now,
        )

    async def list_pending_raids(self, phase_id: str) -> list[Raid]:
        return []

    async def list_projects(self) -> list[TrackerProject]:
        return self.projects

    async def get_project(self, project_id: str) -> TrackerProject:
        for p in self.projects:
            if p.id == project_id:
                return p
        raise ValueError(f"Project not found: {project_id}")

    async def list_milestones(self, project_id: str) -> list[TrackerMilestone]:
        return self.milestones.get(project_id, [])

    async def list_issues(
        self,
        project_id: str,
        milestone_id: str | None = None,
    ) -> list[TrackerIssue]:
        issues = self.issues.get(project_id, [])
        if milestone_id:
            issues = [i for i in issues if i.milestone_id == milestone_id]
        return issues

    async def get_project_full(
        self, project_id: str
    ) -> tuple[TrackerProject, list[TrackerMilestone], list[TrackerIssue]]:
        project = await self.get_project(project_id)
        milestones = await self.list_milestones(project_id)
        issues = await self.list_issues(project_id)
        return project, milestones, issues

    async def get_blocked_identifiers(self, project_id: str) -> set[str]:
        return getattr(self, "_blocked", set())


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
            url="https://linear.app/proj-1",
            milestone_count=2,
            issue_count=5,
        ),
        TrackerProject(
            id="proj-2",
            name="Beta",
            description="Second project",
            status="planned",
            url="https://linear.app/proj-2",
            milestone_count=0,
            issue_count=0,
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
                progress=0.5,
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
                identifier="ALPHA-1",
                title="Setup",
                description="Initial setup",
                status="Todo",
                assignee="Dev",
                labels=["setup"],
                priority=1,
                url="https://linear.app/i-1",
                milestone_id="ms-1",
            ),
            TrackerIssue(
                id="i-2",
                identifier="ALPHA-2",
                title="Build",
                description="Build things",
                status="In Progress",
                assignee=None,
                labels=[],
                priority=2,
                url="https://linear.app/i-2",
                milestone_id="ms-2",
            ),
        ],
    }
    return tracker


class MockSagaRepo(SagaRepository):
    """In-memory saga repository for tests."""

    def __init__(self) -> None:
        self.sagas: list[Saga] = []

    async def save_saga(self, saga: Saga, *, conn=None) -> None:  # noqa: ANN001
        self.sagas.append(saga)

    async def get_saga_by_slug(self, slug: str) -> Saga | None:
        return next((s for s in self.sagas if s.slug == slug), None)

    async def list_sagas(self, *, owner_id: str | None = None) -> list[Saga]:
        return list(self.sagas)

    async def get_saga(self, saga_id, *, owner_id: str | None = None) -> Saga | None:
        return next((s for s in self.sagas if s.id == saga_id), None)

    async def delete_saga(self, saga_id, *, owner_id=None) -> bool:
        before = len(self.sagas)
        self.sagas = [
            s
            for s in self.sagas
            if not (s.id == saga_id and (owner_id is None or s.owner_id == owner_id))
        ]
        return len(self.sagas) < before


@pytest.fixture
def client(mock_tracker: MockTracker) -> TestClient:
    app = FastAPI()
    app.include_router(create_tracker_router())
    app.dependency_overrides[resolve_trackers] = lambda: [mock_tracker]
    app.state.saga_repo = MockSagaRepo()
    mock_settings = MagicMock()
    mock_settings.auth = AuthConfig(allow_anonymous_dev=True)
    app.state.settings = mock_settings
    return TestClient(app)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestListProjects:
    def test_returns_all(self, client: TestClient):
        resp = client.get("/api/v1/tyr/tracker/projects")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["id"] == "proj-1"
        assert data[1]["id"] == "proj-2"


class TestGetProject:
    def test_found(self, client: TestClient):
        resp = client.get("/api/v1/tyr/tracker/projects/proj-1")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == "proj-1"
        assert data["name"] == "Alpha"

    def test_not_found(self, client: TestClient):
        resp = client.get("/api/v1/tyr/tracker/projects/nonexistent")
        assert resp.status_code == 404


class TestListMilestones:
    def test_returns_milestones(self, client: TestClient):
        resp = client.get("/api/v1/tyr/tracker/projects/proj-1/milestones")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["name"] == "Phase 1"

    def test_empty_milestones(self, client: TestClient):
        resp = client.get("/api/v1/tyr/tracker/projects/proj-2/milestones")
        assert resp.status_code == 200
        assert resp.json() == []


class TestListIssues:
    def test_all_issues(self, client: TestClient):
        resp = client.get("/api/v1/tyr/tracker/projects/proj-1/issues")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2

    def test_filtered_by_milestone(self, client: TestClient):
        resp = client.get("/api/v1/tyr/tracker/projects/proj-1/issues?milestone_id=ms-1")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["identifier"] == "ALPHA-1"

    def test_no_matching_milestone(self, client: TestClient):
        resp = client.get("/api/v1/tyr/tracker/projects/proj-1/issues?milestone_id=nonexistent")
        assert resp.status_code == 200
        assert resp.json() == []


class TestImportProject:
    def test_success(self, client: TestClient):
        resp = client.post(
            "/api/v1/tyr/tracker/import",
            json={
                "project_id": "proj-1",
                "repos": ["org/repo"],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["tracker_id"] == "proj-1"
        assert data["name"] == "Alpha"
        assert data["repos"] == ["org/repo"]
        assert data["feature_branch"] == "feat/alpha"
        assert data["status"] == "ACTIVE"
        assert data["phase_count"] == 2
        assert data["raid_count"] == 5

    def test_project_not_found(self, client: TestClient):
        resp = client.post(
            "/api/v1/tyr/tracker/import",
            json={
                "project_id": "nonexistent",
                "repos": ["org/repo"],
            },
        )
        assert resp.status_code == 404
