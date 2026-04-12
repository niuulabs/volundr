"""Tests for tyr.adapters.event_trigger.EventTriggerAdapter."""

from __future__ import annotations

import asyncio
import textwrap
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest

from sleipnir.adapters.in_process import InProcessBus
from sleipnir.domain.events import SleipnirEvent
from tyr.adapters.event_trigger import (
    EventTriggerAdapter,
    _TriggerRule,
    load_template,
    matches_filter,
)
from tyr.adapters.memory_event_bus import InMemoryEventBus
from tyr.domain.models import Phase, Raid, RaidStatus, Saga, SagaStatus
from tyr.ports.event_bus import TyrEvent
from tyr.ports.saga_repository import SagaRepository
from tyr.ports.volundr import (
    ActivityEvent,
    PRStatus,
    SpawnRequest,
    VolundrPort,
    VolundrSession,
)

# ---------------------------------------------------------------------------
# Stubs
# ---------------------------------------------------------------------------

_TS = datetime(2026, 4, 12, 10, 0, 0, tzinfo=UTC)
_OWNER = "test-owner"


class InMemorySagaRepository(SagaRepository):
    """In-memory saga repository for tests."""

    def __init__(self) -> None:
        self.sagas: dict[UUID, Saga] = {}
        self.phases: dict[UUID, Phase] = {}
        self.raids: dict[UUID, Raid] = {}

    async def save_saga(self, saga: Saga, *, conn: Any = None) -> None:
        self.sagas[saga.id] = saga

    async def save_phase(self, phase: Phase, *, conn: Any = None) -> None:
        self.phases[phase.id] = phase

    async def save_raid(self, raid: Raid, *, conn: Any = None) -> None:
        self.raids[raid.id] = raid

    async def list_sagas(self, *, owner_id: str | None = None) -> list[Saga]:
        if owner_id is None:
            return list(self.sagas.values())
        return [s for s in self.sagas.values() if s.owner_id == owner_id]

    async def get_saga(self, saga_id: UUID, *, owner_id: str | None = None) -> Saga | None:
        return self.sagas.get(saga_id)

    async def get_saga_by_slug(self, slug: str) -> Saga | None:
        return next((s for s in self.sagas.values() if s.slug == slug), None)

    async def delete_saga(self, saga_id: UUID, *, owner_id: str | None = None) -> bool:
        return self.sagas.pop(saga_id, None) is not None

    async def update_saga_status(self, saga_id: UUID, status: SagaStatus) -> None:
        saga = self.sagas.get(saga_id)
        if saga:
            self.sagas[saga_id] = Saga(
                id=saga.id,
                tracker_id=saga.tracker_id,
                tracker_type=saga.tracker_type,
                slug=saga.slug,
                name=saga.name,
                repos=saga.repos,
                feature_branch=saga.feature_branch,
                base_branch=saga.base_branch,
                status=status,
                confidence=saga.confidence,
                created_at=saga.created_at,
                owner_id=saga.owner_id,
            )

    async def count_by_status(self) -> dict[str, int]:
        return {}


class StubVolundrPort(VolundrPort):
    """Stub Volundr port that records spawn requests."""

    def __init__(self, session_id: str = "sess-001") -> None:
        self._session_id = session_id
        self.spawned: list[SpawnRequest] = []

    async def spawn_session(
        self, request: SpawnRequest, *, auth_token: str | None = None
    ) -> VolundrSession:
        self.spawned.append(request)
        return VolundrSession(
            id=self._session_id,
            name=request.name,
            status="running",
            tracker_issue_id=request.tracker_issue_id,
        )

    async def get_session(
        self, session_id: str, *, auth_token: str | None = None
    ) -> VolundrSession | None:
        return None

    async def list_sessions(self, *, auth_token: str | None = None) -> list[VolundrSession]:
        return []

    async def get_pr_status(self, session_id: str) -> PRStatus:
        return PRStatus(exists=False, merged=False, url=None, ci_passed=False)

    async def get_chronicle_summary(self, session_id: str) -> str:
        return ""

    async def send_message(
        self, session_id: str, message: str, *, auth_token: str | None = None
    ) -> None:
        pass

    async def stop_session(self, session_id: str, *, auth_token: str | None = None) -> None:
        pass

    async def list_integration_ids(self, *, auth_token: str | None = None) -> list[str]:
        return []

    async def list_repos(self, *, auth_token: str | None = None) -> list[dict]:
        return []

    async def get_last_assistant_message(self, session_id: str) -> str:
        return ""

    async def get_conversation(self, session_id: str) -> dict:
        return {}

    async def subscribe_activity(self) -> AsyncGenerator[ActivityEvent, None]:
        return
        yield  # type: ignore[misc]


