"""Tests for dispatch REST API endpoints.

Tests the dispatch queue, approve, and config endpoints by
overriding FastAPI dependencies with mock implementations.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tyr.api.dispatch import (
    _build_prompt,
    _is_ready,
    _slugify,
    create_dispatch_router,
    resolve_saga_repo,
    resolve_volundr,
)
from tyr.api.tracker import resolve_trackers
from tyr.config import AIModelConfig, Settings
from tyr.config import DispatchConfig as DispatchCfg
from tyr.domain.models import (
    Saga,
    SagaStatus,
    TrackerIssue,
    TrackerMilestone,
    TrackerProject,
)
from tyr.ports.volundr import SpawnRequest, VolundrPort, VolundrSession

from .test_tracker_api import MockSagaRepo, MockTracker

# -------------------------------------------------------------------
# Mock VolundrPort
# -------------------------------------------------------------------


class MockVolundr(VolundrPort):
    """In-memory mock for Volundr session management."""

    def __init__(self) -> None:
        self.sessions: list[VolundrSession] = []
        self.spawned: list[SpawnRequest] = []
        self.last_auth_token: str | None = None
        self.fail_spawn: bool = False

    async def spawn_session(
        self, request: SpawnRequest, *, auth_token: str | None = None,
    ) -> VolundrSession:
        self.last_auth_token = auth_token
        if self.fail_spawn:
            raise RuntimeError("spawn failed")
        self.spawned.append(request)
        session = VolundrSession(
            id=f"ses-{len(self.spawned)}",
            name=request.name,
            status="running",
            tracker_issue_id=request.tracker_issue_id,
        )
        self.sessions.append(session)
        return session

    async def get_session(
        self, session_id: str, *, auth_token: str | None = None,
    ) -> VolundrSession | None:
        return next(
            (s for s in self.sessions if s.id == session_id),
            None,
        )

    async def list_sessions(
        self, *, auth_token: str | None = None,
    ) -> list[VolundrSession]:
        self.last_auth_token = auth_token
        return list(self.sessions)


# -------------------------------------------------------------------
# Fixtures
# -------------------------------------------------------------------


def _make_settings(**overrides) -> Settings:
    """Build a Settings with dispatch defaults."""
    return Settings(
        dispatch=DispatchCfg(
            default_system_prompt="Be helpful.",
            default_model="claude-sonnet-4-6",
        ),
        ai_models=[
            AIModelConfig(id="claude-sonnet-4-6", name="Sonnet"),
            AIModelConfig(id="claude-opus-4-6", name="Opus"),
        ],
        **overrides,
    )


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
            milestone_count=1,
            issue_count=3,
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
                progress=0.0,
            ),
        ],
    }
    tracker.issues = {
        "proj-1": [
            TrackerIssue(
                id="i-1",
                identifier="ALPHA-1",
                title="Setup CI",
                description="Configure CI pipeline",
                status="Todo",
                priority=1,
                priority_label="Urgent",
                estimate=2.0,
                url="https://linear.app/i-1",
                milestone_id="ms-1",
            ),
            TrackerIssue(
                id="i-2",
                identifier="ALPHA-2",
                title="Add tests",
                description="Write unit tests",
                status="In Progress",
                priority=2,
                priority_label="High",
                url="https://linear.app/i-2",
                milestone_id="ms-1",
            ),
            TrackerIssue(
                id="i-3",
                identifier="ALPHA-3",
                title="Fix bug",
                description="Fix the bug",
                status="Backlog",
                priority=3,
                priority_label="Medium",
                url="https://linear.app/i-3",
                milestone_id="ms-1",
            ),
        ],
    }
    return tracker


@pytest.fixture
def mock_volundr() -> MockVolundr:
    return MockVolundr()


@pytest.fixture
def saga_repo() -> MockSagaRepo:
    repo = MockSagaRepo()
    repo.sagas.append(
        Saga(
            id=uuid4(),
            tracker_id="proj-1",
            tracker_type="linear",
            slug="alpha",
            name="Alpha",
            repos=["org/repo-a", "org/repo-b"],
            feature_branch="feat/alpha",
            status=SagaStatus.ACTIVE,
            confidence=0.0,
            created_at=datetime.now(UTC),
        )
    )
    return repo


@pytest.fixture
def client(
    mock_tracker: MockTracker,
    mock_volundr: MockVolundr,
    saga_repo: MockSagaRepo,
) -> TestClient:
    app = FastAPI()
    app.include_router(create_dispatch_router())
    app.state.settings = _make_settings()
    app.dependency_overrides[resolve_trackers] = lambda: [mock_tracker]
    app.dependency_overrides[resolve_saga_repo] = lambda: saga_repo
    app.dependency_overrides[resolve_volundr] = lambda: mock_volundr
    return TestClient(app)


# -------------------------------------------------------------------
# Unit tests: helper functions
# -------------------------------------------------------------------


class TestIsReady:
    def test_ready_todo(self):
        issue = TrackerIssue(
            id="1",
            identifier="X-1",
            title="t",
            description="",
            status="Todo",
        )
        assert _is_ready(issue, set(), set()) is True

    def test_ready_backlog(self):
        issue = TrackerIssue(
            id="1",
            identifier="X-1",
            title="t",
            description="",
            status="Backlog",
        )
        assert _is_ready(issue, set(), set()) is True

    def test_ready_triage(self):
        issue = TrackerIssue(
            id="1",
            identifier="X-1",
            title="t",
            description="",
            status="Triage",
        )
        assert _is_ready(issue, set(), set()) is True

    def test_not_ready_in_progress(self):
        issue = TrackerIssue(
            id="1",
            identifier="X-1",
            title="t",
            description="",
            status="In Progress",
        )
        assert _is_ready(issue, set(), set()) is False

    def test_not_ready_active_session(self):
        issue = TrackerIssue(
            id="1",
            identifier="X-1",
            title="t",
            description="",
            status="Todo",
        )
        assert _is_ready(issue, {"X-1"}, set()) is False

    def test_not_ready_blocked(self):
        issue = TrackerIssue(
            id="1",
            identifier="X-1",
            title="t",
            description="",
            status="Todo",
        )
        assert _is_ready(issue, set(), {"X-1"}) is False


class TestSlugify:
    def test_simple(self):
        assert _slugify("Hello World") == "hello-world"

    def test_special_chars(self):
        assert _slugify("Fix: bug #123!") == "fix-bug-123"

    def test_truncates_long(self):
        long_text = "a" * 60
        assert len(_slugify(long_text)) <= 40

    def test_strips_leading_trailing_dashes(self):
        assert _slugify("--hello--") == "hello"


class TestBuildPrompt:
    def test_contains_identifier_and_title(self):
        issue = TrackerIssue(
            id="1",
            identifier="X-1",
            title="Setup CI",
            description="Configure pipelines",
            status="Todo",
            url="https://example.com/X-1",
        )
        prompt = _build_prompt(issue, "org/repo", "feat/alpha")
        assert "X-1" in prompt
        assert "Setup CI" in prompt
        assert "Configure pipelines" in prompt
        assert "org/repo" in prompt
        assert "feat/alpha" in prompt

    def test_empty_description(self):
        issue = TrackerIssue(
            id="1",
            identifier="X-2",
            title="No desc",
            description="",
            status="Todo",
        )
        prompt = _build_prompt(issue, "org/repo", "main")
        assert "X-2" in prompt
        assert "No desc" in prompt

    def test_contains_completion_requirements(self):
        issue = TrackerIssue(
            id="1",
            identifier="X-3",
            title="Task",
            description="Do stuff",
            status="Todo",
        )
        prompt = _build_prompt(issue, "org/repo", "feat/test")
        assert "Completion Requirements" in prompt
        assert "In Progress" in prompt
        assert "conventional commits" in prompt


# -------------------------------------------------------------------
# API endpoint tests
# -------------------------------------------------------------------


class TestGetConfig:
    def test_returns_defaults(self, client: TestClient):
        resp = client.get("/api/v1/tyr/dispatch/config")
        assert resp.status_code == 200
        data = resp.json()
        assert data["default_system_prompt"] == "Be helpful."
        assert data["default_model"] == "claude-sonnet-4-6"
        assert len(data["models"]) == 2
        assert data["models"][0]["id"] == "claude-sonnet-4-6"


class TestGetQueue:
    def test_returns_ready_issues(self, client: TestClient):
        resp = client.get("/api/v1/tyr/dispatch/queue")
        assert resp.status_code == 200
        data = resp.json()
        # i-1 (Todo) and i-3 (Backlog) should be ready
        # i-2 (In Progress) should not
        ids = [item["identifier"] for item in data]
        assert "ALPHA-1" in ids
        assert "ALPHA-3" in ids
        assert "ALPHA-2" not in ids

    def test_queue_sorted_by_priority(self, client: TestClient):
        resp = client.get("/api/v1/tyr/dispatch/queue")
        data = resp.json()
        priorities = [item["priority"] for item in data]
        assert priorities == sorted(priorities)

    def test_queue_excludes_active_sessions(
        self,
        mock_tracker: MockTracker,
        saga_repo: MockSagaRepo,
    ):
        volundr = MockVolundr()
        volundr.sessions = [
            VolundrSession(
                id="ses-1",
                name="alpha-1",
                status="running",
                tracker_issue_id="ALPHA-1",
            ),
        ]
        app = FastAPI()
        app.include_router(create_dispatch_router())
        app.state.settings = _make_settings()
        app.dependency_overrides[resolve_trackers] = lambda: [mock_tracker]
        app.dependency_overrides[resolve_saga_repo] = lambda: saga_repo
        app.dependency_overrides[resolve_volundr] = lambda: volundr
        client = TestClient(app)

        resp = client.get("/api/v1/tyr/dispatch/queue")
        data = resp.json()
        ids = [item["identifier"] for item in data]
        assert "ALPHA-1" not in ids
        assert "ALPHA-3" in ids

    def test_queue_excludes_blocked(
        self,
        mock_tracker: MockTracker,
        saga_repo: MockSagaRepo,
        mock_volundr: MockVolundr,
    ):
        mock_tracker._blocked = {"ALPHA-1"}
        app = FastAPI()
        app.include_router(create_dispatch_router())
        app.state.settings = _make_settings()
        app.dependency_overrides[resolve_trackers] = lambda: [mock_tracker]
        app.dependency_overrides[resolve_saga_repo] = lambda: saga_repo
        app.dependency_overrides[resolve_volundr] = lambda: mock_volundr
        client = TestClient(app)

        resp = client.get("/api/v1/tyr/dispatch/queue")
        data = resp.json()
        ids = [item["identifier"] for item in data]
        assert "ALPHA-1" not in ids
        assert "ALPHA-3" in ids

    def test_queue_empty_when_no_sagas(
        self,
        mock_tracker: MockTracker,
        mock_volundr: MockVolundr,
    ):
        app = FastAPI()
        app.include_router(create_dispatch_router())
        app.state.settings = _make_settings()
        app.dependency_overrides[resolve_trackers] = lambda: [mock_tracker]
        app.dependency_overrides[resolve_saga_repo] = lambda: MockSagaRepo()
        app.dependency_overrides[resolve_volundr] = lambda: mock_volundr
        client = TestClient(app)

        resp = client.get("/api/v1/tyr/dispatch/queue")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_queue_forwards_auth_token(
        self,
        mock_tracker: MockTracker,
        saga_repo: MockSagaRepo,
    ):
        volundr = MockVolundr()
        app = FastAPI()
        app.include_router(create_dispatch_router())
        app.state.settings = _make_settings()
        app.dependency_overrides[resolve_trackers] = lambda: [mock_tracker]
        app.dependency_overrides[resolve_saga_repo] = lambda: saga_repo
        app.dependency_overrides[resolve_volundr] = lambda: volundr
        client = TestClient(app)

        resp = client.get(
            "/api/v1/tyr/dispatch/queue",
            headers={"Authorization": "Bearer test-tok"},
        )
        assert resp.status_code == 200
        assert volundr.auth_token == "test-tok"

    def test_queue_item_has_saga_fields(self, client: TestClient, saga_repo: MockSagaRepo):
        resp = client.get("/api/v1/tyr/dispatch/queue")
        data = resp.json()
        item = next(i for i in data if i["identifier"] == "ALPHA-1")
        assert item["saga_name"] == "Alpha"
        assert item["saga_slug"] == "alpha"
        assert item["repos"] == ["org/repo-a", "org/repo-b"]
        assert item["feature_branch"] == "feat/alpha"
        assert item["phase_name"] == "Phase 1"

    def test_queue_handles_tracker_error(
        self,
        saga_repo: MockSagaRepo,
        mock_volundr: MockVolundr,
    ):
        """Queue endpoint gracefully handles tracker failures."""

        class FailingTracker(MockTracker):
            async def get_project_full(self, project_id):
                raise ConnectionError("down")

        app = FastAPI()
        app.include_router(create_dispatch_router())
        app.state.settings = _make_settings()
        app.dependency_overrides[resolve_trackers] = lambda: [FailingTracker()]
        app.dependency_overrides[resolve_saga_repo] = lambda: saga_repo
        app.dependency_overrides[resolve_volundr] = lambda: mock_volundr
        client = TestClient(app)

        resp = client.get("/api/v1/tyr/dispatch/queue")
        assert resp.status_code == 200
        assert resp.json() == []


class TestApproveDispatch:
    def test_spawns_sessions(
        self,
        client: TestClient,
        saga_repo: MockSagaRepo,
        mock_volundr: MockVolundr,
    ):
        saga_id = str(saga_repo.sagas[0].id)
        resp = client.post(
            "/api/v1/tyr/dispatch/approve",
            json={
                "items": [
                    {
                        "saga_id": saga_id,
                        "issue_id": "i-1",
                        "repo": "org/repo-a",
                    },
                ],
                "model": "claude-opus-4-6",
                "system_prompt": "Custom prompt.",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["status"] == "spawned"
        assert data[0]["session_id"] == "ses-1"
        assert data[0]["session_name"] == "alpha-1"

        # Verify spawn request details
        assert len(mock_volundr.spawned) == 1
        req = mock_volundr.spawned[0]
        assert req.model == "claude-opus-4-6"
        assert req.system_prompt == "Custom prompt."
        assert req.repo == "org/repo-a"
        assert req.branch == "feat/alpha"
        assert req.tracker_issue_id == "ALPHA-1"

    def test_uses_server_defaults(
        self,
        client: TestClient,
        saga_repo: MockSagaRepo,
        mock_volundr: MockVolundr,
    ):
        saga_id = str(saga_repo.sagas[0].id)
        resp = client.post(
            "/api/v1/tyr/dispatch/approve",
            json={
                "items": [
                    {
                        "saga_id": saga_id,
                        "issue_id": "i-1",
                        "repo": "org/repo-a",
                    },
                ],
            },
        )
        assert resp.status_code == 200
        req = mock_volundr.spawned[0]
        assert req.model == "claude-sonnet-4-6"
        assert req.system_prompt == "Be helpful."

    def test_skips_unknown_saga(
        self,
        client: TestClient,
        mock_volundr: MockVolundr,
    ):
        resp = client.post(
            "/api/v1/tyr/dispatch/approve",
            json={
                "items": [
                    {
                        "saga_id": str(uuid4()),
                        "issue_id": "i-1",
                        "repo": "org/repo-a",
                    },
                ],
            },
        )
        assert resp.status_code == 200
        assert resp.json() == []
        assert len(mock_volundr.spawned) == 0

    def test_skips_unknown_issue(
        self,
        client: TestClient,
        saga_repo: MockSagaRepo,
        mock_volundr: MockVolundr,
    ):
        saga_id = str(saga_repo.sagas[0].id)
        resp = client.post(
            "/api/v1/tyr/dispatch/approve",
            json={
                "items": [
                    {
                        "saga_id": saga_id,
                        "issue_id": "nonexistent",
                        "repo": "org/repo-a",
                    },
                ],
            },
        )
        assert resp.status_code == 200
        assert resp.json() == []

    def test_spawn_failure_returns_failed(
        self,
        saga_repo: MockSagaRepo,
        mock_tracker: MockTracker,
    ):
        volundr = MockVolundr()
        volundr.fail_spawn = True

        app = FastAPI()
        app.include_router(create_dispatch_router())
        app.state.settings = _make_settings()
        app.dependency_overrides[resolve_trackers] = lambda: [mock_tracker]
        app.dependency_overrides[resolve_saga_repo] = lambda: saga_repo
        app.dependency_overrides[resolve_volundr] = lambda: volundr
        client = TestClient(app)

        saga_id = str(saga_repo.sagas[0].id)
        resp = client.post(
            "/api/v1/tyr/dispatch/approve",
            json={
                "items": [
                    {
                        "saga_id": saga_id,
                        "issue_id": "i-1",
                        "repo": "org/repo-a",
                    },
                ],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["status"] == "failed"
        assert data[0]["session_id"] == ""

    def test_approve_forwards_auth_token(
        self,
        saga_repo: MockSagaRepo,
        mock_tracker: MockTracker,
    ):
        volundr = MockVolundr()
        app = FastAPI()
        app.include_router(create_dispatch_router())
        app.state.settings = _make_settings()
        app.dependency_overrides[resolve_trackers] = lambda: [mock_tracker]
        app.dependency_overrides[resolve_saga_repo] = lambda: saga_repo
        app.dependency_overrides[resolve_volundr] = lambda: volundr
        client = TestClient(app)

        saga_id = str(saga_repo.sagas[0].id)
        client.post(
            "/api/v1/tyr/dispatch/approve",
            json={
                "items": [
                    {
                        "saga_id": saga_id,
                        "issue_id": "i-1",
                        "repo": "org/repo-a",
                    },
                ],
            },
            headers={"Authorization": "Bearer my-token"},
        )
        assert volundr.auth_token == "my-token"

    def test_multiple_items(
        self,
        client: TestClient,
        saga_repo: MockSagaRepo,
        mock_volundr: MockVolundr,
    ):
        saga_id = str(saga_repo.sagas[0].id)
        resp = client.post(
            "/api/v1/tyr/dispatch/approve",
            json={
                "items": [
                    {
                        "saga_id": saga_id,
                        "issue_id": "i-1",
                        "repo": "org/repo-a",
                    },
                    {
                        "saga_id": saga_id,
                        "issue_id": "i-3",
                        "repo": "org/repo-b",
                    },
                ],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert all(d["status"] == "spawned" for d in data)
        assert len(mock_volundr.spawned) == 2
