"""Tests for the review-arbiter ravn persona and ReviewEngine arbiter integration.

Test harness from NIU-619 spec:
  1. Unit: review-arbiter persona — load YAML, verify schema, tools, budget
  2. Unit: context assembly — given raid with CI fail + scope breach, verify signals present
  3. Unit: outcome mapping — given arbiter outcome, verify maps to correct action
  4. Unit: fallback — simulate ravn failure; verify imperative logic runs
  5. Integration: review round-trip — mock dispatcher returning canned outcome;
     ReviewEngine dispatches to arbiter → outcome parsed → raid state transitions
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import pytest

from tyr.adapters.memory_event_bus import InMemoryEventBus
from tyr.config import ReviewConfig
from tyr.domain.models import (
    ConfidenceEvent,
    Phase,
    PhaseStatus,
    PRStatus,
    Raid,
    RaidStatus,
    Saga,
    SagaStatus,
)
from tyr.domain.services.review_engine import ReviewEngine

NOW = datetime.now(UTC)
PHASE_ID = uuid4()
SAGA_ID = uuid4()
OWNER_ID = "user-arbiter"
TRACKER_ID = "NIU-619"

# ---------------------------------------------------------------------------
# Stubs (mirrors test_review_engine.py stubs to avoid import coupling)
# ---------------------------------------------------------------------------


class StubTracker:
    """Minimal tracker stub for arbiter tests."""

    def __init__(self) -> None:
        self.raids: dict[str, Raid] = {}
        self.events: dict[str, list[ConfidenceEvent]] = {}
        self.saga: Saga | None = None
        self.phase: Phase | None = None
        self.phases: list[Phase] = []
        self._all_merged: bool = False
        self.phase_status_updates: list[tuple[str, PhaseStatus]] = []
        self.attached_documents: list[tuple[str, str, str]] = []

    async def create_saga(self, saga, **kwargs):
        return saga.tracker_id

    async def create_phase(self, phase, **kwargs):
        return phase.tracker_id

    async def create_raid(self, raid, **kwargs):
        self.raids[raid.tracker_id] = raid
        return raid.tracker_id

    async def update_raid_state(self, raid_id, state):
        pass

    async def close_raid(self, raid_id):
        pass

    async def attach_issue_document(self, issue_id, title, content):
        self.attached_documents.append((issue_id, title, content))
        return "doc-stub"

    async def get_saga(self, saga_id):
        if self.saga is None:
            raise ValueError(f"Not found: {saga_id}")
        return self.saga

    async def get_phase(self, tracker_id):
        if self.phase is None:
            raise ValueError(f"Not found: {tracker_id}")
        return self.phase

    async def get_raid(self, tracker_id):
        raid = self.raids.get(tracker_id)
        if raid is None:
            raise ValueError(f"Raid not found: {tracker_id}")
        return raid

    async def list_pending_raids(self, phase_id):
        return []

    async def list_projects(self):
        return []

    async def get_project(self, project_id):
        raise NotImplementedError

    async def list_milestones(self, project_id):
        return []

    async def list_issues(self, project_id, milestone_id=None):
        return []

    async def update_raid_progress(
        self,
        tracker_id,
        *,
        status=None,
        session_id=None,
        confidence=None,
        pr_url=None,
        pr_id=None,
        retry_count=None,
        reason=None,
        owner_id=None,
        phase_tracker_id=None,
        saga_tracker_id=None,
        chronicle_summary=None,
        reviewer_session_id=None,
        review_round=None,
    ):
        raid = self.raids.get(tracker_id)
        if raid is None:
            raise ValueError(f"Raid not found: {tracker_id}")
        events = self.events.get(tracker_id, [])
        new_confidence = events[-1].score_after if events else raid.confidence
        updated = Raid(
            id=raid.id,
            phase_id=raid.phase_id,
            tracker_id=raid.tracker_id,
            name=raid.name,
            description=raid.description,
            acceptance_criteria=raid.acceptance_criteria,
            declared_files=raid.declared_files,
            estimate_hours=raid.estimate_hours,
            status=status if status is not None else raid.status,
            confidence=confidence if confidence is not None else new_confidence,
            session_id=session_id if session_id is not None else raid.session_id,
            branch=raid.branch,
            chronicle_summary=raid.chronicle_summary,
            pr_url=pr_url if pr_url is not None else raid.pr_url,
            pr_id=pr_id if pr_id is not None else raid.pr_id,
            retry_count=retry_count if retry_count is not None else raid.retry_count,
            created_at=raid.created_at,
            updated_at=datetime.now(UTC),
        )
        self.raids[tracker_id] = updated
        return updated

    async def get_raid_progress_for_saga(self, saga_tracker_id):
        return list(self.raids.values())

    async def get_raid_by_session(self, session_id):
        return None

    async def list_raids_by_status(self, status):
        return []

    async def get_raid_by_id(self, raid_id):
        return None

    async def add_confidence_event(self, tracker_id, event):
        self.events.setdefault(tracker_id, []).append(event)

    async def get_confidence_events(self, tracker_id):
        return self.events.get(tracker_id, [])

    async def all_raids_merged(self, phase_tracker_id):
        return self._all_merged

    async def list_phases_for_saga(self, saga_tracker_id):
        return self.phases

    async def update_phase_status(self, phase_tracker_id, status):
        return None

    async def get_saga_for_raid(self, tracker_id):
        return self.saga

    async def get_phase_for_raid(self, tracker_id):
        return self.phase

    async def get_owner_for_raid(self, tracker_id):
        return OWNER_ID

    async def save_session_message(self, message):
        pass

    async def get_session_messages(self, tracker_id):
        return []


class StubTrackerFactory:
    def __init__(self, tracker: StubTracker) -> None:
        self._tracker = tracker

    async def for_owner(self, owner_id: str) -> list[StubTracker]:
        return [self._tracker]


class StubVolundr:
    def __init__(self) -> None:
        self.messages: list[tuple[str, str]] = []
        self.stopped_sessions: list[str] = []

    async def spawn_session(self, request, **kwargs):
        raise NotImplementedError

    async def get_session(self, session_id, **kwargs):
        return None

    async def list_sessions(self, **kwargs):
        return []

    async def get_pr_status(self, session_id):
        raise NotImplementedError

    async def get_chronicle_summary(self, session_id):
        return ""

    async def send_message(self, session_id, message, **kwargs):
        self.messages.append((session_id, message))

    async def stop_session(self, session_id, **kwargs):
        self.stopped_sessions.append(session_id)

    async def list_integration_ids(self, **kwargs):
        return []

    async def list_repos(self, **kwargs):
        return []

    async def get_conversation(self, session_id):
        return {"turns": []}

    async def get_last_assistant_message(self, session_id):
        return ""

    async def subscribe_activity(self) -> AsyncGenerator:
        return
        yield  # type: ignore[misc]


class StubVolundrFactory:
    def __init__(self, volundr: StubVolundr) -> None:
        self._v = volundr

    async def for_owner(self, owner_id: str) -> list[StubVolundr]:
        return [self._v]

    async def primary_for_owner(self, owner_id: str) -> StubVolundr | None:
        return self._v


class StubGit:
    def __init__(self) -> None:
        self.pr_statuses: dict[str, PRStatus] = {}
        self.changed_files: dict[str, list[str]] = {}

    async def create_branch(self, repo, branch, base):
        pass

    async def merge_branch(self, repo, source, target):
        pass

    async def delete_branch(self, repo, branch):
        pass

    async def create_pr(self, repo, source, target, title):
        return "pr-1"

    async def get_pr_status(self, pr_id):
        pr = self.pr_statuses.get(pr_id)
        if pr is None:
            raise RuntimeError(f"No PR: {pr_id}")
        return pr

    async def get_pr_changed_files(self, pr_id):
        return self.changed_files.get(pr_id, [])


class StubRavnDispatcher:
    """Stub RavnDispatcher that returns a canned outcome dict."""

    def __init__(self, outcome: dict[str, Any] | None = None, *, raises: bool = False) -> None:
        self.outcome = outcome
        self.raises = raises
        self.calls: list[tuple[str, str]] = []  # (persona_name, context)

    async def dispatch(self, persona_name: str, context: str, **kwargs) -> dict | None:
        self.calls.append((persona_name, context))
        if self.raises:
            raise RuntimeError("simulated ravn failure")
        return self.outcome

    async def close(self) -> None:
        pass

    def load_persona(self, name: str):
        return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


PR_ID = "https://api.github.com/repos/org/repo/pulls/42"


def _make_raid(
    tracker_id: str = TRACKER_ID,
    status: RaidStatus = RaidStatus.REVIEW,
    confidence: float = 0.5,
    pr_id: str | None = PR_ID,
    declared_files: list[str] | None = None,
    retry_count: int = 0,
) -> Raid:
    return Raid(
        id=uuid4(),
        phase_id=PHASE_ID,
        tracker_id=tracker_id,
        name="Test raid",
        description="A test raid",
        acceptance_criteria=["tests pass", "coverage >= 85%"],
        declared_files=declared_files or ["src/main.py", "tests/test_main.py"],
        estimate_hours=3.0,
        status=status,
        confidence=confidence,
        session_id="session-arbiter",
        branch="raid/test",
        chronicle_summary="",
        pr_url="https://github.com/org/repo/pull/42",
        pr_id=pr_id,
        retry_count=retry_count,
        created_at=NOW,
        updated_at=NOW,
    )


def _make_saga() -> Saga:
    return Saga(
        id=SAGA_ID,
        tracker_id="proj-arbiter",
        tracker_type="linear",
        slug="arbiter",
        name="Arbiter Saga",
        repos=["org/repo"],
        feature_branch="feat/arbiter",
        status=SagaStatus.ACTIVE,
        confidence=0.5,
        created_at=NOW,
        base_branch="dev",
        owner_id=OWNER_ID,
    )


def _make_phase() -> Phase:
    return Phase(
        id=PHASE_ID,
        saga_id=SAGA_ID,
        tracker_id="phase-1",
        number=1,
        name="Phase 1",
        status=PhaseStatus.ACTIVE,
        confidence=0.5,
    )


def _make_engine(
    config: ReviewConfig | None = None,
    ravn: StubRavnDispatcher | None = None,
    tracker: StubTracker | None = None,
    git: StubGit | None = None,
    volundr: StubVolundr | None = None,
) -> tuple[ReviewEngine, StubTracker, StubGit, StubVolundr]:
    t = tracker or StubTracker()
    g = git or StubGit()
    v = volundr or StubVolundr()
    cfg = config or ReviewConfig(reviewer_session_enabled=False)

    engine = ReviewEngine(
        tracker_factory=StubTrackerFactory(t),
        volundr_factory=StubVolundrFactory(v),
        git=g,
        review_config=cfg,
        event_bus=InMemoryEventBus(),
        ravn_dispatcher=ravn,
    )
    return engine, t, g, v


def _passing_pr(git: StubGit, pr_id: str) -> None:
    git.pr_statuses[pr_id] = PRStatus(
        pr_id=pr_id,
        url="https://github.com/org/repo/pull/42",
        state="open",
        mergeable=True,
        ci_passed=True,
    )


def _failing_pr(git: StubGit, pr_id: str) -> None:
    git.pr_statuses[pr_id] = PRStatus(
        pr_id=pr_id,
        url="https://github.com/org/repo/pull/42",
        state="open",
        mergeable=True,
        ci_passed=False,
    )


# ---------------------------------------------------------------------------
# 1. Unit: review-arbiter persona YAML
# ---------------------------------------------------------------------------


class TestReviewArbiterPersona:
    def test_persona_loads(self) -> None:
        """review-arbiter.yaml must be loadable by PersonaLoader."""
        from ravn.adapters.personas.loader import PersonaLoader

        loader = PersonaLoader()
        persona = loader.load("review-arbiter")
        assert persona is not None, "review-arbiter persona not found"

    def test_persona_name(self) -> None:
        from ravn.adapters.personas.loader import PersonaLoader

        persona = PersonaLoader().load("review-arbiter")
        assert persona is not None
        assert persona.name == "review-arbiter"

    def test_persona_has_system_prompt(self) -> None:
        from ravn.adapters.personas.loader import PersonaLoader

        persona = PersonaLoader().load("review-arbiter")
        assert persona is not None
        assert len(persona.system_prompt_template) > 50

    def test_persona_schema_has_verdict(self) -> None:
        from ravn.adapters.personas.loader import PersonaLoader

        persona = PersonaLoader().load("review-arbiter")
        assert persona is not None
        assert "verdict" in persona.produces.schema

    def test_persona_verdict_enum_values(self) -> None:
        from ravn.adapters.personas.loader import PersonaLoader

        persona = PersonaLoader().load("review-arbiter")
        assert persona is not None
        verdict_field = persona.produces.schema["verdict"]
        assert verdict_field.enum_values is not None
        assert set(verdict_field.enum_values) == {"approve", "retry", "escalate"}

    def test_persona_has_reason_field(self) -> None:
        from ravn.adapters.personas.loader import PersonaLoader

        persona = PersonaLoader().load("review-arbiter")
        assert persona is not None
        assert "reason" in persona.produces.schema

    def test_persona_iteration_budget(self) -> None:
        from ravn.adapters.personas.loader import PersonaLoader

        persona = PersonaLoader().load("review-arbiter")
        assert persona is not None
        assert persona.iteration_budget == 5

    def test_persona_stop_on_outcome(self) -> None:
        from ravn.adapters.personas.loader import PersonaLoader

        persona = PersonaLoader().load("review-arbiter")
        assert persona is not None
        assert persona.stop_on_outcome is True

    def test_persona_allowed_tools_non_empty(self) -> None:
        from ravn.adapters.personas.loader import PersonaLoader

        persona = PersonaLoader().load("review-arbiter")
        assert persona is not None
        assert len(persona.allowed_tools) > 0


# ---------------------------------------------------------------------------
# 2. Unit: context assembly
# ---------------------------------------------------------------------------


class TestContextAssembly:
    def test_context_includes_acceptance_criteria(self) -> None:
        """Context string must include the raid's acceptance criteria."""
        engine, _, _, _ = _make_engine()
        raid = _make_raid()
        pr_status = PRStatus(
            pr_id=PR_ID,
            url="https://github.com/org/repo/pull/42",
            state="open",
            mergeable=True,
            ci_passed=False,
        )
        context = engine._assemble_arbiter_context(raid, pr_status, [], 0.3)
        for criterion in raid.acceptance_criteria:
            assert criterion in context

    def test_context_includes_ci_status(self) -> None:
        """Context must mention CI failed when CI has failed."""
        engine, _, _, _ = _make_engine()
        raid = _make_raid()
        pr_status = PRStatus(
            pr_id=PR_ID,
            url="https://github.com/org/repo/pull/42",
            state="open",
            mergeable=True,
            ci_passed=False,
        )
        context = engine._assemble_arbiter_context(raid, pr_status, [], 0.3)
        assert "failed" in context.lower()

    def test_context_includes_scope_breach_ratio(self) -> None:
        """Context must include scope breach info when undeclared files exist."""
        engine, _, _, _ = _make_engine()
        raid = _make_raid(declared_files=["src/main.py"])
        changed = ["src/main.py", "src/extra1.py", "src/extra2.py", "src/extra3.py"]
        context = engine._assemble_arbiter_context(raid, None, changed, 0.2)
        assert "undeclared" in context.lower()

    def test_context_includes_confidence_score(self) -> None:
        """Context must include the current confidence score."""
        engine, _, _, _ = _make_engine()
        raid = _make_raid()
        context = engine._assemble_arbiter_context(raid, None, [], 0.42)
        assert "0.420" in context

    def test_context_includes_tracker_id(self) -> None:
        engine, _, _, _ = _make_engine()
        raid = _make_raid()
        context = engine._assemble_arbiter_context(raid, None, [], 0.5)
        assert TRACKER_ID in context

    def test_context_no_pr_shows_message(self) -> None:
        engine, _, _, _ = _make_engine()
        raid = _make_raid()
        context = engine._assemble_arbiter_context(raid, None, [], 0.5)
        assert "No PR found" in context

    def test_context_declared_files_listed(self) -> None:
        engine, _, _, _ = _make_engine()
        raid = _make_raid(declared_files=["src/foo.py", "src/bar.py"])
        context = engine._assemble_arbiter_context(raid, None, [], 0.5)
        assert "src/foo.py" in context
        assert "src/bar.py" in context

    def test_context_marks_declared_vs_undeclared(self) -> None:
        engine, _, _, _ = _make_engine()
        raid = _make_raid(declared_files=["src/main.py"])
        changed = ["src/main.py", "src/extra.py"]
        context = engine._assemble_arbiter_context(raid, None, changed, 0.5)
        assert "[declared]" in context
        assert "[undeclared]" in context