class StubVolundrFactory:
    """Factory that always returns the same stub adapter."""

    def __init__(self, volundr: VolundrPort | None = None) -> None:
        self._volundr = volundr or StubVolundrPort()

    async def for_owner(self, owner_id: str) -> list[VolundrPort]:
        if self._volundr is None:
            return []
        return [self._volundr]

    async def primary_for_owner(self, owner_id: str) -> VolundrPort | None:
        return self._volundr


def _make_sleipnir_event(
    event_type: str,
    payload: dict | None = None,
    *,
    correlation_id: str | None = None,
) -> SleipnirEvent:
    return SleipnirEvent(
        event_type=event_type,
        source="test:source",
        payload=payload or {},
        summary="test event",
        urgency=0.5,
        domain="code",
        timestamp=_TS,
        correlation_id=correlation_id,
    )


def _make_rule(
    event_pattern: str = "github.pr.opened",
    saga_template: str = "review",
    auto_start: bool = True,
    filter: dict | None = None,
) -> _TriggerRule:
    return _TriggerRule(
        event_pattern=event_pattern,
        saga_template=saga_template,
        auto_start=auto_start,
        filter=filter or {},
    )


def _make_adapter(
    *,
    subscriber: object = None,
    saga_repo: SagaRepository | None = None,
    volundr_factory: object = None,
    event_bus: InMemoryEventBus | None = None,
    rules: list[_TriggerRule] | None = None,
    templates_dir: Path | None = None,
) -> EventTriggerAdapter:
    from tyr.adapters.event_trigger import _BUNDLED_TEMPLATES_DIR

    return EventTriggerAdapter(
        subscriber=subscriber or InProcessBus(),
        saga_repo=saga_repo or InMemorySagaRepository(),
        volundr_factory=volundr_factory or StubVolundrFactory(),
        event_bus=event_bus or InMemoryEventBus(),
        rules=rules if rules is not None else [_make_rule()],
        templates_dir=templates_dir or _BUNDLED_TEMPLATES_DIR,
        owner_id=_OWNER,
    )


# ---------------------------------------------------------------------------
# Unit tests: matches_filter
# ---------------------------------------------------------------------------


class TestMatchesFilter:
    def test_empty_filter_always_matches(self):
        assert matches_filter({"branch": "main"}, {}) is True

    def test_matching_single_key(self):
        assert matches_filter({"branch": "main"}, {"branch": "main"}) is True

    def test_mismatching_single_key(self):
        assert matches_filter({"branch": "dev"}, {"branch": "main"}) is False

    def test_missing_key_in_payload(self):
        assert matches_filter({}, {"branch": "main"}) is False

    def test_all_keys_must_match(self):
        payload = {"branch": "main", "label": "bug"}
        assert matches_filter(payload, {"branch": "main", "label": "bug"}) is True
        assert matches_filter(payload, {"branch": "main", "label": "feature"}) is False

    def test_value_coerced_to_string(self):
        # Event payload values may be integers from JSON
        assert matches_filter({"pr_number": 42}, {"pr_number": "42"}) is True


# ---------------------------------------------------------------------------
# Unit tests: load_template
# ---------------------------------------------------------------------------


