"""Tests for DispatchService — domain service for dispatch logic.

Tests the service directly without any HTTP context, verifying that
find_ready_issues and dispatch_issues behave correctly.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest

from tyr.domain.models import (
    Saga,
    SagaStatus,
    TrackerIssue,
    TrackerMilestone,
    TrackerProject,
)
from tyr.domain.services.dispatch_service import (
    DispatchConfig,
    DispatchItem,
    DispatchService,
    build_prompt,
    is_ready,
    resolve_target_adapter,
)

from ..test_dispatch_api import (
    MockDispatcherRepo,
    MockTrackerFactory,
    MockVolundr,
    MockVolundrFactory,
)
from ..test_tracker_api import MockSagaRepo, MockTracker

# -------------------------------------------------------------------
# Fixtures
# -------------------------------------------------------------------


def _make_tracker() -> MockTracker:
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


def _make_saga() -> Saga:
    return Saga(
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
        base_branch="dev",
    )


@pytest.fixture
def tracker() -> MockTracker:
    return _make_tracker()


@pytest.fixture
def volundr() -> MockVolundr:
    return MockVolundr()


@pytest.fixture
def saga_repo() -> MockSagaRepo:
    repo = MockSagaRepo()
    repo.sagas.append(_make_saga())
    return repo


@pytest.fixture
def dispatcher_repo() -> MockDispatcherRepo:
    return MockDispatcherRepo()


@pytest.fixture
def service(
    tracker: MockTracker,
    volundr: MockVolundr,
    saga_repo: MockSagaRepo,
    dispatcher_repo: MockDispatcherRepo,
) -> DispatchService:
    return DispatchService(
        tracker_factory=MockTrackerFactory([tracker]),
        volundr_factory=MockVolundrFactory(adapters=[volundr]),
        saga_repo=saga_repo,
        dispatcher_repo=dispatcher_repo,
        config=DispatchConfig(
            default_system_prompt="Be helpful.",
            default_model="claude-sonnet-4-6",
        ),
    )


# -------------------------------------------------------------------
# Unit tests: pure helpers
# -------------------------------------------------------------------


class TestIsReady:
    def test_ready_todo(self):
        issue = TrackerIssue(id="1", identifier="X-1", title="t", description="", status="Todo")
        assert is_ready(issue, set(), set()) is True

    def test_ready_backlog(self):
        issue = TrackerIssue(id="1", identifier="X-1", title="t", description="", status="Backlog")
        assert is_ready(issue, set(), set()) is True

    def test_ready_triage(self):
        issue = TrackerIssue(id="1", identifier="X-1", title="t", description="", status="Triage")
        assert is_ready(issue, set(), set()) is True

    def test_not_ready_in_progress(self):
        issue = TrackerIssue(
            id="1", identifier="X-1", title="t", description="", status="In Progress"
        )
        assert is_ready(issue, set(), set()) is False

    def test_not_ready_active_session(self):
        issue = TrackerIssue(id="1", identifier="X-1", title="t", description="", status="Todo")
        assert is_ready(issue, {"X-1"}, set()) is False

    def test_not_ready_blocked(self):
        issue = TrackerIssue(id="1", identifier="X-1", title="t", description="", status="Todo")
        assert is_ready(issue, set(), {"X-1"}) is False


class TestBuildPrompt:
    def test_fallback_contains_essentials(self):
        issue = TrackerIssue(
            id="1", identifier="X-3", title="Task", description="Do stuff", status="Todo"
        )
        prompt = build_prompt(issue, "org/repo", "feat/test")
        assert "feat/test" in prompt
        assert "x-3" in prompt
        assert "org/repo" in prompt

    def test_template_renders_placeholders(self):
        issue = TrackerIssue(
            id="1",
            identifier="NIU-42",
            title="Add auth",
            description="Implement OAuth",
            status="Todo",
        )
        template = (
            "Task: {identifier} — {title}\n{description}\n"
            "Branch: {raid_branch}\nPR target: {feature_branch}"
        )
        prompt = build_prompt(issue, "org/repo", "feat/saga", template=template)
        assert "NIU-42" in prompt
        assert "Add auth" in prompt
        assert "niu-42" in prompt


class TestResolveTargetAdapter:
    def test_no_connection_id_returns_fallback(self):
        fallback = MockVolundr()
        assert resolve_target_adapter(None, {}, fallback) is fallback

    def test_matching_returns_adapter(self):
        fallback = MockVolundr()
        target = MockVolundr()
        assert resolve_target_adapter("a", {"a": target}, fallback) is target

    def test_unknown_returns_fallback(self):
        fallback = MockVolundr()
        assert resolve_target_adapter("b", {"a": MockVolundr()}, fallback) is fallback


# -------------------------------------------------------------------
# Service tests: find_ready_issues
# -------------------------------------------------------------------


class TestFindReadyIssues:
    @pytest.mark.asyncio
    async def test_returns_ready_issues(self, service: DispatchService):
        items = await service.find_ready_issues("dev-user")
        ids = [i.identifier for i in items]
        assert "ALPHA-1" in ids
        assert "ALPHA-3" in ids
        assert "ALPHA-2" not in ids

    @pytest.mark.asyncio
    async def test_sorted_by_priority(self, service: DispatchService):
        items = await service.find_ready_issues("dev-user")
        priorities = [i.priority for i in items]
        assert priorities == sorted(priorities)

    @pytest.mark.asyncio
    async def test_excludes_active_sessions(
        self,
        tracker: MockTracker,
        saga_repo: MockSagaRepo,
        dispatcher_repo: MockDispatcherRepo,
    ):
        from tyr.ports.volundr import VolundrSession

        volundr = MockVolundr()
        volundr.sessions = [
            VolundrSession(
                id="ses-1",
                name="alpha-1",
                status="running",
                tracker_issue_id="ALPHA-1",
            ),
        ]
        svc = DispatchService(
            tracker_factory=MockTrackerFactory([tracker]),
            volundr_factory=MockVolundrFactory(adapters=[volundr]),
            saga_repo=saga_repo,
            dispatcher_repo=dispatcher_repo,
            config=DispatchConfig(),
        )
        items = await svc.find_ready_issues("dev-user")
        ids = [i.identifier for i in items]
        assert "ALPHA-1" not in ids
        assert "ALPHA-3" in ids

    @pytest.mark.asyncio
    async def test_excludes_blocked(
        self,
        tracker: MockTracker,
        service: DispatchService,
    ):
        tracker._blocked = {"ALPHA-1"}
        items = await service.find_ready_issues("dev-user")
        ids = [i.identifier for i in items]
        assert "ALPHA-1" not in ids
        assert "ALPHA-3" in ids

    @pytest.mark.asyncio
    async def test_empty_when_no_sagas(
        self,
        tracker: MockTracker,
        volundr: MockVolundr,
        dispatcher_repo: MockDispatcherRepo,
    ):
        svc = DispatchService(
            tracker_factory=MockTrackerFactory([tracker]),
            volundr_factory=MockVolundrFactory(adapters=[volundr]),
            saga_repo=MockSagaRepo(),
            dispatcher_repo=dispatcher_repo,
            config=DispatchConfig(),
        )
        items = await svc.find_ready_issues("dev-user")
        assert items == []

    @pytest.mark.asyncio
    async def test_empty_when_no_volundr(
        self,
        tracker: MockTracker,
        saga_repo: MockSagaRepo,
        dispatcher_repo: MockDispatcherRepo,
    ):
        svc = DispatchService(
            tracker_factory=MockTrackerFactory([tracker]),
            volundr_factory=MockVolundrFactory(adapters=[]),
            saga_repo=saga_repo,
            dispatcher_repo=dispatcher_repo,
            config=DispatchConfig(),
        )
        items = await svc.find_ready_issues("dev-user")
        assert items == []

    @pytest.mark.asyncio
    async def test_scoped_to_saga_tracker_id(
        self,
        tracker: MockTracker,
        volundr: MockVolundr,
        dispatcher_repo: MockDispatcherRepo,
    ):
        """When saga_tracker_id is given, only that saga is queried."""
        repo = MockSagaRepo()
        saga1 = _make_saga()
        repo.sagas.append(saga1)
        repo.sagas.append(
            Saga(
                id=uuid4(),
                tracker_id="proj-other",
                tracker_type="linear",
                slug="beta",
                name="Beta",
                repos=["org/repo-b"],
                feature_branch="feat/beta",
                status=SagaStatus.ACTIVE,
                confidence=0.0,
                created_at=datetime.now(UTC),
                base_branch="main",
            )
        )
        svc = DispatchService(
            tracker_factory=MockTrackerFactory([tracker]),
            volundr_factory=MockVolundrFactory(adapters=[volundr]),
            saga_repo=repo,
            dispatcher_repo=dispatcher_repo,
            config=DispatchConfig(),
        )
        items = await svc.find_ready_issues("dev-user", saga_tracker_id="proj-1")
        assert len(items) > 0
        assert all(i.saga_id == str(saga1.id) for i in items)

    @pytest.mark.asyncio
    async def test_handles_tracker_error(
        self,
        volundr: MockVolundr,
        saga_repo: MockSagaRepo,
        dispatcher_repo: MockDispatcherRepo,
    ):
        class FailingTracker(MockTracker):
            async def get_project_full(self, project_id):
                raise ConnectionError("down")

        svc = DispatchService(
            tracker_factory=MockTrackerFactory([FailingTracker()]),
            volundr_factory=MockVolundrFactory(adapters=[volundr]),
            saga_repo=saga_repo,
            dispatcher_repo=dispatcher_repo,
            config=DispatchConfig(),
        )
        items = await svc.find_ready_issues("dev-user")
        assert items == []

    @pytest.mark.asyncio
    async def test_queue_item_has_saga_fields(self, service: DispatchService):
        items = await service.find_ready_issues("dev-user")
        item = next(i for i in items if i.identifier == "ALPHA-1")
        assert item.saga_name == "Alpha"
        assert item.saga_slug == "alpha"
        assert item.repos == ["org/repo-a", "org/repo-b"]
        assert item.feature_branch == "feat/alpha"
        assert item.phase_name == "Phase 1"


# -------------------------------------------------------------------
# Service tests: dispatch_issues
# -------------------------------------------------------------------


class TestDispatchIssues:
    @pytest.mark.asyncio
    async def test_spawns_sessions(
        self,
        service: DispatchService,
        saga_repo: MockSagaRepo,
        volundr: MockVolundr,
    ):
        saga_id = str(saga_repo.sagas[0].id)
        results = await service.dispatch_issues(
            owner_id="dev-user",
            items=[DispatchItem(saga_id=saga_id, issue_id="i-1", repo="org/repo-a")],
            model="claude-opus-4-6",
            system_prompt="Custom prompt.",
        )
        assert len(results) == 1
        assert results[0].status == "spawned"
        assert results[0].session_id == "ses-1"
        assert results[0].session_name == "alpha-1"

        assert len(volundr.spawned) == 1
        req = volundr.spawned[0]
        assert req.model == "claude-opus-4-6"
        assert req.system_prompt == "Custom prompt."
        assert req.repo == "org/repo-a"
        assert req.branch == "feat/alpha"
        assert req.tracker_issue_id == "ALPHA-1"

    @pytest.mark.asyncio
    async def test_uses_config_defaults(
        self,
        service: DispatchService,
        saga_repo: MockSagaRepo,
        volundr: MockVolundr,
    ):
        saga_id = str(saga_repo.sagas[0].id)
        await service.dispatch_issues(
            owner_id="dev-user",
            items=[DispatchItem(saga_id=saga_id, issue_id="i-1", repo="org/repo-a")],
        )
        req = volundr.spawned[0]
        assert req.model == "claude-sonnet-4-6"
        assert req.system_prompt == "Be helpful."

    @pytest.mark.asyncio
    async def test_skips_unknown_saga(
        self,
        service: DispatchService,
        volundr: MockVolundr,
    ):
        results = await service.dispatch_issues(
            owner_id="dev-user",
            items=[DispatchItem(saga_id=str(uuid4()), issue_id="i-1", repo="org/repo-a")],
        )
        assert results == []
        assert len(volundr.spawned) == 0

    @pytest.mark.asyncio
    async def test_skips_unknown_issue(
        self,
        service: DispatchService,
        saga_repo: MockSagaRepo,
        volundr: MockVolundr,
    ):
        saga_id = str(saga_repo.sagas[0].id)
        results = await service.dispatch_issues(
            owner_id="dev-user",
            items=[DispatchItem(saga_id=saga_id, issue_id="nonexistent", repo="org/repo-a")],
        )
        assert results == []
        assert len(volundr.spawned) == 0

    @pytest.mark.asyncio
    async def test_spawn_failure_returns_failed(
        self,
        tracker: MockTracker,
        saga_repo: MockSagaRepo,
        dispatcher_repo: MockDispatcherRepo,
    ):
        volundr = MockVolundr()
        volundr.fail_spawn = True
        svc = DispatchService(
            tracker_factory=MockTrackerFactory([tracker]),
            volundr_factory=MockVolundrFactory(adapters=[volundr]),
            saga_repo=saga_repo,
            dispatcher_repo=dispatcher_repo,
            config=DispatchConfig(),
        )
        saga_id = str(saga_repo.sagas[0].id)
        results = await svc.dispatch_issues(
            owner_id="dev-user",
            items=[DispatchItem(saga_id=saga_id, issue_id="i-1", repo="org/repo-a")],
        )
        assert len(results) == 1
        assert results[0].status == "failed"
        assert results[0].session_id == ""

    @pytest.mark.asyncio
    async def test_multiple_items(
        self,
        service: DispatchService,
        saga_repo: MockSagaRepo,
        volundr: MockVolundr,
    ):
        saga_id = str(saga_repo.sagas[0].id)
        results = await service.dispatch_issues(
            owner_id="dev-user",
            items=[
                DispatchItem(saga_id=saga_id, issue_id="i-1", repo="org/repo-a"),
                DispatchItem(saga_id=saga_id, issue_id="i-3", repo="org/repo-b"),
            ],
        )
        assert len(results) == 2
        assert all(r.status == "spawned" for r in results)
        assert len(volundr.spawned) == 2

    @pytest.mark.asyncio
    async def test_no_volundr_returns_all_failed(
        self,
        tracker: MockTracker,
        saga_repo: MockSagaRepo,
        dispatcher_repo: MockDispatcherRepo,
    ):
        svc = DispatchService(
            tracker_factory=MockTrackerFactory([tracker]),
            volundr_factory=MockVolundrFactory(adapters=[]),
            saga_repo=saga_repo,
            dispatcher_repo=dispatcher_repo,
            config=DispatchConfig(),
        )
        saga_id = str(saga_repo.sagas[0].id)
        results = await svc.dispatch_issues(
            owner_id="dev-user",
            items=[DispatchItem(saga_id=saga_id, issue_id="i-1", repo="org/repo-a")],
        )
        assert len(results) == 1
        assert results[0].status == "failed"

    @pytest.mark.asyncio
    async def test_updates_raid_progress(
        self,
        saga_repo: MockSagaRepo,
        dispatcher_repo: MockDispatcherRepo,
    ):
        """Verify raid progress is updated after spawn."""

        class TrackingTracker(MockTracker):
            def __init__(self) -> None:
                super().__init__()
                self.progress_calls: list[dict] = []

            async def update_raid_progress(self, tracker_id: str, **kwargs):
                self.progress_calls.append({"tracker_id": tracker_id, **kwargs})
                return await super().update_raid_progress(tracker_id, **kwargs)

        t = TrackingTracker()
        t.projects = _make_tracker().projects
        t.milestones = _make_tracker().milestones
        t.issues = _make_tracker().issues
        volundr = MockVolundr()

        svc = DispatchService(
            tracker_factory=MockTrackerFactory([t]),
            volundr_factory=MockVolundrFactory(adapters=[volundr]),
            saga_repo=saga_repo,
            dispatcher_repo=dispatcher_repo,
            config=DispatchConfig(default_system_prompt="Be helpful."),
        )
        saga_id = str(saga_repo.sagas[0].id)
        await svc.dispatch_issues(
            owner_id="dev-user",
            items=[DispatchItem(saga_id=saga_id, issue_id="i-1", repo="org/repo-a")],
        )
        assert len(t.progress_calls) == 1
        assert t.progress_calls[0]["tracker_id"] == "i-1"
        assert t.progress_calls[0]["session_id"] == "ses-1"

    @pytest.mark.asyncio
    async def test_forwards_auth_token(
        self,
        service: DispatchService,
        saga_repo: MockSagaRepo,
        volundr: MockVolundr,
    ):
        saga_id = str(saga_repo.sagas[0].id)
        await service.dispatch_issues(
            owner_id="dev-user",
            items=[DispatchItem(saga_id=saga_id, issue_id="i-1", repo="org/repo-a")],
            auth_token="my-token",
        )
        assert volundr.last_auth_token == "my-token"