# ---------------------------------------------------------------------------
# 3. Unit: outcome mapping
# ---------------------------------------------------------------------------


class TestOutcomeMapping:
    @pytest.mark.asyncio
    async def test_approve_verdict_auto_approves(self) -> None:
        """Arbiter verdict 'approve' → auto_approved action."""
        ravn = StubRavnDispatcher(outcome={"verdict": "approve", "reason": "all good"})
        config = ReviewConfig(
            reviewer_session_enabled=False,
            ravn_arbiter_enabled=True,
        )
        engine, tracker, git, _ = _make_engine(config=config, ravn=ravn)
        raid = _make_raid(confidence=0.9)
        tracker.raids[raid.tracker_id] = raid
        tracker.saga = _make_saga()
        tracker.phase = _make_phase()
        _passing_pr(git, PR_ID)
        git.changed_files[PR_ID] = list(raid.declared_files)

        result = await engine.evaluate(raid.tracker_id, OWNER_ID)

        assert result.action == "auto_approved"
        assert tracker.raids[raid.tracker_id].status == RaidStatus.MERGED

    @pytest.mark.asyncio
    async def test_retry_verdict_retries(self) -> None:
        """Arbiter verdict 'retry' → retried action when retries remain."""
        ravn = StubRavnDispatcher(outcome={"verdict": "retry", "reason": "CI flake"})
        config = ReviewConfig(
            reviewer_session_enabled=False,
            ravn_arbiter_enabled=True,
            max_retries=3,
        )
        engine, tracker, git, _ = _make_engine(config=config, ravn=ravn)
        raid = _make_raid(confidence=0.5, retry_count=0)
        tracker.raids[raid.tracker_id] = raid
        _passing_pr(git, PR_ID)

        result = await engine.evaluate(raid.tracker_id, OWNER_ID)

        assert result.action == "retried"
        assert tracker.raids[raid.tracker_id].status == RaidStatus.PENDING

    @pytest.mark.asyncio
    async def test_retry_verdict_exhausted_escalates(self) -> None:
        """Arbiter 'retry' when retries exhausted → escalated."""
        ravn = StubRavnDispatcher(outcome={"verdict": "retry", "reason": "still failing"})
        config = ReviewConfig(
            reviewer_session_enabled=False,
            ravn_arbiter_enabled=True,
            max_retries=3,
        )
        engine, tracker, git, _ = _make_engine(config=config, ravn=ravn)
        raid = _make_raid(confidence=0.4, retry_count=3)
        tracker.raids[raid.tracker_id] = raid
        _passing_pr(git, PR_ID)

        result = await engine.evaluate(raid.tracker_id, OWNER_ID)

        assert result.action == "escalated"
        assert tracker.raids[raid.tracker_id].status == RaidStatus.ESCALATED

    @pytest.mark.asyncio
    async def test_escalate_verdict_escalates(self) -> None:
        """Arbiter verdict 'escalate' → escalated action."""
        ravn = StubRavnDispatcher(outcome={"verdict": "escalate", "reason": "needs human"})
        config = ReviewConfig(
            reviewer_session_enabled=False,
            ravn_arbiter_enabled=True,
        )
        engine, tracker, git, _ = _make_engine(config=config, ravn=ravn)
        raid = _make_raid(confidence=0.5)
        tracker.raids[raid.tracker_id] = raid
        _passing_pr(git, PR_ID)

        result = await engine.evaluate(raid.tracker_id, OWNER_ID)

        assert result.action == "escalated"
        assert tracker.raids[raid.tracker_id].status == RaidStatus.ESCALATED

    @pytest.mark.asyncio
    async def test_unknown_verdict_falls_back(self) -> None:
        """Unknown arbiter verdict → imperative fallback (auto_approved for passing PR)."""
        ravn = StubRavnDispatcher(outcome={"verdict": "unknown_word", "reason": "???"})
        config = ReviewConfig(
            reviewer_session_enabled=False,
            ravn_arbiter_enabled=True,
        )
        engine, tracker, git, _ = _make_engine(config=config, ravn=ravn)
        raid = _make_raid(confidence=0.5)
        tracker.raids[raid.tracker_id] = raid
        tracker.saga = _make_saga()
        tracker.phase = _make_phase()
        _passing_pr(git, PR_ID)
        git.changed_files[PR_ID] = list(raid.declared_files)

        result = await engine.evaluate(raid.tracker_id, OWNER_ID)

        # Fallback path → auto_approved since PR passes and confidence is sufficient
        assert result.action == "auto_approved"


