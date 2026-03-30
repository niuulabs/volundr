"""Tests for the contract engine (NIU-332)."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from tyr.adapters.memory_event_bus import InMemoryEventBus
from tyr.config import ContractConfig
from tyr.domain.models import (
    ConfidenceEvent,
    Phase,
    PhaseStatus,
    Raid,
    RaidStatus,
    Saga,
    SessionMessage,
    TrackerIssue,
    TrackerMilestone,
    TrackerProject,
)
from tyr.domain.services.contract_engine import (
    ContractEngine,
    build_contract_initial_prompt,
    parse_contract_response,
)
from tyr.ports.tracker import TrackerPort
from tyr.ports.volundr import ActivityEvent, SpawnRequest, VolundrPort, VolundrSession

NOW = datetime.now(UTC)

# ---------------------------------------------------------------------------
# Stubs
# ---------------------------------------------------------------------------

PHASE_ID = uuid4()
SAGA_ID = uuid4()
OWNER_ID = "user-1"
TRACKER_ID = "NIU-100"


class StubTracker(TrackerPort):
    """In-memory tracker stub for contract engine tests."""

    def __init__(self) -> None:
        self.raids: dict[str, Raid] = {}
        self.events: dict[str, list[ConfidenceEvent]] = {}
        self.comments: list[tuple[str, str]] = []

    # -- CRUD --

    async def create_saga(self, saga: Saga, *, description: str = "") -> str:
        return saga.tracker_id

    async def create_phase(self, phase: Phase, *, project_id: str = "") -> str:
        return phase.tracker_id

    async def create_raid(self, raid: Raid, *, project_id: str = "", milestone_id: str = "") -> str:
        self.raids[raid.tracker_id] = raid
        return raid.tracker_id

    async def update_raid_state(self, raid_id: str, state: RaidStatus) -> None:
        pass

    async def close_raid(self, raid_id: str) -> None:
        pass

    async def get_saga(self, saga_id: str) -> Saga:
        raise NotImplementedError

    async def get_phase(self, tracker_id: str) -> Phase:
        raise NotImplementedError

    async def get_raid(self, tracker_id: str) -> Raid:
        raid = self.raids.get(tracker_id)
        if raid is None:
            raise ValueError(f"Raid not found: {tracker_id}")
        return raid

    async def list_pending_raids(self, phase_id: str) -> list[Raid]:
        return []

    async def list_projects(self) -> list[TrackerProject]:
        return []

    async def get_project(self, project_id: str) -> TrackerProject:
        raise NotImplementedError

    async def list_milestones(self, project_id: str) -> list[TrackerMilestone]:
        return []

    async def list_issues(
        self, project_id: str, milestone_id: str | None = None
    ) -> list[TrackerIssue]:
        return []

    async def update_raid_progress(
        self,
        tracker_id: str,
        *,
        status: RaidStatus | None = None,
        session_id: str | None = None,
        confidence: float | None = None,
        pr_url: str | None = None,
        pr_id: str | None = None,
        retry_count: int | None = None,
        reason: str | None = None,
        owner_id: str | None = None,
        phase_tracker_id: str | None = None,
        saga_tracker_id: str | None = None,
        chronicle_summary: str | None = None,
        reviewer_session_id: str | None = None,
        review_round: int | None = None,
        planner_session_id: str | None = None,
        acceptance_criteria: list[str] | None = None,
        declared_files: list[str] | None = None,
        launch_command: str | None = None,
    ) -> Raid:
        raid = self.raids.get(tracker_id)
        if raid is None:
            raise ValueError(f"Raid not found: {tracker_id}")
        updated = Raid(
            id=raid.id,
            phase_id=raid.phase_id,
            tracker_id=raid.tracker_id,
            name=raid.name,
            description=raid.description,
            acceptance_criteria=acceptance_criteria
            if acceptance_criteria is not None
            else raid.acceptance_criteria,
            declared_files=declared_files if declared_files is not None else raid.declared_files,
            estimate_hours=raid.estimate_hours,
            status=status if status is not None else raid.status,
            confidence=confidence if confidence is not None else raid.confidence,
            session_id=session_id if session_id is not None else raid.session_id,
            branch=raid.branch,
            chronicle_summary=raid.chronicle_summary,
            pr_url=pr_url if pr_url is not None else raid.pr_url,
            pr_id=pr_id if pr_id is not None else raid.pr_id,
            retry_count=retry_count if retry_count is not None else raid.retry_count,
            created_at=raid.created_at,
            updated_at=datetime.now(UTC),
            identifier=raid.identifier,
            url=raid.url,
            reviewer_session_id=reviewer_session_id
            if reviewer_session_id is not None
            else raid.reviewer_session_id,
            review_round=review_round if review_round is not None else raid.review_round,
            planner_session_id=planner_session_id
            if planner_session_id is not None
            else raid.planner_session_id,
            launch_command=launch_command if launch_command is not None else raid.launch_command,
        )
        self.raids[tracker_id] = updated
        return updated

    async def get_raid_progress_for_saga(self, saga_tracker_id: str) -> list[Raid]:
        return list(self.raids.values())

    async def get_raid_by_session(self, session_id: str) -> Raid | None:
        return next((r for r in self.raids.values() if r.session_id == session_id), None)

    async def list_raids_by_status(self, status: RaidStatus) -> list[Raid]:
        return [r for r in self.raids.values() if r.status == status]

    async def get_raid_by_id(self, raid_id: UUID) -> Raid | None:
        return next((r for r in self.raids.values() if r.id == raid_id), None)

    async def add_confidence_event(self, tracker_id: str, event: ConfidenceEvent) -> None:
        self.events.setdefault(tracker_id, []).append(event)

    async def get_confidence_events(self, tracker_id: str) -> list[ConfidenceEvent]:
        return self.events.get(tracker_id, [])

    async def all_raids_merged(self, phase_tracker_id: str) -> bool:
        return False

    async def list_phases_for_saga(self, saga_tracker_id: str) -> list[Phase]:
        return []

    async def update_phase_status(self, phase_tracker_id: str, status: PhaseStatus) -> Phase | None:
        return None

    async def get_saga_for_raid(self, tracker_id: str) -> Saga | None:
        return None

    async def get_phase_for_raid(self, tracker_id: str) -> Phase | None:
        return None

    async def get_owner_for_raid(self, tracker_id: str) -> str | None:
        return None

    async def save_session_message(self, message: SessionMessage) -> None:
        pass

    async def get_session_messages(self, tracker_id: str) -> list[SessionMessage]:
        return []

    async def add_comment(self, issue_id: str, body: str) -> None:
        self.comments.append((issue_id, body))

    async def attach_issue_document(self, issue_id: str, title: str, content: str) -> str:
        return ""


class StubTrackerFactory:
    def __init__(self, tracker: StubTracker) -> None:
        self._tracker = tracker

    async def for_owner(self, owner_id: str) -> list[StubTracker]:
        return [self._tracker]


class StubVolundr(VolundrPort):
    def __init__(self) -> None:
        self.messages: list[tuple[str, str]] = []
        self.spawned: list[SpawnRequest] = []
        self.fail_spawn: bool = False

    async def spawn_session(
        self, request: SpawnRequest, *, auth_token: str | None = None
    ) -> VolundrSession:
        if self.fail_spawn:
            raise RuntimeError("Spawn failed")
        self.spawned.append(request)
        return VolundrSession(
            id="planner-session-1",
            name=request.name,
            status="running",
            tracker_issue_id=request.tracker_issue_id,
        )

    async def get_session(
        self, session_id: str, *, auth_token: str | None = None
    ) -> VolundrSession | None:
        return VolundrSession(
            id=session_id,
            name="s",
            status="running",
            tracker_issue_id=None,
            repo="org/repo",
            branch="raid/test",
            base_branch="feat/test",
        )

    async def list_sessions(self, *, auth_token: str | None = None) -> list[VolundrSession]:
        return []

    async def get_pr_status(self, session_id: str):
        raise NotImplementedError

    async def get_chronicle_summary(self, session_id: str) -> str:
        return ""

    async def send_message(
        self, session_id: str, message: str, *, auth_token: str | None = None
    ) -> None:
        self.messages.append((session_id, message))

    async def stop_session(self, session_id, *, auth_token=None):
        pass

    async def list_integration_ids(self, *, auth_token=None) -> list[str]:
        return []

    async def list_repos(self, *, auth_token: str | None = None) -> list[dict]:
        return []

    async def get_conversation(self, session_id: str) -> dict:
        return {"turns": []}

    async def get_last_assistant_message(self, session_id: str) -> str:
        return ""

    async def subscribe_activity(self) -> AsyncGenerator[ActivityEvent, None]:
        return
        yield  # type: ignore[misc]  # pragma: no cover


class StubVolundrFactory:
    def __init__(self, volundr: StubVolundr) -> None:
        self._volundr = volundr

    async def for_owner(self, owner_id: str) -> list[StubVolundr]:
        return [self._volundr]


class StubDispatcherRepo:
    def __init__(self, owner_ids: list[str] | None = None) -> None:
        self._owner_ids = owner_ids or []

    async def get_or_create(self, owner_id: str):
        raise NotImplementedError

    async def update(self, owner_id: str, **fields):
        raise NotImplementedError

    async def list_active_owner_ids(self) -> list[str]:
        return self._owner_ids


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_raid(
    raid_id: UUID | None = None,
    tracker_id: str = TRACKER_ID,
    status: RaidStatus = RaidStatus.CONTRACTING,
    confidence: float = 0.5,
    session_id: str | None = "session-1",
    planner_session_id: str | None = None,
    acceptance_criteria: list[str] | None = None,
    declared_files: list[str] | None = None,
) -> Raid:
    return Raid(
        id=raid_id or uuid4(),
        phase_id=PHASE_ID,
        tracker_id=tracker_id,
        name="Test raid",
        description="A test raid for contract negotiation",
        acceptance_criteria=acceptance_criteria or [],
        declared_files=declared_files or [],
        estimate_hours=2.0,
        status=status,
        confidence=confidence,
        session_id=session_id,
        branch="raid/test-branch",
        chronicle_summary=None,
        pr_url=None,
        pr_id=None,
        retry_count=0,
        created_at=NOW,
        updated_at=NOW,
        identifier="NIU-100",
        url="https://linear.app/niuu/issue/NIU-100",
        planner_session_id=planner_session_id,
    )


def _make_engine(
    tracker: StubTracker | None = None,
    volundr: StubVolundr | None = None,
    config: ContractConfig | None = None,
    event_bus: InMemoryEventBus | None = None,
    dispatcher_repo: StubDispatcherRepo | None = None,
) -> tuple[ContractEngine, StubTracker, StubVolundr]:
    tracker = tracker or StubTracker()
    volundr = volundr or StubVolundr()
    cfg = config or ContractConfig()
    return (
        ContractEngine(
            tracker_factory=StubTrackerFactory(tracker),
            volundr_factory=StubVolundrFactory(volundr),
            contract_config=cfg,
            event_bus=event_bus,
            dispatcher_repo=dispatcher_repo,
        ),
        tracker,
        volundr,
    )


# ---------------------------------------------------------------------------
# Tests: parse_contract_response
# ---------------------------------------------------------------------------


class TestParseContractResponse:
    def test_agreed_with_json_block(self) -> None:
        text = (
            "CONTRACT_AGREED\n```json\n"
            '{"acceptance_criteria": ["test passes"], "declared_files": ["src/main.py"]}\n'
            "```"
        )
        result = parse_contract_response(text)
        assert result is not None
        assert result["status"] == "agreed"
        assert result["acceptance_criteria"] == ["test passes"]
        assert result["declared_files"] == ["src/main.py"]

    def test_failed_with_json_block(self) -> None:
        text = 'CONTRACT_FAILED\n```json\n{"reason": "Could not agree on scope"}\n```'
        result = parse_contract_response(text)
        assert result is not None
        assert result["status"] == "failed"
        assert result["reason"] == "Could not agree on scope"

    def test_returns_none_for_intermediate_idle(self) -> None:
        text = "I'm still negotiating with the working session..."
        result = parse_contract_response(text)
        assert result is None

    def test_returns_none_for_invalid_json(self) -> None:
        text = "CONTRACT_AGREED\n```json\nnot-valid-json\n```"
        result = parse_contract_response(text)
        assert result is None

    def test_returns_none_when_no_marker(self) -> None:
        text = '```json\n{"acceptance_criteria": ["x"]}\n```'
        result = parse_contract_response(text)
        assert result is None

    def test_agreed_with_multiple_criteria(self) -> None:
        text = (
            "CONTRACT_AGREED\n```json\n"
            '{"acceptance_criteria": ["crit1", "crit2", "crit3"], '
            '"declared_files": ["a.py", "b.py"]}\n'
            "```"
        )
        result = parse_contract_response(text)
        assert result is not None
        assert len(result["acceptance_criteria"]) == 3
        assert len(result["declared_files"]) == 2


# ---------------------------------------------------------------------------
# Tests: build_contract_initial_prompt
# ---------------------------------------------------------------------------


class TestBuildContractInitialPrompt:
    def test_fallback_prompt(self) -> None:
        prompt = build_contract_initial_prompt(
            raid_tracker_id="NIU-100",
            raid_name="Test raid",
            raid_description="A test raid",
            acceptance_criteria=["tests pass"],
            declared_files=["src/main.py"],
            working_session_id="ws-1",
            max_rounds=3,
        )
        assert "NIU-100" in prompt
        assert "Test raid" in prompt
        assert "tests pass" in prompt
        assert "src/main.py" in prompt
        assert "ws-1" in prompt

    def test_with_template(self) -> None:
        template = "Ticket: {tracker_id}, Raid: {raid_name}, Rounds: {max_rounds}"
        prompt = build_contract_initial_prompt(
            raid_tracker_id="NIU-200",
            raid_name="Another raid",
            raid_description="desc",
            acceptance_criteria=[],
            declared_files=[],
            working_session_id="ws-2",
            max_rounds=5,
            template=template,
        )
        assert prompt == "Ticket: NIU-200, Raid: Another raid, Rounds: 5"

    def test_empty_criteria_and_files(self) -> None:
        prompt = build_contract_initial_prompt(
            raid_tracker_id="NIU-300",
            raid_name="Bare raid",
            raid_description="No criteria",
            acceptance_criteria=[],
            declared_files=[],
            working_session_id="ws-3",
            max_rounds=3,
        )
        assert "Existing Acceptance Criteria" not in prompt
        assert "Declared Files" not in prompt


# ---------------------------------------------------------------------------
# Tests: ContractEngine — agreed path
# ---------------------------------------------------------------------------


class TestContractAgreed:
    @pytest.mark.asyncio
    async def test_handle_agreed_updates_raid(self) -> None:
        engine, tracker, volundr = _make_engine()
        raid = _make_raid(planner_session_id="planner-1")
        tracker.raids[TRACKER_ID] = raid
        engine._contract_sessions["planner-1"] = (TRACKER_ID, OWNER_ID)

        output = (
            "CONTRACT_AGREED\n```json\n"
            '{"acceptance_criteria": ["crit1", "crit2"], "declared_files": ["a.py"]}\n'
            "```"
        )
        await engine.handle_contract_completion("planner-1", output)

        updated = tracker.raids[TRACKER_ID]
        assert updated.status == RaidStatus.RUNNING
        assert updated.acceptance_criteria == ["crit1", "crit2"]
        assert updated.declared_files == ["a.py"]

    @pytest.mark.asyncio
    async def test_handle_agreed_posts_comment(self) -> None:
        engine, tracker, volundr = _make_engine()
        raid = _make_raid(planner_session_id="planner-1")
        tracker.raids[TRACKER_ID] = raid
        engine._contract_sessions["planner-1"] = (TRACKER_ID, OWNER_ID)

        output = (
            "CONTRACT_AGREED\n```json\n"
            '{"acceptance_criteria": ["crit1"], "declared_files": ["b.py"]}\n'
            "```"
        )
        await engine.handle_contract_completion("planner-1", output)

        assert len(tracker.comments) == 1
        issue_id, body = tracker.comments[0]
        assert issue_id == TRACKER_ID
        assert "Sprint Contract Agreed" in body
        assert "crit1" in body

    @pytest.mark.asyncio
    async def test_handle_agreed_cleans_up_session(self) -> None:
        engine, tracker, volundr = _make_engine()
        raid = _make_raid(planner_session_id="planner-1")
        tracker.raids[TRACKER_ID] = raid
        engine._contract_sessions["planner-1"] = (TRACKER_ID, OWNER_ID)
        engine._contract_rounds["planner-1"] = 1

        output = (
            "CONTRACT_AGREED\n```json\n"
            '{"acceptance_criteria": ["x"], "declared_files": ["y.py"]}\n'
            "```"
        )
        await engine.handle_contract_completion("planner-1", output)

        assert "planner-1" not in engine._contract_sessions
        assert "planner-1" not in engine._contract_rounds

    @pytest.mark.asyncio
    async def test_handle_agreed_emits_events(self) -> None:
        bus = InMemoryEventBus()
        engine, tracker, volundr = _make_engine(event_bus=bus)
        raid = _make_raid(planner_session_id="planner-1")
        tracker.raids[TRACKER_ID] = raid
        engine._contract_sessions["planner-1"] = (TRACKER_ID, OWNER_ID)

        output = (
            "CONTRACT_AGREED\n```json\n"
            '{"acceptance_criteria": ["x"], "declared_files": ["y.py"]}\n'
            "```"
        )
        await engine.handle_contract_completion("planner-1", output)

        event_names = [e.event for e in bus.get_log(10)]
        assert "contract.agreed" in event_names
        assert "raid.state_changed" in event_names


# ---------------------------------------------------------------------------
# Tests: ContractEngine — failed path
# ---------------------------------------------------------------------------


class TestContractFailed:
    @pytest.mark.asyncio
    async def test_handle_failed_escalates_raid(self) -> None:
        engine, tracker, volundr = _make_engine()
        raid = _make_raid(planner_session_id="planner-1")
        tracker.raids[TRACKER_ID] = raid
        engine._contract_sessions["planner-1"] = (TRACKER_ID, OWNER_ID)

        output = 'CONTRACT_FAILED\n```json\n{"reason": "Scope too ambiguous"}\n```'
        await engine.handle_contract_completion("planner-1", output)

        updated = tracker.raids[TRACKER_ID]
        assert updated.status == RaidStatus.ESCALATED
        assert "planner-1" not in engine._contract_sessions

    @pytest.mark.asyncio
    async def test_handle_failed_emits_events(self) -> None:
        bus = InMemoryEventBus()
        engine, tracker, volundr = _make_engine(event_bus=bus)
        raid = _make_raid(planner_session_id="planner-1")
        tracker.raids[TRACKER_ID] = raid
        engine._contract_sessions["planner-1"] = (TRACKER_ID, OWNER_ID)

        output = 'CONTRACT_FAILED\n```json\n{"reason": "Failed"}\n```'
        await engine.handle_contract_completion("planner-1", output)

        event_names = [e.event for e in bus.get_log(10)]
        assert "contract.failed" in event_names
        assert "raid.state_changed" in event_names


# ---------------------------------------------------------------------------
# Tests: ContractEngine — intermediate idle and max rounds
# ---------------------------------------------------------------------------


class TestIntermediateIdle:
    @pytest.mark.asyncio
    async def test_intermediate_idle_skipped(self) -> None:
        engine, tracker, volundr = _make_engine()
        raid = _make_raid(planner_session_id="planner-1")
        tracker.raids[TRACKER_ID] = raid
        engine._contract_sessions["planner-1"] = (TRACKER_ID, OWNER_ID)

        await engine.handle_contract_completion(
            "planner-1", "Still negotiating with the working session..."
        )

        # Raid should remain in CONTRACTING
        assert tracker.raids[TRACKER_ID].status == RaidStatus.CONTRACTING
        assert engine._contract_rounds["planner-1"] == 1
        assert "planner-1" in engine._contract_sessions

    @pytest.mark.asyncio
    async def test_max_rounds_escalates(self) -> None:
        cfg = ContractConfig(contract_max_rounds=2)
        engine, tracker, volundr = _make_engine(config=cfg)
        raid = _make_raid(planner_session_id="planner-1")
        tracker.raids[TRACKER_ID] = raid
        engine._contract_sessions["planner-1"] = (TRACKER_ID, OWNER_ID)

        # Round 1 — just increments
        await engine.handle_contract_completion("planner-1", "Still thinking...")
        assert tracker.raids[TRACKER_ID].status == RaidStatus.CONTRACTING
        assert engine._contract_rounds["planner-1"] == 1

        # Round 2 — reaches max, escalates
        await engine.handle_contract_completion("planner-1", "Still working on it...")
        assert tracker.raids[TRACKER_ID].status == RaidStatus.ESCALATED
        assert "planner-1" not in engine._contract_sessions


# ---------------------------------------------------------------------------
# Tests: ContractEngine — evaluate (spawn planner)
# ---------------------------------------------------------------------------


class TestEvaluate:
    @pytest.mark.asyncio
    async def test_evaluate_spawns_planner(self) -> None:
        engine, tracker, volundr = _make_engine()
        raid = _make_raid()
        tracker.raids[TRACKER_ID] = raid

        await engine.evaluate(TRACKER_ID, OWNER_ID)

        assert len(volundr.spawned) == 1
        assert volundr.spawned[0].workload_type == "planner"
        assert "planner-session-1" in engine._contract_sessions

    @pytest.mark.asyncio
    async def test_evaluate_sends_wait_prompt(self) -> None:
        engine, tracker, volundr = _make_engine()
        raid = _make_raid()
        tracker.raids[TRACKER_ID] = raid

        await engine.evaluate(TRACKER_ID, OWNER_ID)

        # Wait prompt sent to the working session
        wait_messages = [(sid, msg) for sid, msg in volundr.messages if "Stand by" in msg]
        assert len(wait_messages) == 1

    @pytest.mark.asyncio
    async def test_evaluate_persists_planner_session_id(self) -> None:
        engine, tracker, volundr = _make_engine()
        raid = _make_raid()
        tracker.raids[TRACKER_ID] = raid

        await engine.evaluate(TRACKER_ID, OWNER_ID)

        updated = tracker.raids[TRACKER_ID]
        assert updated.planner_session_id == "planner-session-1"

    @pytest.mark.asyncio
    async def test_evaluate_disabled_skips(self) -> None:
        cfg = ContractConfig(contract_enabled=False)
        engine, tracker, volundr = _make_engine(config=cfg)
        raid = _make_raid()
        tracker.raids[TRACKER_ID] = raid

        await engine.evaluate(TRACKER_ID, OWNER_ID)

        assert len(volundr.spawned) == 0
        assert len(engine._contract_sessions) == 0

    @pytest.mark.asyncio
    async def test_evaluate_spawn_failure_escalates(self) -> None:
        engine, tracker, volundr = _make_engine()
        volundr.fail_spawn = True
        raid = _make_raid()
        tracker.raids[TRACKER_ID] = raid

        await engine.evaluate(TRACKER_ID, OWNER_ID)

        assert tracker.raids[TRACKER_ID].status == RaidStatus.ESCALATED

    @pytest.mark.asyncio
    async def test_evaluate_wrong_status_raises(self) -> None:
        engine, tracker, volundr = _make_engine()
        raid = _make_raid(status=RaidStatus.RUNNING)
        tracker.raids[TRACKER_ID] = raid

        with pytest.raises(ValueError, match="not in CONTRACTING"):
            await engine.evaluate(TRACKER_ID, OWNER_ID)


# ---------------------------------------------------------------------------
# Tests: ContractEngine — lifecycle (start/stop/rebuild)
# ---------------------------------------------------------------------------


class TestLifecycle:
    @pytest.mark.asyncio
    async def test_start_stop(self) -> None:
        bus = InMemoryEventBus()
        engine, _, _ = _make_engine(event_bus=bus)

        await engine.start()
        assert engine.running

        await engine.stop()
        assert not engine.running

    @pytest.mark.asyncio
    async def test_rebuild_contract_sessions(self) -> None:
        tracker = StubTracker()
        raid = _make_raid(planner_session_id="planner-rebuild-1")
        tracker.raids[TRACKER_ID] = raid

        dispatcher_repo = StubDispatcherRepo(owner_ids=[OWNER_ID])
        engine, _, _ = _make_engine(
            tracker=tracker,
            dispatcher_repo=dispatcher_repo,
        )

        await engine._rebuild_contract_sessions()

        assert "planner-rebuild-1" in engine._contract_sessions
        tid, oid = engine._contract_sessions["planner-rebuild-1"]
        assert tid == TRACKER_ID
        assert oid == OWNER_ID

    @pytest.mark.asyncio
    async def test_rebuild_ignores_raids_without_planner_session(self) -> None:
        tracker = StubTracker()
        raid = _make_raid(planner_session_id=None)
        tracker.raids[TRACKER_ID] = raid

        dispatcher_repo = StubDispatcherRepo(owner_ids=[OWNER_ID])
        engine, _, _ = _make_engine(
            tracker=tracker,
            dispatcher_repo=dispatcher_repo,
        )

        await engine._rebuild_contract_sessions()

        assert len(engine._contract_sessions) == 0

    @pytest.mark.asyncio
    async def test_get_contract_raid_returns_none_for_unknown(self) -> None:
        engine, _, _ = _make_engine()
        assert engine.get_contract_raid("unknown-session") is None

    @pytest.mark.asyncio
    async def test_get_contract_raid_returns_mapping(self) -> None:
        engine, _, _ = _make_engine()
        engine._contract_sessions["planner-1"] = (TRACKER_ID, OWNER_ID)
        result = engine.get_contract_raid("planner-1")
        assert result == (TRACKER_ID, OWNER_ID)


# ---------------------------------------------------------------------------
# Tests: ContractEngine — event-driven
# ---------------------------------------------------------------------------


class TestEventDriven:
    @pytest.mark.asyncio
    async def test_listen_reacts_to_contracting_event(self) -> None:
        bus = InMemoryEventBus()
        engine, tracker, volundr = _make_engine(event_bus=bus)
        raid = _make_raid()
        tracker.raids[TRACKER_ID] = raid

        await engine.start()
        await asyncio.sleep(0)  # yield so listener task subscribes

        # Emit a CONTRACTING event
        from tyr.ports.event_bus import TyrEvent

        await bus.emit(
            TyrEvent(
                event="raid.state_changed",
                owner_id=OWNER_ID,
                data={"tracker_id": TRACKER_ID, "status": "CONTRACTING"},
            )
        )

        # Give the listener task time to process
        await asyncio.sleep(0.1)
        await engine.stop()

        # Engine should have spawned a planner session
        assert len(volundr.spawned) == 1

    @pytest.mark.asyncio
    async def test_listen_ignores_non_contracting_events(self) -> None:
        bus = InMemoryEventBus()
        engine, tracker, volundr = _make_engine(event_bus=bus)
        raid = _make_raid(status=RaidStatus.REVIEW)
        tracker.raids[TRACKER_ID] = raid

        await engine.start()
        await asyncio.sleep(0)  # yield so listener task subscribes

        from tyr.ports.event_bus import TyrEvent

        await bus.emit(
            TyrEvent(
                event="raid.state_changed",
                owner_id=OWNER_ID,
                data={"tracker_id": TRACKER_ID, "status": "REVIEW"},
            )
        )

        await asyncio.sleep(0.1)
        await engine.stop()

        assert len(volundr.spawned) == 0


# ---------------------------------------------------------------------------
# Tests: ContractConfig
# ---------------------------------------------------------------------------


class TestContractConfig:
    def test_defaults(self) -> None:
        cfg = ContractConfig()
        assert cfg.contract_enabled is True
        assert cfg.contract_model == "claude-sonnet-4-6"
        assert cfg.contract_max_rounds == 3
        assert cfg.contract_profile == "planner"
        assert "Stand by" in cfg.working_session_wait_prompt

    def test_override(self) -> None:
        cfg = ContractConfig(contract_max_rounds=5, contract_enabled=False)
        assert cfg.contract_max_rounds == 5
        assert cfg.contract_enabled is False


# ---------------------------------------------------------------------------
# Tests: Edge cases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    @pytest.mark.asyncio
    async def test_unknown_session_ignored(self) -> None:
        engine, tracker, volundr = _make_engine()
        # Should not raise
        await engine.handle_contract_completion("unknown-session", "some output")

    @pytest.mark.asyncio
    async def test_raid_no_longer_contracting_skipped(self) -> None:
        engine, tracker, volundr = _make_engine()
        raid = _make_raid(status=RaidStatus.RUNNING, planner_session_id="planner-1")
        tracker.raids[TRACKER_ID] = raid
        engine._contract_sessions["planner-1"] = (TRACKER_ID, OWNER_ID)

        output = (
            "CONTRACT_AGREED\n```json\n"
            '{"acceptance_criteria": ["x"], "declared_files": ["y.py"]}\n'
            "```"
        )
        await engine.handle_contract_completion("planner-1", output)

        # Session should be cleaned up but status unchanged
        assert tracker.raids[TRACKER_ID].status == RaidStatus.RUNNING
        assert "planner-1" not in engine._contract_sessions

    @pytest.mark.asyncio
    async def test_evaluate_no_working_session(self) -> None:
        """Evaluate succeeds even when the raid has no session_id."""
        engine, tracker, volundr = _make_engine()
        raid = _make_raid(session_id=None)
        tracker.raids[TRACKER_ID] = raid

        await engine.evaluate(TRACKER_ID, OWNER_ID)

        assert len(volundr.spawned) == 1
        # No wait prompt sent since no working session
        assert len(volundr.messages) == 0


class TestParseContractResponseAdditional:
    """Additional parser tests for coverage of edge-case branches."""

    def test_agreed_without_code_fence(self) -> None:
        """CONTRACT_AGREED with raw JSON (no code fence) — fallback parsing."""
        text = 'CONTRACT_AGREED\n{"acceptance_criteria": ["a"], "declared_files": ["b.py"]}'
        result = parse_contract_response(text)
        assert result is not None
        assert result["status"] == "agreed"
        assert result["acceptance_criteria"] == ["a"]

    def test_non_dict_json_returns_none(self) -> None:
        text = "CONTRACT_AGREED\n```json\n[1, 2, 3]\n```"
        result = parse_contract_response(text)
        assert result is None

    def test_non_list_criteria_returns_none(self) -> None:
        text = (
            "CONTRACT_AGREED\n```json\n"
            '{"acceptance_criteria": "not a list", "declared_files": []}\n'
            "```"
        )
        result = parse_contract_response(text)
        assert result is None

    def test_failed_without_code_fence(self) -> None:
        text = 'CONTRACT_FAILED\n{"reason": "too vague"}'
        result = parse_contract_response(text)
        assert result is not None
        assert result["status"] == "failed"
        assert result["reason"] == "too vague"