class TestLoadTemplate:
    def test_loads_bundled_review_template(self, tmp_path):
        from tyr.adapters.event_trigger import _BUNDLED_TEMPLATES_DIR

        payload = {
            "repo": "niuulabs/volundr",
            "pr_number": "99",
            "branch": "feat/test",
            "base_branch": "main",
            "title": "Fix the bug",
            "author": "alice",
            "pr_url": "https://github.com/niuulabs/volundr/pull/99",
        }
        tpl = load_template("review", _BUNDLED_TEMPLATES_DIR, payload)

        assert "99" in tpl.name
        assert len(tpl.phases) == 1
        assert len(tpl.phases[0].raids) == 1

    def test_missing_template_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            load_template("nonexistent_template", tmp_path, {})

    def test_interpolation_replaces_event_placeholders(self, tmp_path):
        template_file = tmp_path / "simple.yaml"
        template_file.write_text(
            textwrap.dedent("""\
                name: "Test {event.repo}"
                feature_branch: "{event.branch}"
                base_branch: main
                repos:
                  - "{event.repo}"
                phases:
                  - name: Do It
                    raids:
                      - name: "Raid for {event.repo}"
                        description: "Desc"
                        acceptance_criteria: ["Done"]
                        declared_files: []
                        estimate_hours: 1.0
                        prompt: "Do something in {event.repo}"
            """),
            encoding="utf-8",
        )
        payload = {"repo": "my-repo", "branch": "feat/x"}
        tpl = load_template("simple", tmp_path, payload)

        assert tpl.name == "Test my-repo"
        assert tpl.feature_branch == "feat/x"
        assert tpl.repos == ["my-repo"]
        raid = tpl.phases[0].raids[0]
        assert raid.name == "Raid for my-repo"
        assert "my-repo" in raid.prompt

    def test_unknown_placeholder_left_intact(self, tmp_path):
        template_file = tmp_path / "partial.yaml"
        template_file.write_text(
            textwrap.dedent("""\
                name: "Test {event.known} and {event.unknown}"
                feature_branch: main
                base_branch: main
                repos: []
                phases: []
            """),
            encoding="utf-8",
        )
        tpl = load_template("partial", tmp_path, {"known": "hello"})
        assert "hello" in tpl.name
        assert "{event.unknown}" in tpl.name

    def test_custom_templates_dir_takes_priority(self, tmp_path):
        custom = tmp_path / "review.yaml"
        custom.write_text(
            textwrap.dedent("""\
                name: "Custom Review"
                feature_branch: main
                base_branch: main
                repos: []
                phases: []
            """),
            encoding="utf-8",
        )
        tpl = load_template("review", tmp_path, {})
        assert tpl.name == "Custom Review"


# ---------------------------------------------------------------------------
# Lifecycle tests
# ---------------------------------------------------------------------------


class TestEventTriggerAdapterLifecycle:
    async def test_start_subscribes_to_configured_patterns(self):
        bus = InProcessBus()
        adapter = _make_adapter(subscriber=bus, rules=[_make_rule("github.pr.opened")])

        assert not adapter.is_running
        await adapter.start()
        assert adapter.is_running
        await adapter.stop()

    async def test_start_is_idempotent(self):
        bus = InProcessBus()
        adapter = _make_adapter(subscriber=bus)
        await adapter.start()
        sub_before = adapter._subscription
        await adapter.start()
        assert adapter._subscription is sub_before
        await adapter.stop()

    async def test_stop_unsubscribes(self):
        bus = InProcessBus()
        adapter = _make_adapter(subscriber=bus)
        await adapter.start()
        await adapter.stop()
        assert not adapter.is_running
        assert adapter._subscription is None

    async def test_stop_when_not_started_is_safe(self):
        adapter = _make_adapter()
        await adapter.stop()  # must not raise

    async def test_no_rules_does_not_subscribe(self):
        bus = InProcessBus()
        adapter = _make_adapter(subscriber=bus, rules=[])
        await adapter.start()
        # Still safe; just no subscription created
        assert adapter._subscription is None
        await adapter.stop()


# ---------------------------------------------------------------------------
# Saga creation: auto_start=True
# ---------------------------------------------------------------------------