# ---------------------------------------------------------------------------
# 4. Unit: fallback on ravn failure
# ---------------------------------------------------------------------------


class TestArbiterFallback:
    @pytest.mark.asyncio
    async def test_ravn_exception_falls_back_to_imperative(self) -> None:
        """When ravn raises an exception, imperative logic runs as fallback."""
        ravn = StubRavnDispatcher(raises=True)
        config = ReviewConfig(
            reviewer_session_enabled=False,
            ravn_arbiter_enabled=True,
        )
        engine, tracker, git, _ = _make_engine(config=config, ravn=ravn)
        raid = _make_raid(confidence=0.5)
        tracker.raids[raid.tracker_id] = raid
        tracker.saga = _make_saga()
        tracker.phase = _make_phase()
        _passing_pr(git, PR_ID)
        git.changed_files[PR_ID] = list(raid.declared_files)

        result = await engine.evaluate(raid.tracker_id, OWNER_ID)

        # Imperative fallback: passing PR + enough confidence → auto_approved
        assert result.action == "auto_approved"

    @pytest.mark.asyncio
    async def test_ravn_returns_none_falls_back(self) -> None:
        """When ravn returns None (no outcome), imperative logic runs."""
        ravn = StubRavnDispatcher(outcome=None)
        config = ReviewConfig(
            reviewer_session_enabled=False,
            ravn_arbiter_enabled=True,
        )
        engine, tracker, git, _ = _make_engine(config=config, ravn=ravn)
        raid = _make_raid(confidence=0.5)
        tracker.raids[raid.tracker_id] = raid
        tracker.saga = _make_saga()
        tracker.phase = _make_phase()
        _passing_pr(git, PR_ID)
        git.changed_files[PR_ID] = list(raid.declared_files)

        result = await engine.evaluate(raid.tracker_id, OWNER_ID)

        assert result.action == "auto_approved"

    @pytest.mark.asyncio
    async def test_arbiter_disabled_skips_ravn(self) -> None:
        """When ravn_arbiter_enabled=False, ravn is never called."""
        ravn = StubRavnDispatcher(outcome={"verdict": "escalate", "reason": "test"})
        config = ReviewConfig(
            reviewer_session_enabled=False,
            ravn_arbiter_enabled=False,
        )
        engine, tracker, git, _ = _make_engine(config=config, ravn=ravn)
        raid = _make_raid(confidence=0.5)
        tracker.raids[raid.tracker_id] = raid
        tracker.saga = _make_saga()
        tracker.phase = _make_phase()
        _passing_pr(git, PR_ID)
        git.changed_files[PR_ID] = list(raid.declared_files)

        result = await engine.evaluate(raid.tracker_id, OWNER_ID)

        # Arbiter skipped → imperative logic → auto_approved
        assert result.action == "auto_approved"
        assert len(ravn.calls) == 0

    @pytest.mark.asyncio
    async def test_no_ravn_dispatcher_skips_arbiter(self) -> None:
        """When no RavnDispatcher is injected, arbiter is silently skipped."""
        config = ReviewConfig(
            reviewer_session_enabled=False,
            ravn_arbiter_enabled=True,
        )
        engine, tracker, git, _ = _make_engine(config=config, ravn=None)
        raid = _make_raid(confidence=0.5)
        tracker.raids[raid.tracker_id] = raid
        tracker.saga = _make_saga()
        tracker.phase = _make_phase()
        _passing_pr(git, PR_ID)
        git.changed_files[PR_ID] = list(raid.declared_files)

        result = await engine.evaluate(raid.tracker_id, OWNER_ID)

        assert result.action == "auto_approved"


