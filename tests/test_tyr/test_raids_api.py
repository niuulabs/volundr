"""Tests for raid review REST API endpoints."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tyr.api.raids import (
    create_raids_router,
    resolve_git,
    resolve_raid_repo,
    resolve_tracker,
    resolve_volundr,
)
from tyr.config import AuthConfig, ReviewConfig
from tyr.domain.models import (
    ConfidenceEvent,
    ConfidenceEventType,
    Phase,
    PhaseStatus,
    PRStatus,
    Raid,
    RaidStatus,
    Saga,
    SagaStatus,
    SessionMessage,
)
from tyr.ports.git import GitPort
from tyr.ports.saga_repository import SagaRepository
from tyr.ports.volundr import SpawnRequest, VolundrPort, VolundrSession

from .test_tracker_api import MockTracker

# ---------------------------------------------------------------------------
# Default config for tests
# ---------------------------------------------------------------------------

REVIEW_CFG = ReviewConfig()

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PHASE_ID = uuid4()
SAGA_ID = uuid4()


# ---------------------------------------------------------------------------
# Stateful mock tracker for raid API tests
# ---------------------------------------------------------------------------


class StatefulMockTracker(MockTracker):
    """MockTracker with stateful storage for raid review tests."""

    def __init__(self) -> None:
        super().__init__()
        self.raids: dict[UUID, Raid] = {}
        self.events: dict[str, list[ConfidenceEvent]] = {}  # keyed by tracker_id
        self.events_by_raid_id: dict[UUID, list[ConfidenceEvent]] = {}
        self.saga: Saga | None = None
        self.phase: Phase | None = None
        self._all_merged: bool = False
        self.messages: dict[UUID, list[SessionMessage]] = {}

    async def get_raid(self, tracker_id: str) -> Raid:
        # Look up by UUID string (raid_id) first, then by tracker_id
        try:
            uid = UUID(tracker_id)
            if uid in self.raids:
                return self.raids[uid]
        except ValueError:
            pass
        for raid in self.raids.values():
            if raid.tracker_id == tracker_id:
                return raid
        from tyr.domain.exceptions import RaidNotFoundError

        raise RaidNotFoundError(f"Raid not found: {tracker_id}")

    async def get_raid_by_id(self, raid_id: UUID) -> Raid | None:
        return self.raids.get(raid_id)

    async def update_raid_progress(self, tracker_id: str, **kwargs: object) -> Raid:  # noqa: ANN003
        raid = next((r for r in self.raids.values() if r.tracker_id == tracker_id), None)
        if raid is None:
            raise ValueError(f"Raid not found: {tracker_id}")
        now = datetime.now(UTC)
        status = kwargs.get("status", raid.status)
        retry_count = kwargs.get("retry_count", raid.retry_count)
        events = self.events.get(tracker_id, [])
        confidence = events[-1].score_after if events else raid.confidence
        updated = Raid(
            id=raid.id,
            phase_id=raid.phase_id,
            tracker_id=raid.tracker_id,
            name=raid.name,
            description=raid.description,
            acceptance_criteria=raid.acceptance_criteria,
            declared_files=raid.declared_files,
            estimate_hours=raid.estimate_hours,
            status=status,  # type: ignore[arg-type]
            confidence=confidence,
            session_id=raid.session_id,
            branch=raid.branch,
            chronicle_summary=raid.chronicle_summary,
            pr_url=raid.pr_url,
            pr_id=raid.pr_id,
            retry_count=retry_count,  # type: ignore[arg-type]
            created_at=raid.created_at,
            updated_at=now,
        )
        self.raids[raid.id] = updated
        return updated

    async def add_confidence_event(self, tracker_id: str, event: object) -> None:  # noqa: ANN001
        self.events.setdefault(tracker_id, []).append(event)  # type: ignore[arg-type]
        ce = event  # type: ignore[assignment]
        self.events_by_raid_id.setdefault(ce.raid_id, []).append(ce)  # type: ignore[union-attr]

    async def get_confidence_events(self, tracker_id: str) -> list:
        return self.events.get(tracker_id, [])

    async def get_saga_for_raid(self, tracker_id: str) -> Saga | None:
        return self.saga

    async def get_phase_for_raid(self, tracker_id: str) -> Phase | None:
        return self.phase

    async def all_raids_merged(self, phase_tracker_id: str) -> bool:
        return self._all_merged

    async def save_session_message(self, message: SessionMessage) -> None:
        self.messages.setdefault(message.raid_id, []).append(message)

    async def get_session_messages(self, tracker_id: str) -> list:
        # Find raids matching tracker_id
        for raid in self.raids.values():
            if raid.tracker_id == tracker_id:
                return self.messages.get(raid.id, [])
        return []


# ---------------------------------------------------------------------------
# Mock implementations
# ---------------------------------------------------------------------------


class MockVolundr(VolundrPort):
    """In-memory mock for Volundr port."""

    def __init__(self) -> None:
        self.pr_status = PRStatus(
            pr_id="42",
            url="https://github.com/org/repo/pull/42",
            state="open",
            mergeable=True,
            ci_passed=True,
        )
        self.chronicle = "Everything looks good"
        self.fail_pr_status = False

    async def spawn_session(
        self,
        request: SpawnRequest,
        *,
        auth_token: str | None = None,
    ) -> VolundrSession:
        return VolundrSession(
            id="session-1",
            name=request.name,
            status="running",
            tracker_issue_id=request.tracker_issue_id,
        )

    async def get_session(
        self,
        session_id: str,
        *,
        auth_token: str | None = None,
    ) -> VolundrSession | None:
        return VolundrSession(id=session_id, name="test", status="completed", tracker_issue_id=None)

    async def list_sessions(
        self,
        *,
        auth_token: str | None = None,
    ) -> list[VolundrSession]:
        return []

    async def get_chronicle_summary(self, session_id: str) -> str:
        return self.chronicle

    async def get_pr_status(self, session_id: str) -> PRStatus:
        if self.fail_pr_status:
            raise ConnectionError("Volundr unreachable")
        return self.pr_status

    async def send_message(
        self,
        session_id: str,
        message: str,
        *,
        auth_token: str | None = None,
    ) -> None:
        pass

    async def stop_session(self, session_id, *, auth_token=None):
        pass

    async def list_integration_ids(
        self,
        *,
        auth_token: str | None = None,
    ) -> list[str]:
        return []

    async def list_repos(self, *, auth_token: str | None = None) -> list[dict]:
        return []

    async def get_conversation(self, session_id: str) -> dict:
        stub = '{"confidence": 0.9, "approved": true, "issues": []}'
        return {"turns": [{"role": "assistant", "content": stub}]}

    async def get_last_assistant_message(self, session_id: str) -> str:
        return '{"confidence": 0.9, "approved": true, "summary": "stub", "issues": []}'

    async def subscribe_activity(self):
        return
        yield  # type: ignore[misc]  # pragma: no cover


class MockGit(GitPort):
    """In-memory mock for Git port."""

    def __init__(self) -> None:
        self.merged: list[tuple[str, str, str]] = []
        self.deleted: list[tuple[str, str]] = []
        self.fail_merge = False

    async def create_branch(self, repo: str, branch: str, base: str) -> None:
        pass

    async def merge_branch(self, repo: str, source: str, target: str) -> None:
        if self.fail_merge:
            raise RuntimeError("Merge conflict")
        self.merged.append((repo, source, target))

    async def delete_branch(self, repo: str, branch: str) -> None:
        self.deleted.append((repo, branch))

    async def create_pr(self, repo: str, source: str, target: str, title: str) -> str:
        return "pr-1"

    async def get_pr_status(self, pr_id: str) -> PRStatus:
        return PRStatus(
            pr_id=pr_id,
            url=f"https://github.com/org/repo/pull/{pr_id}",
            state="open",
            mergeable=True,
            ci_passed=True,
        )

    async def get_pr_changed_files(self, pr_id: str) -> list[str]:
        return []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_raid(
    raid_id: UUID | None = None,
    status: RaidStatus = RaidStatus.REVIEW,
    confidence: float = 0.5,
    session_id: str | None = "session-1",
    branch: str | None = "raid/test-branch",
) -> Raid:
    now = datetime.now(UTC)
    return Raid(
        id=raid_id or uuid4(),
        phase_id=PHASE_ID,
        tracker_id="tracker-1",
        name="Test raid",
        description="A test raid",
        acceptance_criteria=["it works"],
        declared_files=["src/main.py"],
        estimate_hours=2.0,
        status=status,
        confidence=confidence,
        session_id=session_id,
        branch=branch,
        chronicle_summary="All tests pass, code looks clean",
        pr_url=None,
        pr_id=None,
        retry_count=0,
        created_at=now,
        updated_at=now,
    )


def _make_saga() -> Saga:
    return Saga(
        id=SAGA_ID,
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
    )


def _make_phase() -> Phase:
    return Phase(
        id=PHASE_ID,
        saga_id=SAGA_ID,
        tracker_id="phase-1",
        number=1,
        name="Phase 1",
        status=PhaseStatus.ACTIVE,
        confidence=0.0,
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def tracker() -> StatefulMockTracker:
    t = StatefulMockTracker()
    t.saga = _make_saga()
    t.phase = _make_phase()
    return t


@pytest.fixture
def volundr() -> MockVolundr:
    return MockVolundr()


@pytest.fixture
def git() -> MockGit:
    return MockGit()


@pytest.fixture
def client(
    tracker: StatefulMockTracker,
    volundr: MockVolundr,
    git: MockGit,
) -> TestClient:
    app = FastAPI()
    app.include_router(create_raids_router())
    app.dependency_overrides[resolve_tracker] = lambda: tracker
    app.dependency_overrides[resolve_volundr] = lambda: volundr
    app.dependency_overrides[resolve_git] = lambda: git

    # Provide settings with ReviewConfig and auth on app.state
    app.state.settings = SimpleNamespace(
        review=REVIEW_CFG,
        auth=AuthConfig(allow_anonymous_dev=True),
    )

    return TestClient(app)


# ---------------------------------------------------------------------------
# GET /raids/{id}/review
# ---------------------------------------------------------------------------


class TestGetReview:
    def test_returns_review_state(
        self, client: TestClient, tracker: StatefulMockTracker, volundr: MockVolundr
    ):
        raid = _make_raid()
        tracker.raids[raid.id] = raid

        resp = client.get(f"/api/v1/tyr/raids/{raid.id}/review")
        assert resp.status_code == 200
        data = resp.json()
        assert data["raid_id"] == str(raid.id)
        assert data["name"] == "Test raid"
        assert data["status"] == "REVIEW"
        assert data["chronicle_summary"] == "All tests pass, code looks clean"
        assert data["pr_url"] == "https://github.com/org/repo/pull/42"
        assert data["ci_passed"] is True
        assert data["confidence"] == 0.5
        assert data["confidence_events"] == []

    def test_includes_confidence_events(self, client: TestClient, tracker: StatefulMockTracker):
        raid = _make_raid()
        tracker.raids[raid.id] = raid
        event = ConfidenceEvent(
            id=uuid4(),
            raid_id=raid.id,
            event_type=ConfidenceEventType.CI_PASS,
            delta=0.1,
            score_after=0.6,
            created_at=datetime.now(UTC),
        )
        tracker.events[raid.tracker_id] = [event]

        resp = client.get(f"/api/v1/tyr/raids/{raid.id}/review")
        data = resp.json()
        assert len(data["confidence_events"]) == 1
        assert data["confidence_events"][0]["event_type"] == "ci_pass"
        assert data["confidence_events"][0]["delta"] == 0.1

    def test_not_found(self, client: TestClient):
        resp = client.get(f"/api/v1/tyr/raids/{uuid4()}/review")
        assert resp.status_code == 404

    def test_no_session_id(self, client: TestClient, tracker: StatefulMockTracker):
        raid = _make_raid(session_id=None)
        tracker.raids[raid.id] = raid

        resp = client.get(f"/api/v1/tyr/raids/{raid.id}/review")
        assert resp.status_code == 200
        data = resp.json()
        assert data["pr_url"] is None
        assert data["ci_passed"] is None

    def test_volundr_unreachable(
        self,
        client: TestClient,
        tracker: StatefulMockTracker,
        volundr: MockVolundr,
    ):
        raid = _make_raid()
        tracker.raids[raid.id] = raid
        volundr.fail_pr_status = True

        resp = client.get(f"/api/v1/tyr/raids/{raid.id}/review")
        assert resp.status_code == 200
        data = resp.json()
        assert data["pr_url"] is None
        assert data["ci_passed"] is None


# ---------------------------------------------------------------------------
# POST /raids/{id}/approve
# ---------------------------------------------------------------------------


class TestApproveRaid:
    def test_approve_success(
        self,
        client: TestClient,
        tracker: StatefulMockTracker,
        git: MockGit,
    ):
        raid = _make_raid()
        tracker.raids[raid.id] = raid

        resp = client.post(f"/api/v1/tyr/raids/{raid.id}/approve")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "MERGED"
        assert data["id"] == str(raid.id)

        # Verify branch was merged and deleted
        assert len(git.merged) == 1
        assert git.merged[0] == ("org/repo", "raid/test-branch", "feat/alpha")
        assert len(git.deleted) == 1
        assert git.deleted[0] == ("org/repo", "raid/test-branch")

        # Verify confidence event was added
        events = tracker.events[raid.tracker_id]
        assert len(events) == 1
        assert events[0].event_type == ConfidenceEventType.HUMAN_APPROVED
        assert events[0].delta == REVIEW_CFG.confidence_delta_approved

    def test_approve_not_found(self, client: TestClient):
        resp = client.post(f"/api/v1/tyr/raids/{uuid4()}/approve")
        assert resp.status_code == 404

    def test_approve_wrong_state(self, client: TestClient, tracker: StatefulMockTracker):
        raid = _make_raid(status=RaidStatus.PENDING)
        tracker.raids[raid.id] = raid

        resp = client.post(f"/api/v1/tyr/raids/{raid.id}/approve")
        assert resp.status_code == 409

    def test_approve_no_saga(self, client: TestClient, tracker: StatefulMockTracker):
        raid = _make_raid()
        tracker.raids[raid.id] = raid
        tracker.saga = None

        resp = client.post(f"/api/v1/tyr/raids/{raid.id}/approve")
        assert resp.status_code == 404
        assert "saga" in resp.json()["detail"].lower()

    def test_approve_merge_failure(
        self, client: TestClient, tracker: StatefulMockTracker, git: MockGit
    ):
        raid = _make_raid()
        tracker.raids[raid.id] = raid
        git.fail_merge = True

        resp = client.post(f"/api/v1/tyr/raids/{raid.id}/approve")
        assert resp.status_code == 502
        assert "merge" in resp.json()["detail"].lower()

    def test_approve_no_branch(
        self, client: TestClient, tracker: StatefulMockTracker, git: MockGit
    ):
        raid = _make_raid(branch=None)
        tracker.raids[raid.id] = raid

        resp = client.post(f"/api/v1/tyr/raids/{raid.id}/approve")
        assert resp.status_code == 200
        # No merge/delete attempted
        assert len(git.merged) == 0
        assert len(git.deleted) == 0

    def test_approve_phase_gate_check(
        self,
        client: TestClient,
        tracker: StatefulMockTracker,
    ):
        raid = _make_raid()
        tracker.raids[raid.id] = raid
        tracker._all_merged = True

        resp = client.post(f"/api/v1/tyr/raids/{raid.id}/approve")
        assert resp.status_code == 200

    def test_approve_ci_failing_still_succeeds(
        self,
        client: TestClient,
        tracker: StatefulMockTracker,
        volundr: MockVolundr,
    ):
        raid = _make_raid()
        tracker.raids[raid.id] = raid
        volundr.pr_status = PRStatus(
            pr_id="pr-1",
            url="https://github.com/org/repo/pull/1",
            state="open",
            mergeable=True,
            ci_passed=False,
        )

        resp = client.post(f"/api/v1/tyr/raids/{raid.id}/approve")
        assert resp.status_code == 200
        assert resp.json()["status"] == "MERGED"


# ---------------------------------------------------------------------------
# POST /raids/{id}/reject
# ---------------------------------------------------------------------------


class TestRejectRaid:
    def test_reject_success(self, client: TestClient, tracker: StatefulMockTracker):
        raid = _make_raid()
        tracker.raids[raid.id] = raid

        resp = client.post(f"/api/v1/tyr/raids/{raid.id}/reject")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "FAILED"
        assert data["reason"] is None

        events = tracker.events[raid.tracker_id]
        assert len(events) == 1
        assert events[0].event_type == ConfidenceEventType.HUMAN_REJECT
        assert events[0].delta == REVIEW_CFG.confidence_delta_rejected

    def test_reject_with_reason(self, client: TestClient, tracker: StatefulMockTracker):
        raid = _make_raid()
        tracker.raids[raid.id] = raid

        resp = client.post(
            f"/api/v1/tyr/raids/{raid.id}/reject",
            json={"reason": "Code quality too low"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "FAILED"
        assert data["reason"] == "Code quality too low"

    def test_reject_not_found(self, client: TestClient):
        resp = client.post(f"/api/v1/tyr/raids/{uuid4()}/reject")
        assert resp.status_code == 404

    def test_reject_wrong_state(self, client: TestClient, tracker: StatefulMockTracker):
        raid = _make_raid(status=RaidStatus.MERGED)
        tracker.raids[raid.id] = raid

        resp = client.post(f"/api/v1/tyr/raids/{raid.id}/reject")
        assert resp.status_code == 409

    def test_reject_confidence_clamped_at_zero(
        self, client: TestClient, tracker: StatefulMockTracker
    ):
        raid = _make_raid(confidence=0.05)
        tracker.raids[raid.id] = raid

        resp = client.post(f"/api/v1/tyr/raids/{raid.id}/reject")
        assert resp.status_code == 200
        events = tracker.events[raid.tracker_id]
        assert events[0].score_after == 0.0


# ---------------------------------------------------------------------------
# POST /raids/{id}/retry
# ---------------------------------------------------------------------------


class TestRetryRaid:
    def test_retry_success(self, client: TestClient, tracker: StatefulMockTracker):
        raid = _make_raid()
        tracker.raids[raid.id] = raid

        resp = client.post(f"/api/v1/tyr/raids/{raid.id}/retry")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "PENDING"
        assert data["retry_count"] == 1

        events = tracker.events[raid.tracker_id]
        assert len(events) == 1
        assert events[0].event_type == ConfidenceEventType.RETRY
        assert events[0].delta == REVIEW_CFG.confidence_delta_retry

    def test_retry_not_found(self, client: TestClient):
        resp = client.post(f"/api/v1/tyr/raids/{uuid4()}/retry")
        assert resp.status_code == 404

    def test_retry_wrong_state(self, client: TestClient, tracker: StatefulMockTracker):
        raid = _make_raid(status=RaidStatus.MERGED)
        tracker.raids[raid.id] = raid

        resp = client.post(f"/api/v1/tyr/raids/{raid.id}/retry")
        assert resp.status_code == 409

    def test_retry_from_review_state(self, client: TestClient, tracker: StatefulMockTracker):
        """Retry from REVIEW state resets to PENDING."""
        raid = _make_raid(status=RaidStatus.REVIEW)
        tracker.raids[raid.id] = raid

        resp = client.post(f"/api/v1/tyr/raids/{raid.id}/retry")
        assert resp.status_code == 200
        assert resp.json()["status"] == "PENDING"

    def test_retry_increments_count(self, client: TestClient, tracker: StatefulMockTracker):
        raid = _make_raid()
        tracker.raids[raid.id] = raid

        client.post(f"/api/v1/tyr/raids/{raid.id}/retry")
        # Reset to REVIEW with retry_count=1 to test second retry
        now = datetime.now(UTC)
        tracker.raids[raid.id] = Raid(
            id=raid.id,
            phase_id=raid.phase_id,
            tracker_id=raid.tracker_id,
            name=raid.name,
            description=raid.description,
            acceptance_criteria=raid.acceptance_criteria,
            declared_files=raid.declared_files,
            estimate_hours=raid.estimate_hours,
            status=RaidStatus.REVIEW,
            confidence=raid.confidence,
            session_id=raid.session_id,
            branch=raid.branch,
            chronicle_summary=raid.chronicle_summary,
            pr_url=raid.pr_url,
            pr_id=raid.pr_id,
            retry_count=1,
            created_at=raid.created_at,
            updated_at=now,
        )

        resp = client.post(f"/api/v1/tyr/raids/{raid.id}/retry")
        assert resp.status_code == 200
        assert resp.json()["retry_count"] == 2


# ---------------------------------------------------------------------------
# Mock SagaRepository for summary tests
# ---------------------------------------------------------------------------


class MockSagaRepository(SagaRepository):
    """In-memory mock for SagaRepository used in summary tests."""

    def __init__(self, counts: dict[str, int] | None = None) -> None:
        self._counts = counts or {s.value: 0 for s in RaidStatus}

    async def count_by_status(self) -> dict[str, int]:
        return dict(self._counts)

    async def save_saga(self, saga, *, conn=None) -> None:
        pass

    async def save_phase(self, phase, *, conn=None) -> None:
        pass

    async def save_raid(self, raid, *, conn=None) -> None:
        pass

    async def list_sagas(self, *, owner_id=None):
        return []

    async def get_saga(self, saga_id, *, owner_id=None):
        return None

    async def get_saga_by_slug(self, slug):
        return None

    async def delete_saga(self, saga_id, *, owner_id=None) -> bool:
        return False

    async def update_saga_status(self, saga_id, status) -> None:
        pass


# ---------------------------------------------------------------------------
# GET /raids/summary
# ---------------------------------------------------------------------------


class TestRaidsSummary:
    def _make_client(self, counts: dict[str, int] | None = None) -> TestClient:
        repo = MockSagaRepository(counts)
        app = FastAPI()
        app.include_router(create_raids_router())
        app.dependency_overrides[resolve_raid_repo] = lambda: repo
        app.state.settings = SimpleNamespace(
            review=REVIEW_CFG,
            auth=AuthConfig(allow_anonymous_dev=True),
        )
        return TestClient(app)

    def test_returns_all_statuses(self):
        client = self._make_client()
        resp = client.get("/api/v1/tyr/raids/summary")
        assert resp.status_code == 200
        data = resp.json()
        assert set(data.keys()) == {s.value for s in RaidStatus}

    def test_returns_correct_counts(self):
        counts = {
            "PENDING": 3,
            "QUEUED": 1,
            "RUNNING": 2,
            "REVIEW": 0,
            "MERGED": 5,
            "FAILED": 1,
        }
        client = self._make_client(counts)
        resp = client.get("/api/v1/tyr/raids/summary")
        assert resp.status_code == 200
        data = resp.json()
        assert data["PENDING"] == 3
        assert data["QUEUED"] == 1
        assert data["RUNNING"] == 2
        assert data["REVIEW"] == 0
        assert data["MERGED"] == 5
        assert data["FAILED"] == 1

    def test_zero_counts_when_no_raids(self):
        client = self._make_client()
        resp = client.get("/api/v1/tyr/raids/summary")
        assert resp.status_code == 200
        data = resp.json()
        assert all(v == 0 for v in data.values())

    def test_unconfigured_repo_returns_503(self):
        app = FastAPI()
        app.include_router(create_raids_router())
        app.state.settings = SimpleNamespace(
            review=REVIEW_CFG,
            auth=AuthConfig(allow_anonymous_dev=True),
        )
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/api/v1/tyr/raids/summary")
        assert resp.status_code == 503