class TestEventTriggerAutoStart:
    async def test_matching_event_creates_saga_in_repo(self, tmp_path):
        _write_minimal_template(tmp_path, "review")
        saga_repo = InMemorySagaRepository()
        bus = InProcessBus()
        adapter = _make_adapter(
            subscriber=bus,
            saga_repo=saga_repo,
            templates_dir=tmp_path,
            rules=[_make_rule("github.pr.opened", auto_start=True)],
        )
        await adapter.start()

        await bus.publish(_make_sleipnir_event("github.pr.opened", {"repo": "niuulabs/test"}))
        await bus.flush()
        await asyncio.sleep(0)  # let create_task run

        assert len(saga_repo.sagas) == 1
        saga = list(saga_repo.sagas.values())[0]
        assert saga.owner_id == _OWNER
        assert saga.tracker_type == "native"
        assert saga.status == SagaStatus.ACTIVE

        await adapter.stop()

    async def test_matching_event_creates_phase_and_raid(self, tmp_path):
        _write_minimal_template(tmp_path, "review")
        saga_repo = InMemorySagaRepository()
        bus = InProcessBus()
        adapter = _make_adapter(
            subscriber=bus,
            saga_repo=saga_repo,
            templates_dir=tmp_path,
            rules=[_make_rule("github.pr.opened", auto_start=True)],
        )
        await adapter.start()

        await bus.publish(_make_sleipnir_event("github.pr.opened", {"repo": "repo/x"}))
        await bus.flush()
        await asyncio.sleep(0)

        assert len(saga_repo.phases) == 1
        assert len(saga_repo.raids) == 1

        await adapter.stop()

    async def test_auto_start_spawns_volundr_session(self, tmp_path):
        _write_minimal_template(tmp_path, "review")
        volundr = StubVolundrPort()
        factory = StubVolundrFactory(volundr)
        bus = InProcessBus()
        adapter = _make_adapter(
            subscriber=bus,
            volundr_factory=factory,
            templates_dir=tmp_path,
            rules=[_make_rule("github.pr.opened", auto_start=True)],
        )
        await adapter.start()

        await bus.publish(_make_sleipnir_event("github.pr.opened", {"repo": "niuulabs/test"}))
        await bus.flush()
        await asyncio.sleep(0)

        assert len(volundr.spawned) == 1

        await adapter.stop()

    async def test_auto_start_updates_raid_to_running(self, tmp_path):
        _write_minimal_template(tmp_path, "review")
        saga_repo = InMemorySagaRepository()
        bus = InProcessBus()
        adapter = _make_adapter(
            subscriber=bus,
            saga_repo=saga_repo,
            templates_dir=tmp_path,
            rules=[_make_rule("github.pr.opened", auto_start=True)],
        )
        await adapter.start()
        await bus.publish(_make_sleipnir_event("github.pr.opened", {"repo": "r"}))
        await bus.flush()
        await asyncio.sleep(0)

        raid = list(saga_repo.raids.values())[0]
        assert raid.status == RaidStatus.RUNNING
        assert raid.session_id == "sess-001"

        await adapter.stop()

    async def test_auto_start_emits_saga_created_and_raid_state_changed(self, tmp_path):
        _write_minimal_template(tmp_path, "review")
        event_bus = InMemoryEventBus()
        q = event_bus.subscribe()
        bus = InProcessBus()
        adapter = _make_adapter(
            subscriber=bus,
            event_bus=event_bus,
            templates_dir=tmp_path,
            rules=[_make_rule("github.pr.opened", auto_start=True)],
        )
        await adapter.start()
        await bus.publish(_make_sleipnir_event("github.pr.opened", {"repo": "r"}))
        await bus.flush()
        await asyncio.sleep(0)

        events: list[TyrEvent] = []
        while not q.empty():
            events.append(q.get_nowait())

        event_types = {e.event for e in events}
        assert "saga.created" in event_types
        assert "raid.state_changed" in event_types

        await adapter.stop()

    async def test_no_volundr_adapter_logs_error_but_does_not_raise(self, tmp_path):
        _write_minimal_template(tmp_path, "review")
        factory = StubVolundrFactory(None)
        bus = InProcessBus()
        adapter = _make_adapter(
            subscriber=bus,
            volundr_factory=factory,
            templates_dir=tmp_path,
            rules=[_make_rule("github.pr.opened", auto_start=True)],
        )
        await adapter.start()
        # Must not raise even though no Volundr adapter is available
        await bus.publish(_make_sleipnir_event("github.pr.opened", {"repo": "r"}))
        await bus.flush()
        await asyncio.sleep(0)
        await adapter.stop()