# ---------------------------------------------------------------------------
# 5. Integration: review round-trip
# ---------------------------------------------------------------------------


class TestReviewArbiterRoundTrip:
    @pytest.mark.asyncio
    async def test_arbiter_approve_transitions_to_merged(self) -> None:
        """Full round-trip: arbiter 'approve' → raid transitions to MERGED."""
        ravn = StubRavnDispatcher(outcome={"verdict": "approve", "reason": "clean code"})
        config = ReviewConfig(
            reviewer_session_enabled=False,
            ravn_arbiter_enabled=True,
        )
        engine, tracker, git, _ = _make_engine(config=config, ravn=ravn)
        raid = _make_raid(confidence=0.85)
        tracker.raids[raid.tracker_id] = raid
        tracker.saga = _make_saga()
        tracker.phase = _make_phase()
        _passing_pr(git, PR_ID)
        git.changed_files[PR_ID] = list(raid.declared_files)

        result = await engine.evaluate(raid.tracker_id, OWNER_ID)

        assert result.action == "auto_approved"
        assert tracker.raids[raid.tracker_id].status == RaidStatus.MERGED
        # Verify arbiter was actually called
        assert len(ravn.calls) == 1
        assert ravn.calls[0][0] == "review-arbiter"

    @pytest.mark.asyncio
    async def test_arbiter_retry_transitions_to_pending(self) -> None:
        """Full round-trip: arbiter 'retry' → raid transitions to PENDING."""
        ravn = StubRavnDispatcher(outcome={"verdict": "retry", "reason": "test coverage gap"})
        config = ReviewConfig(
            reviewer_session_enabled=False,
            ravn_arbiter_enabled=True,
            max_retries=3,
        )
        engine, tracker, git, vol = _make_engine(config=config, ravn=ravn)
        raid = _make_raid(confidence=0.6, retry_count=1)
        tracker.raids[raid.tracker_id] = raid
        _passing_pr(git, PR_ID)

        result = await engine.evaluate(raid.tracker_id, OWNER_ID)

        assert result.action == "retried"
        updated = tracker.raids[raid.tracker_id]
        assert updated.status == RaidStatus.PENDING
        assert updated.retry_count == 2

    @pytest.mark.asyncio
    async def test_arbiter_context_passed_to_dispatcher(self) -> None:
        """Verify the context string passed to the dispatcher contains key signals."""
        ravn = StubRavnDispatcher(outcome={"verdict": "escalate", "reason": "test"})
        config = ReviewConfig(
            reviewer_session_enabled=False,
            ravn_arbiter_enabled=True,
        )
        engine, tracker, git, _ = _make_engine(config=config, ravn=ravn)
        raid = _make_raid(confidence=0.4, declared_files=["src/core.py"])
        tracker.raids[raid.tracker_id] = raid
        _failing_pr(git, PR_ID)
        git.changed_files[PR_ID] = ["src/core.py", "src/extra.py"]

        await engine.evaluate(raid.tracker_id, OWNER_ID)

        assert len(ravn.calls) == 1
        _, context = ravn.calls[0]
        # Check all key signals appear in the context
        assert TRACKER_ID in context
        assert "acceptance_criteria" in context.lower() or "tests pass" in context
        assert "undeclared" in context.lower()
