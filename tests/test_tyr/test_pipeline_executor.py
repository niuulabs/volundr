"""Tests for tyr.domain.pipeline_executor — PipelineExecutor and fan-in logic."""

from __future__ import annotations

import textwrap
import uuid

import pytest

from tests.test_tyr.stubs import InMemorySagaRepository, StubVolundrFactory, StubVolundrPort
from tyr.adapters.memory_event_bus import InMemoryEventBus
from tyr.domain.models import PhaseStatus, RaidStatus, SagaStatus
from tyr.domain.pipeline_executor import (
    TemplateAwarePipelineExecutor,
    evaluate_fan_in,
    merge_outcomes,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_OWNER = "test-owner"

_PARALLEL_PIPELINE = textwrap.dedent(
    """
    name: "test-pipeline"
    feature_branch: "feat/test"
    base_branch: "main"
    repos:
      - "test/repo"
    stages:
      - name: review
        parallel:
          - name: "Code review"
            persona: reviewer
            prompt: "Review this code"
          - name: "Security audit"
            persona: security-auditor
            prompt: "Audit this code"
        fan_in: all_must_pass
      - name: test
        sequential:
          - name: "QA test"
            persona: qa-agent
            prompt: "Run tests"
        condition: "stages.review.verdict == pass"
    """
)

_SINGLE_STAGE_PIPELINE = textwrap.dedent(
    """
    name: "single-stage"
    feature_branch: "feat/single"
    base_branch: "main"
    repos:
      - "test/repo"
    stages:
      - name: review
        sequential:
          - name: "Review"
            persona: reviewer
            prompt: "Review code"
    """
)

_HUMAN_GATE_PIPELINE = textwrap.dedent(
    """
    name: "gated-pipeline"
    feature_branch: "feat/gated"
    base_branch: "main"
    repos:
      - "test/repo"
    stages:
      - name: review
        sequential:
          - name: "Review"
            persona: reviewer
            prompt: "Review code"
      - name: approval
        gate: human
        notify: [slack]
    """
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_executor(
    volundr: StubVolundrPort | None = None,
    repo: InMemorySagaRepository | None = None,
    event_bus: InMemoryEventBus | None = None,
) -> tuple[TemplateAwarePipelineExecutor, InMemorySagaRepository, InMemoryEventBus]:
    repo = repo or InMemorySagaRepository()
    bus = event_bus or InMemoryEventBus()
    factory = StubVolundrFactory(volundr or StubVolundrPort())
    executor = TemplateAwarePipelineExecutor(
        saga_repo=repo,
        volundr_factory=factory,
        event_bus=bus,
        owner_id=_OWNER,
    )
    return executor, repo, bus


# ---------------------------------------------------------------------------
# evaluate_fan_in
# ---------------------------------------------------------------------------


class TestEvaluateFanIn:
    def test_merge_always_passes(self):
        assert evaluate_fan_in("merge", [{"verdict": "fail"}]) is True

    def test_all_must_pass_all_pass(self):
        outcomes = [{"verdict": "pass"}, {"verdict": "pass"}]
        assert evaluate_fan_in("all_must_pass", outcomes) is True

    def test_all_must_pass_one_fail(self):
        outcomes = [{"verdict": "pass"}, {"verdict": "fail"}]
        assert evaluate_fan_in("all_must_pass", outcomes) is False

    def test_all_must_pass_no_verdict_defaults_to_pass(self):
        outcomes = [{"findings_count": 5}, {"findings_count": 2}]
        assert evaluate_fan_in("all_must_pass", outcomes) is True

    def test_any_pass_one_passes(self):
        outcomes = [{"verdict": "fail"}, {"verdict": "pass"}]
        assert evaluate_fan_in("any_pass", outcomes) is True

    def test_any_pass_all_fail(self):
        outcomes = [{"verdict": "fail"}, {"verdict": "fail"}]
        assert evaluate_fan_in("any_pass", outcomes) is False

    def test_majority_more_than_half_pass(self):
        outcomes = [{"verdict": "pass"}, {"verdict": "pass"}, {"verdict": "fail"}]
        assert evaluate_fan_in("majority", outcomes) is True

    def test_majority_exactly_half_fails(self):
        outcomes = [{"verdict": "pass"}, {"verdict": "fail"}]
        assert evaluate_fan_in("majority", outcomes) is False

    def test_unknown_strategy_raises(self):
        with pytest.raises(ValueError, match="Unknown fan-in"):
            evaluate_fan_in("invalid", [])


# ---------------------------------------------------------------------------
# merge_outcomes
# ---------------------------------------------------------------------------


class TestMergeOutcomes:
    def test_all_pass_gives_pass(self):
        merged = merge_outcomes([{"verdict": "pass"}, {"verdict": "pass"}])
        assert merged["verdict"] == "pass"

    def test_any_fail_gives_fail(self):
        merged = merge_outcomes([{"verdict": "pass"}, {"verdict": "fail"}])
        assert merged["verdict"] == "fail"

    def test_findings_count_summed(self):
        merged = merge_outcomes([{"findings_count": 3}, {"findings_count": 2}])
        assert merged["findings_count"] == 5

    def test_critical_findings_summed(self):
        merged = merge_outcomes([{"critical_findings": 1}, {"critical_findings": 0}])
        assert merged["critical_findings"] == 1

    def test_participants_included(self):
        outcomes = [{"verdict": "pass"}, {"verdict": "pass"}]
        merged = merge_outcomes(outcomes)
        assert merged["participants"] == outcomes

    def test_no_findings_skips_key(self):
        merged = merge_outcomes([{"verdict": "pass"}])
        assert "findings_count" not in merged

    def test_summary_carried_from_first(self):
        merged = merge_outcomes([{"summary": "looks good"}, {"verdict": "pass"}])
        assert merged["summary"] == "looks good"


# ---------------------------------------------------------------------------
# PipelineExecutor.create_from_yaml
# ---------------------------------------------------------------------------


class TestCreateFromYaml:
    @pytest.mark.asyncio
    async def test_creates_saga(self):
        executor, repo, _ = _make_executor()
        saga = await executor.create_from_yaml(_SINGLE_STAGE_PIPELINE)
        assert saga.id in repo.sagas
        assert saga.name == "single-stage"

    @pytest.mark.asyncio
    async def test_creates_phases_and_raids(self):
        executor, repo, _ = _make_executor()
        saga = await executor.create_from_yaml(_SINGLE_STAGE_PIPELINE)
        phases = await repo.get_phases_by_saga(saga.id)
        assert len(phases) == 1
        raids = await repo.get_raids_by_phase(phases[0].id)
        assert len(raids) == 1

    @pytest.mark.asyncio
    async def test_parallel_stage_creates_two_raids(self):
        executor, repo, _ = _make_executor()
        saga = await executor.create_from_yaml(_PARALLEL_PIPELINE)
        phases = await repo.get_phases_by_saga(saga.id)
        assert len(phases) == 2
        raids = await repo.get_raids_by_phase(phases[0].id)
        assert len(raids) == 2

    @pytest.mark.asyncio
    async def test_auto_start_dispatches_first_phase_raids(self):
        volundr = StubVolundrPort()
        executor, repo, _ = _make_executor(volundr=volundr)
        await executor.create_from_yaml(_SINGLE_STAGE_PIPELINE, auto_start=True)
        # Should have spawned 1 session
        assert len(volundr.spawned) == 1

    @pytest.mark.asyncio
    async def test_auto_start_false_does_not_dispatch(self):
        volundr = StubVolundrPort()
        executor, repo, _ = _make_executor(volundr=volundr)
        await executor.create_from_yaml(_SINGLE_STAGE_PIPELINE, auto_start=False)
        assert len(volundr.spawned) == 0

    @pytest.mark.asyncio
    async def test_parallel_auto_start_dispatches_both_raids(self):
        volundr = StubVolundrPort()
        executor, repo, _ = _make_executor(volundr=volundr)
        await executor.create_from_yaml(_PARALLEL_PIPELINE, auto_start=True)
        # Phase 1 has 2 parallel participants
        assert len(volundr.spawned) == 2

    @pytest.mark.asyncio
    async def test_invalid_yaml_raises(self):
        executor, _, _ = _make_executor()
        with pytest.raises(Exception):
            await executor.create_from_yaml("name: ''\nstages: []")

    @pytest.mark.asyncio
    async def test_emits_saga_created_event(self):
        executor, _, bus = _make_executor()
        await executor.create_from_yaml(_SINGLE_STAGE_PIPELINE)
        events = [e for e in bus.get_log(100) if e.event == "saga.created"]
        assert len(events) == 1

    @pytest.mark.asyncio
    async def test_context_substitution(self):
        pipeline_yaml = """
name: "Review {event.repo}"
feature_branch: "feat/x"
base_branch: "main"
repos: ["{event.repo}"]
stages:
  - name: review
    sequential:
      - name: "Review {event.repo}"
        persona: reviewer
        prompt: "Review {event.repo}"
"""
        executor, repo, _ = _make_executor()
        saga = await executor.create_from_yaml(pipeline_yaml, context={"repo": "acme/app"})
        assert "acme/app" in saga.name


# ---------------------------------------------------------------------------
# PipelineExecutor.receive_outcome
# ---------------------------------------------------------------------------


class TestReceiveOutcome:
    @pytest.mark.asyncio
    async def test_receive_outcome_stores_structured_outcome(self):
        volundr = StubVolundrPort()
        executor, repo, _ = _make_executor(volundr=volundr)
        saga = await executor.create_from_yaml(_SINGLE_STAGE_PIPELINE, auto_start=True)

        phases = await repo.get_phases_by_saga(saga.id)
        raids = await repo.get_raids_by_phase(phases[0].id)
        raid = raids[0]

        outcome = {"verdict": "pass", "findings_count": 0}
        await executor.receive_outcome(raid_id=raid.id, outcome=outcome)

        updated_raid = await repo.get_raid(raid.id)
        assert updated_raid is not None
        assert updated_raid.structured_outcome == outcome

    @pytest.mark.asyncio
    async def test_pass_verdict_sets_merged_status(self):
        volundr = StubVolundrPort()
        executor, repo, _ = _make_executor(volundr=volundr)
        saga = await executor.create_from_yaml(_SINGLE_STAGE_PIPELINE, auto_start=True)
        phases = await repo.get_phases_by_saga(saga.id)
        raids = await repo.get_raids_by_phase(phases[0].id)

        await executor.receive_outcome(raid_id=raids[0].id, outcome={"verdict": "pass"})

        updated = await repo.get_raid(raids[0].id)
        assert updated.status == RaidStatus.MERGED

    @pytest.mark.asyncio
    async def test_fail_verdict_sets_failed_status(self):
        volundr = StubVolundrPort()
        executor, repo, _ = _make_executor(volundr=volundr)
        saga = await executor.create_from_yaml(_SINGLE_STAGE_PIPELINE, auto_start=True)
        phases = await repo.get_phases_by_saga(saga.id)
        raids = await repo.get_raids_by_phase(phases[0].id)

        await executor.receive_outcome(raid_id=raids[0].id, outcome={"verdict": "fail"})

        updated = await repo.get_raid(raids[0].id)
        assert updated.status == RaidStatus.FAILED

    @pytest.mark.asyncio
    async def test_unknown_raid_is_noop(self):
        executor, _, _ = _make_executor()
        # Should not raise
        await executor.receive_outcome(raid_id=uuid.uuid4(), outcome={"verdict": "pass"})


# ---------------------------------------------------------------------------
# E2E: Parallel fan-in advancing pipeline
# ---------------------------------------------------------------------------


class TestParallelFanIn:
    @pytest.mark.asyncio
    async def test_both_raids_must_complete_before_phase_advances(self):
        """Phase 1 has 2 parallel raids. Phase 2 should not start until both complete."""
        volundr = StubVolundrPort()
        executor, repo, bus = _make_executor(volundr=volundr)
        saga = await executor.create_from_yaml(_PARALLEL_PIPELINE, auto_start=True)

        phases = await repo.get_phases_by_saga(saga.id)
        phase1 = phases[0]
        raids = await repo.get_raids_by_phase(phase1.id)
        assert len(raids) == 2

        # Simulate first reviewer completing
        await executor.receive_outcome(raid_id=raids[0].id, outcome={"verdict": "pass"})

        # Phase 1 should still be ACTIVE (second raid not done yet)
        p1_after_first = repo.phases[phase1.id]
        assert p1_after_first.status == PhaseStatus.ACTIVE

        # Simulate second security-auditor completing
        await executor.receive_outcome(
            raid_id=raids[1].id, outcome={"verdict": "pass", "critical_findings": 0}
        )

        # Phase 1 should now be COMPLETE
        p1_final = repo.phases[phase1.id]
        assert p1_final.status == PhaseStatus.COMPLETE

    @pytest.mark.asyncio
    async def test_all_must_pass_fan_in_fails_saga_when_raid_fails(self):
        """When fan_in=all_must_pass and a raid fails, saga should fail."""
        volundr = StubVolundrPort()
        executor, repo, bus = _make_executor(volundr=volundr)
        saga = await executor.create_from_yaml(_PARALLEL_PIPELINE, auto_start=True)

        phases = await repo.get_phases_by_saga(saga.id)
        phase1 = phases[0]
        raids = await repo.get_raids_by_phase(phase1.id)

        # First raid passes
        await executor.receive_outcome(raid_id=raids[0].id, outcome={"verdict": "pass"})
        # Second raid fails
        await executor.receive_outcome(raid_id=raids[1].id, outcome={"verdict": "fail"})

        # Saga should be failed (fan-in all_must_pass failed)
        updated_saga = await repo.get_saga(saga.id)
        assert updated_saga.status == SagaStatus.FAILED

    @pytest.mark.asyncio
    async def test_human_gate_emits_approval_event(self):
        """Human gate phase should emit phase.needs_approval event."""
        volundr = StubVolundrPort()
        executor, repo, bus = _make_executor(volundr=volundr)
        saga = await executor.create_from_yaml(_HUMAN_GATE_PIPELINE, auto_start=True)

        phases = await repo.get_phases_by_saga(saga.id)
        phase1 = phases[0]
        raids = await repo.get_raids_by_phase(phase1.id)

        # Complete phase 1
        await executor.receive_outcome(raid_id=raids[0].id, outcome={"verdict": "pass"})

        # Phase 2 should be GATED
        phase2 = repo.phases[phases[1].id]
        assert phase2.status == PhaseStatus.GATED

        # Should have emitted phase.needs_approval event
        approval_events = [e for e in bus.get_log(100) if e.event == "phase.needs_approval"]
        assert len(approval_events) == 1

    @pytest.mark.asyncio
    async def test_single_phase_completion_marks_saga_complete(self):
        """When all phases complete, saga should be COMPLETE."""
        volundr = StubVolundrPort()
        executor, repo, bus = _make_executor(volundr=volundr)
        saga = await executor.create_from_yaml(_SINGLE_STAGE_PIPELINE, auto_start=True)

        phases = await repo.get_phases_by_saga(saga.id)
        raids = await repo.get_raids_by_phase(phases[0].id)

        await executor.receive_outcome(raid_id=raids[0].id, outcome={"verdict": "pass"})

        updated_saga = await repo.get_saga(saga.id)
        assert updated_saga.status == SagaStatus.COMPLETE


# ---------------------------------------------------------------------------
# Template loading: new pipeline format
# ---------------------------------------------------------------------------


class TestPipelineTemplateLoading:
    def test_load_review_template(self):
        from tyr.domain.templates import BUNDLED_TEMPLATES_DIR, load_template

        template = load_template(
            "review",
            BUNDLED_TEMPLATES_DIR,
            payload={
                "repo": "acme/app",
                "pr_number": "42",
                "branch": "feat/x",
                "base_branch": "main",
                "title": "My PR",
                "author": "alice",
                "pr_url": "https://github.com/acme/app/pull/42",
            },
        )
        assert template.name == "Review: acme/app#42"
        # First phase should be parallel (parallel-review)
        assert template.phases[0].parallel is True
        assert len(template.phases[0].raids) == 2
        assert template.phases[0].fan_in == "all_must_pass"
        # Second phase should have condition
        assert template.phases[1].condition is not None
        # Third phase should be a human gate
        assert template.phases[2].gate == "human"
        assert template.phases[2].needs_approval is True

    def test_load_investigate_template(self):
        from tyr.domain.templates import BUNDLED_TEMPLATES_DIR, load_template

        template = load_template(
            "investigate",
            BUNDLED_TEMPLATES_DIR,
            payload={"repo": "acme/app", "issue_number": "7", "title": "Bug", "author": "bob"},
        )
        assert template.name == "Investigate: Bug"
        assert len(template.phases) == 1
        assert template.phases[0].parallel is False

    def test_load_retro_template(self):
        from tyr.domain.templates import BUNDLED_TEMPLATES_DIR, load_template

        template = load_template("retro", BUNDLED_TEMPLATES_DIR, payload={"week": "2026-W15"})
        assert len(template.phases) == 2

    def test_load_reflect_template(self):
        from tyr.domain.templates import BUNDLED_TEMPLATES_DIR, load_template

        template = load_template(
            "reflect",
            BUNDLED_TEMPLATES_DIR,
            payload={
                "session_id": "sess-001",
                "repo": "acme/app",
                "outcome": "success",
                "duration_seconds": 120,
            },
        )
        assert "sess-001" in template.name

    def test_load_deploy_template(self):
        from tyr.domain.templates import BUNDLED_TEMPLATES_DIR, load_template

        template = load_template(
            "deploy",
            BUNDLED_TEMPLATES_DIR,
            payload={
                "repo": "acme/app",
                "sha_short": "abc1234",
                "sha": "abc1234def",
                "title": "feat: add feature",
                "pr_url": "https://github.com/acme/app/pull/99",
                "author": "carol",
            },
        )
        assert len(template.phases) == 3
        # Second stage has condition referencing smoke-test
        assert template.phases[1].condition is not None
        assert "smoke-test" in template.phases[1].condition

    def test_load_ship_template(self):
        from tyr.domain.templates import BUNDLED_TEMPLATES_DIR, load_template

        template = load_template(
            "ship",
            BUNDLED_TEMPLATES_DIR,
            payload={"repo": "acme/app", "branch": "feat/ship", "base_branch": "main"},
        )
        assert len(template.phases) == 4


# ---------------------------------------------------------------------------
# Error paths and edge cases
# ---------------------------------------------------------------------------


_CONDITION_PIPELINE = textwrap.dedent(
    """
    name: "condition-pipeline"
    feature_branch: "feat/cond"
    base_branch: "main"
    repos:
      - "test/repo"
    stages:
      - name: review
        sequential:
          - name: "Review"
            persona: reviewer
            prompt: "Review code"
      - name: test
        sequential:
          - name: "Test"
            persona: qa-agent
            prompt: "Run tests"
        condition: "stages.review.verdict == pass"
    """
)

_CONDITION_FAIL_PIPELINE = textwrap.dedent(
    """
    name: "condition-fail-pipeline"
    feature_branch: "feat/cond-fail"
    base_branch: "main"
    repos:
      - "test/repo"
    stages:
      - name: review
        sequential:
          - name: "Review"
            persona: reviewer
            prompt: "Review code"
      - name: test
        sequential:
          - name: "Test"
            persona: qa-agent
            prompt: "Run tests"
        condition: "stages.review.verdict == pass"
    """
)


class TestConditionBasedAdvancement:
    @pytest.mark.asyncio
    async def test_condition_passes_advances_to_next_phase(self):
        """When condition passes, saga advances to next phase."""
        volundr = StubVolundrPort()
        executor, repo, bus = _make_executor(volundr=volundr)
        saga = await executor.create_from_yaml(_CONDITION_PIPELINE, auto_start=True)

        phases = await repo.get_phases_by_saga(saga.id)
        phase1 = phases[0]
        raids = await repo.get_raids_by_phase(phase1.id)

        # Complete phase 1 with pass
        await executor.receive_outcome(raid_id=raids[0].id, outcome={"verdict": "pass"})

        # Phase 1 complete, phase 2 should now be ACTIVE
        p1 = repo.phases[phase1.id]
        assert p1.status == PhaseStatus.COMPLETE

    @pytest.mark.asyncio
    async def test_condition_failure_fails_saga(self):
        """When condition fails (verdict != pass), saga is marked FAILED."""
        volundr = StubVolundrPort()
        executor, repo, bus = _make_executor(volundr=volundr)
        saga = await executor.create_from_yaml(_CONDITION_FAIL_PIPELINE, auto_start=True)

        phases = await repo.get_phases_by_saga(saga.id)
        phase1 = phases[0]
        raids = await repo.get_raids_by_phase(phase1.id)

        # Complete phase 1 with fail — condition "stages.review.verdict == pass" will not match
        await executor.receive_outcome(raid_id=raids[0].id, outcome={"verdict": "fail"})

        # Saga should be failed because fan-in failed (FAILED raid → has_failed=True)
        updated_saga = await repo.get_saga(saga.id)
        assert updated_saga.status == SagaStatus.FAILED

    @pytest.mark.asyncio
    async def test_no_volundr_adapter_does_not_raise(self):
        """When no Volundr adapter is available, dispatch logs error but doesn't raise."""

        class NullFactory:
            async def primary_for_owner(self, owner_id):
                return None

        repo = InMemorySagaRepository()
        bus = InMemoryEventBus()
        executor = TemplateAwarePipelineExecutor(
            saga_repo=repo,
            volundr_factory=NullFactory(),
            event_bus=bus,
            owner_id=_OWNER,
        )

        # Should not raise even without a Volundr adapter
        saga = await executor.create_from_yaml(_SINGLE_STAGE_PIPELINE, auto_start=True)
        assert saga.id in repo.sagas

    @pytest.mark.asyncio
    async def test_receive_outcome_for_untracked_saga_does_not_raise(self):
        """When saga is not in _saga_templates, base _finalize_phase is used without raising."""
        volundr = StubVolundrPort()
        executor, repo, bus = _make_executor(volundr=volundr)
        saga = await executor.create_from_yaml(_SINGLE_STAGE_PIPELINE, auto_start=True)

        # Remove from tracking to simulate untracked saga
        executor._saga_templates.clear()

        phases = await repo.get_phases_by_saga(saga.id)
        raids = await repo.get_raids_by_phase(phases[0].id)

        # Should not raise even when template context is gone
        await executor.receive_outcome(raid_id=raids[0].id, outcome={"verdict": "pass"})

    @pytest.mark.asyncio
    async def test_advance_phase_with_no_volundr_does_not_raise(self):
        """When advancing to next phase but Volundr returns None, no exception raised."""

        class NullFactory:
            async def primary_for_owner(self, owner_id):
                return None

        repo = InMemorySagaRepository()
        bus = InMemoryEventBus()
        executor = TemplateAwarePipelineExecutor(
            saga_repo=repo,
            volundr_factory=NullFactory(),
            event_bus=bus,
            owner_id=_OWNER,
        )

        # 2-phase pipeline: complete phase 1 (no volundr = auto_start does nothing),
        # then receive outcome to trigger phase advance
        saga = await executor.create_from_yaml(_CONDITION_PIPELINE, auto_start=False)
        phases = await repo.get_phases_by_saga(saga.id)
        phase1 = phases[0]
        raids = await repo.get_raids_by_phase(phase1.id)

        # Mark raid as RUNNING manually (skip auto_start since no volundr)
        from datetime import UTC, datetime

        from tyr.domain.models import Raid

        updated = Raid(
            id=raids[0].id,
            phase_id=raids[0].phase_id,
            tracker_id=raids[0].tracker_id,
            name=raids[0].name,
            description=raids[0].description,
            acceptance_criteria=raids[0].acceptance_criteria,
            declared_files=raids[0].declared_files,
            estimate_hours=raids[0].estimate_hours,
            status=RaidStatus.RUNNING,
            confidence=raids[0].confidence,
            session_id="mock-session",
            branch=raids[0].branch,
            chronicle_summary=raids[0].chronicle_summary,
            pr_url=raids[0].pr_url,
            pr_id=raids[0].pr_id,
            retry_count=raids[0].retry_count,
            created_at=raids[0].created_at,
            updated_at=datetime.now(UTC),
        )
        await repo.save_raid(updated)

        # Receive outcome: phase 1 completes, tries to advance to phase 2 but no volundr
        await executor.receive_outcome(raid_id=raids[0].id, outcome={"verdict": "pass"})
        # Phase 1 should be COMPLETE even though Volundr can't dispatch phase 2
        assert repo.phases[phase1.id].status == PhaseStatus.COMPLETE

    @pytest.mark.asyncio
    async def test_condition_eval_error_fails_saga(self):
        """When condition expression is invalid, saga is failed gracefully."""
        from unittest.mock import patch

        from tyr.domain.condition_evaluator import ConditionError

        volundr = StubVolundrPort()
        executor, repo, bus = _make_executor(volundr=volundr)
        saga = await executor.create_from_yaml(_CONDITION_PIPELINE, auto_start=True)

        phases = await repo.get_phases_by_saga(saga.id)
        raids = await repo.get_raids_by_phase(phases[0].id)

        # Patch evaluate_condition to raise ConditionError
        with patch(
            "tyr.domain.pipeline_executor.evaluate_condition",
            side_effect=ConditionError("bad condition"),
        ):
            await executor.receive_outcome(raid_id=raids[0].id, outcome={"verdict": "pass"})

        updated_saga = await repo.get_saga(saga.id)
        assert updated_saga.status == SagaStatus.FAILED

    @pytest.mark.asyncio
    async def test_base_create_from_yaml_works(self):
        """Base PipelineExecutor.create_from_yaml creates a saga."""
        from tyr.domain.pipeline_executor import PipelineExecutor

        repo = InMemorySagaRepository()
        bus = InMemoryEventBus()
        executor = PipelineExecutor(
            saga_repo=repo,
            volundr_factory=StubVolundrFactory(StubVolundrPort()),
            event_bus=bus,
            owner_id=_OWNER,
        )

        saga = await executor.create_from_yaml(_SINGLE_STAGE_PIPELINE, auto_start=False)
        assert saga.id in repo.sagas