# ---------------------------------------------------------------------------
# Saga creation: auto_start=False
# ---------------------------------------------------------------------------


class TestEventTriggerPendingApproval:
    async def test_auto_start_false_creates_pending_raid(self, tmp_path):
        _write_minimal_template(tmp_path, "review")
        saga_repo = InMemorySagaRepository()
        bus = InProcessBus()
        adapter = _make_adapter(
            subscriber=bus,
            saga_repo=saga_repo,
            templates_dir=tmp_path,
            rules=[_make_rule("github.pr.opened", auto_start=False)],
        )
        await adapter.start()
        await bus.publish(_make_sleipnir_event("github.pr.opened", {"repo": "r"}))
        await bus.flush()
        await asyncio.sleep(0)

        raid = list(saga_repo.raids.values())[0]
        assert raid.status == RaidStatus.PENDING

        await adapter.stop()

    async def test_auto_start_false_does_not_spawn_session(self, tmp_path):
        _write_minimal_template(tmp_path, "review")
        volundr = StubVolundrPort()
        factory = StubVolundrFactory(volundr)
        bus = InProcessBus()
        adapter = _make_adapter(
            subscriber=bus,
            volundr_factory=factory,
            templates_dir=tmp_path,
            rules=[_make_rule("github.pr.opened", auto_start=False)],
        )
        await adapter.start()
        await bus.publish(_make_sleipnir_event("github.pr.opened", {"repo": "r"}))
        await bus.flush()
        await asyncio.sleep(0)

        assert len(volundr.spawned) == 0

        await adapter.stop()

    async def test_auto_start_false_emits_needs_approval(self, tmp_path):
        _write_minimal_template(tmp_path, "review")
        event_bus = InMemoryEventBus()
        q = event_bus.subscribe()
        bus = InProcessBus()
        adapter = _make_adapter(
            subscriber=bus,
            event_bus=event_bus,
            templates_dir=tmp_path,
            rules=[_make_rule("github.pr.opened", auto_start=False)],
        )
        await adapter.start()
        await bus.publish(_make_sleipnir_event("github.pr.opened", {"repo": "r"}))
        await bus.flush()
        await asyncio.sleep(0)

        events: list[TyrEvent] = []
        while not q.empty():
            events.append(q.get_nowait())

        approval_events = [e for e in events if e.event == "raid.needs_approval"]
        assert len(approval_events) == 1
        assert approval_events[0].owner_id == _OWNER

        await adapter.stop()


# ---------------------------------------------------------------------------
# Filter matching
# ---------------------------------------------------------------------------


class TestEventTriggerFilterMatching:
    async def test_nonmatching_filter_ignores_event(self, tmp_path):
        _write_minimal_template(tmp_path, "review")
        saga_repo = InMemorySagaRepository()
        bus = InProcessBus()
        adapter = _make_adapter(
            subscriber=bus,
            saga_repo=saga_repo,
            templates_dir=tmp_path,
            rules=[_make_rule("github.pr.merged", filter={"branch": "main"})],
        )
        await adapter.start()

        # branch=dev does not match filter branch=main
        await bus.publish(_make_sleipnir_event("github.pr.merged", {"branch": "dev", "repo": "r"}))
        await bus.flush()
        await asyncio.sleep(0)

        assert len(saga_repo.sagas) == 0

        await adapter.stop()

    async def test_matching_filter_triggers_saga(self, tmp_path):
        _write_minimal_template(tmp_path, "review")
        saga_repo = InMemorySagaRepository()
        bus = InProcessBus()
        adapter = _make_adapter(
            subscriber=bus,
            saga_repo=saga_repo,
            templates_dir=tmp_path,
            rules=[_make_rule("github.pr.merged", filter={"branch": "main"})],
        )
        await adapter.start()

        await bus.publish(_make_sleipnir_event("github.pr.merged", {"branch": "main", "repo": "r"}))
        await bus.flush()
        await asyncio.sleep(0)

        assert len(saga_repo.sagas) == 1

        await adapter.stop()

    async def test_nonmatching_event_pattern_ignored(self, tmp_path):
        _write_minimal_template(tmp_path, "review")
        saga_repo = InMemorySagaRepository()
        bus = InProcessBus()
        adapter = _make_adapter(
            subscriber=bus,
            saga_repo=saga_repo,
            templates_dir=tmp_path,
            rules=[_make_rule("github.pr.opened")],
        )
        await adapter.start()

        # ravn.session.ended does not match github.pr.opened
        await bus.publish(
            _make_sleipnir_event(
                "ravn.session.ended",
                {"session_id": "s-1", "repo": "r", "outcome": "ok", "duration_seconds": "60"},
            )
        )
        await bus.flush()
        await asyncio.sleep(0)

        assert len(saga_repo.sagas) == 0

        await adapter.stop()


# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------


class TestEventTriggerDeduplication:
    async def test_same_correlation_id_creates_only_one_saga(self, tmp_path):
        _write_minimal_template(tmp_path, "review")
        saga_repo = InMemorySagaRepository()
        bus = InProcessBus()
        adapter = _make_adapter(
            subscriber=bus,
            saga_repo=saga_repo,
            templates_dir=tmp_path,
            rules=[_make_rule("github.pr.opened")],
        )
        await adapter.start()

        event = _make_sleipnir_event("github.pr.opened", {"repo": "r"}, correlation_id="corr-123")
        await bus.publish(event)
        await bus.publish(event)
        await bus.flush()
        await asyncio.sleep(0)

        assert len(saga_repo.sagas) == 1

        await adapter.stop()

    async def test_different_correlation_ids_create_separate_sagas(self, tmp_path):
        _write_minimal_template(tmp_path, "review")
        saga_repo = InMemorySagaRepository()
        bus = InProcessBus()
        adapter = _make_adapter(
            subscriber=bus,
            saga_repo=saga_repo,
            templates_dir=tmp_path,
            rules=[_make_rule("github.pr.opened")],
        )
        await adapter.start()

        await bus.publish(
            _make_sleipnir_event("github.pr.opened", {"repo": "r"}, correlation_id="corr-A")
        )
        await bus.publish(
            _make_sleipnir_event("github.pr.opened", {"repo": "r"}, correlation_id="corr-B")
        )
        await bus.flush()
        await asyncio.sleep(0)

        assert len(saga_repo.sagas) == 2

        await adapter.stop()

    async def test_dedup_uses_event_id_when_no_correlation_id(self, tmp_path):
        _write_minimal_template(tmp_path, "review")
        saga_repo = InMemorySagaRepository()
        bus = InProcessBus()
        adapter = _make_adapter(
            subscriber=bus,
            saga_repo=saga_repo,
            templates_dir=tmp_path,
            rules=[_make_rule("github.pr.opened")],
        )
        await adapter.start()

        event = _make_sleipnir_event("github.pr.opened", {"repo": "r"})
        # Publish the same object twice; event_id will be identical
        await bus.publish(event)
        await bus.publish(event)
        await bus.flush()
        await asyncio.sleep(0)

        assert len(saga_repo.sagas) == 1

        await adapter.stop()


# ---------------------------------------------------------------------------
# Missing template
# ---------------------------------------------------------------------------


class TestEventTriggerMissingTemplate:
    async def test_missing_template_logs_and_does_not_create_saga(self, tmp_path):
        saga_repo = InMemorySagaRepository()
        bus = InProcessBus()
        adapter = _make_adapter(
            subscriber=bus,
            saga_repo=saga_repo,
            templates_dir=tmp_path,  # empty dir, no templates
            rules=[_make_rule("github.pr.opened", saga_template="nonexistent")],
        )
        await adapter.start()

        await bus.publish(_make_sleipnir_event("github.pr.opened", {"repo": "r"}))
        await bus.flush()
        await asyncio.sleep(0)

        assert len(saga_repo.sagas) == 0

        await adapter.stop()


# ---------------------------------------------------------------------------
# Bundled templates smoke tests
# ---------------------------------------------------------------------------


class TestBundledTemplates:
    def test_review_template_loads(self):
        from tyr.adapters.event_trigger import _BUNDLED_TEMPLATES_DIR

        payload = {
            "repo": "niuulabs/v",
            "pr_number": "1",
            "branch": "feat/x",
            "base_branch": "main",
            "title": "My PR",
            "author": "bob",
            "pr_url": "https://github.com/niuulabs/v/pull/1",
        }
        tpl = load_template("review", _BUNDLED_TEMPLATES_DIR, payload)
        assert tpl.name
        assert len(tpl.phases) >= 1

    def test_deploy_template_loads(self):
        from tyr.adapters.event_trigger import _BUNDLED_TEMPLATES_DIR

        payload = {
            "repo": "niuulabs/v",
            "sha": "abc123def456",
            "sha_short": "abc123d",
            "title": "Merge feat/x",
            "pr_url": "https://github.com/niuulabs/v/pull/1",
            "author": "bob",
        }
        tpl = load_template("deploy", _BUNDLED_TEMPLATES_DIR, payload)
        assert tpl.name

    def test_investigate_template_loads(self):
        from tyr.adapters.event_trigger import _BUNDLED_TEMPLATES_DIR

        payload = {
            "repo": "niuulabs/v",
            "issue_number": "42",
            "title": "Something is broken",
            "author": "alice",
            "issue_url": "https://github.com/niuulabs/v/issues/42",
            "body": "It crashes on startup.",
        }
        tpl = load_template("investigate", _BUNDLED_TEMPLATES_DIR, payload)
        assert tpl.name

    def test_reflect_template_loads(self):
        from tyr.adapters.event_trigger import _BUNDLED_TEMPLATES_DIR

        payload = {
            "session_id": "sess-xyz",
            "repo": "niuulabs/v",
            "outcome": "success",
            "duration_seconds": "120",
        }
        tpl = load_template("reflect", _BUNDLED_TEMPLATES_DIR, payload)
        assert tpl.name


# ---------------------------------------------------------------------------
# build_event_trigger_adapter factory
# ---------------------------------------------------------------------------


class TestBuildEventTriggerAdapter:
    def test_build_from_config(self, tmp_path):
        from tyr.adapters.event_trigger import build_event_trigger_adapter
        from tyr.config import EventTriggerConfig, EventTriggerRule

        cfg = EventTriggerConfig(
            enabled=True,
            owner_id="owner-1",
            templates_dir=str(tmp_path),
            default_model="claude-haiku-4-5-20251001",
            dedup_cache_size=500,
            rules=[
                EventTriggerRule(
                    event="github.pr.opened",
                    saga_template="review",
                    auto_start=True,
                )
            ],
        )
        adapter = build_event_trigger_adapter(
            subscriber=InProcessBus(),
            saga_repo=InMemorySagaRepository(),
            volundr_factory=StubVolundrFactory(),
            event_bus=InMemoryEventBus(),
            config=cfg,
        )
        assert len(adapter._rules) == 1
        assert adapter._rules[0].event_pattern == "github.pr.opened"
        assert adapter._rules[0].auto_start is True
        assert adapter._owner_id == "owner-1"
        assert adapter._default_model == "claude-haiku-4-5-20251001"

    def test_build_with_default_templates_dir(self):
        from tyr.adapters.event_trigger import (
            _BUNDLED_TEMPLATES_DIR,
            build_event_trigger_adapter,
        )
        from tyr.config import EventTriggerConfig

        cfg = EventTriggerConfig(enabled=True)
        adapter = build_event_trigger_adapter(
            subscriber=InProcessBus(),
            saga_repo=InMemorySagaRepository(),
            volundr_factory=StubVolundrFactory(),
            event_bus=InMemoryEventBus(),
            config=cfg,
        )
        assert adapter._templates_dir == _BUNDLED_TEMPLATES_DIR


# ---------------------------------------------------------------------------
# NotificationService: raid.needs_approval
# ---------------------------------------------------------------------------


class TestNotificationServiceNeedsApproval:
    async def test_needs_approval_emits_high_urgency_notification(self):
        from tyr.domain.services.notification import NotificationService
        from tyr.ports.channel_resolver import ChannelResolverPort
        from tyr.ports.notification_channel import (
            Notification,
            NotificationChannel,
            NotificationUrgency,
        )

        class RecordingChannel(NotificationChannel):
            def __init__(self):
                self.sent: list[Notification] = []

            def should_notify(self, n: Notification) -> bool:
                return True

            async def send(self, n: Notification) -> None:
                self.sent.append(n)

        class StubFactory(ChannelResolverPort):
            def __init__(self, channel):
                self._channel = channel

            async def for_owner(self, owner_id: str) -> list[NotificationChannel]:
                return [self._channel]

        channel = RecordingChannel()
        event_bus = InMemoryEventBus()
        svc = NotificationService(
            event_bus=event_bus,
            channel_factory=StubFactory(channel),
            confidence_threshold=0.3,
        )
        await svc.start()

        await event_bus.emit(
            TyrEvent(
                event="raid.needs_approval",
                data={
                    "raid_id": "raid-1",
                    "raid_name": "Review PR #99",
                    "saga_id": "saga-1",
                    "saga_name": "Review: niuulabs/test#99",
                    "owner_id": "user-1",
                },
                owner_id="user-1",
            )
        )

        await asyncio.sleep(0.05)
        await svc.stop()

        assert len(channel.sent) == 1
        notif = channel.sent[0]
        assert notif.urgency == NotificationUrgency.HIGH
        assert notif.event_type == "raid.needs_approval"
        assert "Review PR #99" in notif.body

    async def test_needs_approval_without_owner_id_produces_no_notification(self):
        from tyr.domain.services.notification import NotificationService
        from tyr.ports.channel_resolver import ChannelResolverPort
        from tyr.ports.notification_channel import Notification, NotificationChannel

        class RecordingChannel(NotificationChannel):
            def __init__(self):
                self.sent: list[Notification] = []

            def should_notify(self, n: Notification) -> bool:
                return True

            async def send(self, n: Notification) -> None:
                self.sent.append(n)

        class StubFactory(ChannelResolverPort):
            def __init__(self, channel):
                self._channel = channel

            async def for_owner(self, owner_id: str) -> list[NotificationChannel]:
                return [self._channel]

        channel = RecordingChannel()
        event_bus = InMemoryEventBus()
        svc = NotificationService(
            event_bus=event_bus,
            channel_factory=StubFactory(channel),
            confidence_threshold=0.3,
        )
        await svc.start()

        await event_bus.emit(
            TyrEvent(
                event="raid.needs_approval",
                data={"raid_id": "r-1", "raid_name": "Something"},  # no owner_id
                owner_id="",
            )
        )

        await asyncio.sleep(0.05)
        await svc.stop()

        assert len(channel.sent) == 0


# ---------------------------------------------------------------------------
# Config tests
# ---------------------------------------------------------------------------


class TestEventTriggerConfig:
    def test_default_config_has_empty_rules(self):
        from tyr.config import EventTriggerConfig

        cfg = EventTriggerConfig()
        assert cfg.rules == []
        assert cfg.enabled is False

    def test_rules_parsed_from_dict(self):
        from tyr.config import EventTriggerConfig

        cfg = EventTriggerConfig(
            enabled=True,
            rules=[
                {"event": "github.pr.opened", "saga_template": "review", "auto_start": True},
                {
                    "event": "github.pr.merged",
                    "saga_template": "deploy",
                    "auto_start": True,
                    "filter": {"branch": "main"},
                },
            ],
        )
        assert len(cfg.rules) == 2
        assert cfg.rules[0].event == "github.pr.opened"
        assert cfg.rules[1].filter == {"branch": "main"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_minimal_template(tmp_path: Path, name: str) -> None:
    """Write a minimal single-phase, single-raid YAML template."""
    (tmp_path / f"{name}.yaml").write_text(
        textwrap.dedent("""\
            name: "Test saga for {event.repo}"
            feature_branch: "feat/test"
            base_branch: main
            repos:
              - "{event.repo}"
            phases:
              - name: Execute
                raids:
                  - name: "Do the thing in {event.repo}"
                    description: "Automated saga raid"
                    acceptance_criteria:
                      - "Task completed"
                    declared_files: []
                    estimate_hours: 1.0
                    prompt: "Execute the task in {event.repo}"
        """),
        encoding="utf-8",
    )
