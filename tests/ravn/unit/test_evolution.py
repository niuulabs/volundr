"""Unit tests for ravn.context.evolution — pattern extraction and prompt evolution."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from ravn.context.evolution import (
    EvolutionState,
    PatternExtractor,
    PromptEvolution,
    SkillSuggestion,
    StrategyInjection,
    SystemWarning,
    _describe_skill,
    _describe_strategy,
    _describe_warning,
    load_state,
    save_state,
    should_run,
)
from ravn.domain.models import (
    Episode,
    EpisodeMatch,
    Outcome,
    SharedContext,
    TaskOutcome,
)
from ravn.ports.memory import MemoryPort
from ravn.ports.outcome import OutcomePort

# ---------------------------------------------------------------------------
# Helpers / fakes
# ---------------------------------------------------------------------------


def _ep(
    *,
    ep_id: str = "ep-1",
    outcome: Outcome = Outcome.SUCCESS,
    tools_used: list[str] | None = None,
    tags: list[str] | None = None,
    summary: str = "completed the task",
    task_description: str = "do some work",
    session_id: str = "sess-abc",
) -> Episode:
    return Episode(
        episode_id=ep_id,
        session_id=session_id,
        timestamp=datetime(2026, 1, 15, 10, 0, tzinfo=UTC),
        summary=summary,
        task_description=task_description,
        tools_used=tools_used if tools_used is not None else ["bash", "git"],
        outcome=outcome,
        tags=tags if tags is not None else ["git"],
        embedding=None,
    )


def _match(ep: Episode, relevance: float = 0.8) -> EpisodeMatch:
    return EpisodeMatch(episode=ep, relevance=relevance)


def _outcome(
    *,
    task_id: str = "task-1",
    outcome: Outcome = Outcome.SUCCESS,
    tools_used: list[str] | None = None,
    errors: list[str] | None = None,
    reflection: str = "Everything went well.",
    tags: list[str] | None = None,
) -> TaskOutcome:
    return TaskOutcome(
        task_id=task_id,
        task_summary="some task",
        outcome=outcome,
        tools_used=tools_used if tools_used is not None else ["bash"],
        iterations_used=5,
        cost_usd=0.01,
        duration_seconds=30.0,
        errors=errors if errors is not None else [],
        reflection=reflection,
        tags=tags if tags is not None else ["code"],
        timestamp=datetime(2026, 1, 15, 10, 0, tzinfo=UTC),
    )


class StubMemory(MemoryPort):
    """In-memory stub that returns pre-configured episode matches."""

    def __init__(self, episodes: list[EpisodeMatch] | None = None) -> None:
        self._episodes = episodes or []
        self._shared: SharedContext | None = None

    async def record_episode(self, episode: Episode) -> None:
        pass

    async def query_episodes(
        self, query: str, *, limit: int = 5, min_relevance: float = 0.3
    ) -> list[EpisodeMatch]:
        return self._episodes[:limit]

    async def prefetch(self, context: str) -> str:
        return ""

    async def search_sessions(self, query: str, *, limit: int = 3):  # type: ignore[override]
        return []

    def inject_shared_context(self, context: SharedContext) -> None:
        self._shared = context

    def get_shared_context(self) -> SharedContext | None:
        return self._shared


class StubOutcome(OutcomePort):
    """In-memory stub for OutcomePort with configurable returns."""

    def __init__(
        self,
        outcomes: list[TaskOutcome] | None = None,
        count: int = 0,
        raise_list: bool = False,
    ) -> None:
        self._outcomes = outcomes or []
        self._count = count
        self._raise_list = raise_list

    async def record_outcome(self, outcome: TaskOutcome) -> None:
        pass

    async def retrieve_lessons(self, task_description: str, *, limit: int = 3) -> str:
        return ""

    async def count_all_outcomes(self) -> int:
        return self._count

    async def list_recent_outcomes(
        self,
        limit: int = 50,
        *,
        since=None,
    ) -> list[TaskOutcome]:
        if self._raise_list:
            raise NotImplementedError("not supported")
        return self._outcomes[:limit]


# ---------------------------------------------------------------------------
# EvolutionState — serialisation
# ---------------------------------------------------------------------------


class TestEvolutionState:
    def test_default_state(self) -> None:
        state = EvolutionState()
        assert state.last_run_at is None
        assert state.outcome_count_at_last_run == 0

    def test_to_dict_null_timestamp(self) -> None:
        state = EvolutionState()
        d = state.to_dict()
        assert d["last_run_at"] is None
        assert d["outcome_count_at_last_run"] == 0

    def test_to_dict_with_timestamp(self) -> None:
        ts = datetime(2026, 3, 1, 12, 0, tzinfo=UTC)
        state = EvolutionState(last_run_at=ts, outcome_count_at_last_run=42)
        d = state.to_dict()
        assert "2026-03-01" in d["last_run_at"]
        assert d["outcome_count_at_last_run"] == 42

    def test_from_dict_null_timestamp(self) -> None:
        state = EvolutionState.from_dict({"last_run_at": None, "outcome_count_at_last_run": 5})
        assert state.last_run_at is None
        assert state.outcome_count_at_last_run == 5

    def test_from_dict_with_timestamp(self) -> None:
        state = EvolutionState.from_dict(
            {"last_run_at": "2026-03-01T12:00:00+00:00", "outcome_count_at_last_run": 7}
        )
        assert state.last_run_at is not None
        assert state.outcome_count_at_last_run == 7

    def test_from_dict_invalid_timestamp(self) -> None:
        state = EvolutionState.from_dict(
            {"last_run_at": "not-a-date", "outcome_count_at_last_run": 0}
        )
        assert state.last_run_at is None

    def test_from_dict_empty_dict(self) -> None:
        state = EvolutionState.from_dict({})
        assert state.last_run_at is None
        assert state.outcome_count_at_last_run == 0

    def test_roundtrip(self) -> None:
        ts = datetime(2026, 4, 5, 9, 30, tzinfo=UTC)
        original = EvolutionState(last_run_at=ts, outcome_count_at_last_run=99)
        restored = EvolutionState.from_dict(original.to_dict())
        assert restored.outcome_count_at_last_run == 99
        assert restored.last_run_at is not None


# ---------------------------------------------------------------------------
# load_state / save_state
# ---------------------------------------------------------------------------


class TestStateIO:
    def test_load_missing_file_returns_blank(self, tmp_path: Path) -> None:
        state = load_state(tmp_path / "missing.json")
        assert state.last_run_at is None
        assert state.outcome_count_at_last_run == 0

    def test_load_invalid_json_returns_blank(self, tmp_path: Path) -> None:
        path = tmp_path / "bad.json"
        path.write_text("not json", encoding="utf-8")
        state = load_state(path)
        assert state.last_run_at is None

    def test_save_creates_parent_dir(self, tmp_path: Path) -> None:
        path = tmp_path / "subdir" / "state.json"
        state = EvolutionState(outcome_count_at_last_run=10)
        save_state(path, state)
        assert path.exists()

    def test_save_and_load_roundtrip(self, tmp_path: Path) -> None:
        path = tmp_path / "state.json"
        ts = datetime(2026, 2, 14, 8, 0, tzinfo=UTC)
        state = EvolutionState(last_run_at=ts, outcome_count_at_last_run=25)
        save_state(path, state)
        loaded = load_state(path)
        assert loaded.outcome_count_at_last_run == 25
        assert loaded.last_run_at is not None

    def test_save_produces_valid_json(self, tmp_path: Path) -> None:
        path = tmp_path / "state.json"
        save_state(path, EvolutionState(outcome_count_at_last_run=3))
        data = json.loads(path.read_text())
        assert "outcome_count_at_last_run" in data


# ---------------------------------------------------------------------------
# should_run
# ---------------------------------------------------------------------------


class TestShouldRun:
    def test_enough_new_outcomes_returns_true(self) -> None:
        state = EvolutionState(outcome_count_at_last_run=5)
        assert should_run(state, current_count=15, min_new=10) is True

    def test_not_enough_new_outcomes_returns_false(self) -> None:
        state = EvolutionState(outcome_count_at_last_run=5)
        assert should_run(state, current_count=14, min_new=10) is False

    def test_exactly_min_new_returns_true(self) -> None:
        state = EvolutionState(outcome_count_at_last_run=0)
        assert should_run(state, current_count=10, min_new=10) is True

    def test_zero_current_count_returns_false(self) -> None:
        state = EvolutionState(outcome_count_at_last_run=0)
        assert should_run(state, current_count=0, min_new=10) is False

    def test_zero_min_new_always_false(self) -> None:
        state = EvolutionState(outcome_count_at_last_run=0)
        assert should_run(state, current_count=100, min_new=0) is False

    def test_negative_min_new_always_false(self) -> None:
        state = EvolutionState(outcome_count_at_last_run=0)
        assert should_run(state, current_count=100, min_new=-1) is False

    def test_blank_state_with_enough_outcomes(self) -> None:
        state = EvolutionState()
        assert should_run(state, current_count=10, min_new=5) is True

    def test_count_below_last_run_count_is_false(self) -> None:
        state = EvolutionState(outcome_count_at_last_run=20)
        assert should_run(state, current_count=10, min_new=5) is False


# ---------------------------------------------------------------------------
# PromptEvolution — is_empty / as_diff
# ---------------------------------------------------------------------------


class TestPromptEvolution:
    def _base(self) -> PromptEvolution:
        return PromptEvolution(
            extracted_at=datetime(2026, 4, 5, tzinfo=UTC),
            episodes_analyzed=10,
            outcomes_analyzed=5,
        )

    def test_is_empty_when_no_proposals(self) -> None:
        assert self._base().is_empty() is True

    def test_not_empty_with_skill(self) -> None:
        ev = self._base()
        ev.suggested_skills.append(
            SkillSuggestion(
                tool_pattern=("bash", "git"),
                description="A workflow.",
                source_episode_ids=["ep-1"],
                occurrence_count=3,
            )
        )
        assert ev.is_empty() is False

    def test_not_empty_with_warning(self) -> None:
        ev = self._base()
        ev.system_warnings.append(
            SystemWarning(
                warning_text="Check permissions.",
                source_outcome_ids=["t-1"],
                occurrence_count=3,
            )
        )
        assert ev.is_empty() is False

    def test_not_empty_with_strategy(self) -> None:
        ev = self._base()
        ev.strategy_injections.append(
            StrategyInjection(
                task_type="git",
                strategy_text="Use atomic commits.",
                source_episode_ids=["ep-1"],
                success_count=4,
            )
        )
        assert ev.is_empty() is False

    def test_as_diff_contains_header(self) -> None:
        diff = self._base().as_diff()
        assert "Ravn Prompt Evolution Proposal" in diff

    def test_as_diff_contains_timestamp(self) -> None:
        diff = self._base().as_diff()
        assert "2026-04-05" in diff

    def test_as_diff_contains_counts(self) -> None:
        diff = self._base().as_diff()
        assert "10 episodes" in diff
        assert "5 outcomes" in diff

    def test_as_diff_shows_skills(self) -> None:
        ev = self._base()
        ev.suggested_skills.append(
            SkillSuggestion(
                tool_pattern=("bash", "git"),
                description="Workflow desc.",
                source_episode_ids=["ep-1"],
                occurrence_count=4,
            )
        )
        diff = ev.as_diff()
        assert "bash" in diff
        assert "git" in diff
        assert "4 successful uses" in diff

    def test_as_diff_shows_warnings(self) -> None:
        ev = self._base()
        ev.system_warnings.append(
            SystemWarning(
                warning_text="Recurring timeout errors.",
                source_outcome_ids=["t-1"],
                occurrence_count=3,
            )
        )
        diff = ev.as_diff()
        assert "Recurring timeout errors." in diff
        assert "3 occurrences" in diff

    def test_as_diff_shows_strategies(self) -> None:
        ev = self._base()
        ev.strategy_injections.append(
            StrategyInjection(
                task_type="testing",
                strategy_text="Run tests early.",
                source_episode_ids=["ep-1"],
                success_count=5,
            )
        )
        diff = ev.as_diff()
        assert "'testing' tasks" in diff
        assert "Run tests early." in diff

    def test_as_diff_ends_with_notice(self) -> None:
        diff = self._base().as_diff()
        assert "Ravn will not apply these changes automatically" in diff

    def test_as_diff_empty_evolution_has_no_sections(self) -> None:
        diff = self._base().as_diff()
        assert "Suggested New Skills" not in diff
        assert "Proposed System Prompt Warnings" not in diff
        assert "Proposed Strategy Injections" not in diff


# ---------------------------------------------------------------------------
# _describe_skill / _describe_warning / _describe_strategy
# ---------------------------------------------------------------------------


class TestDescriptionHelpers:
    def test_describe_skill_includes_tool_names(self) -> None:
        ep = _ep(tools_used=["bash", "git"], task_description="refactor module")
        desc = _describe_skill(("bash", "git"), [ep])
        assert "bash" in desc
        assert "git" in desc

    def test_describe_skill_includes_example_task(self) -> None:
        ep = _ep(task_description="write unit tests")
        desc = _describe_skill(("pytest",), [ep])
        assert "write unit tests" in desc

    def test_describe_skill_no_tasks_still_works(self) -> None:
        ep = _ep(task_description="")
        desc = _describe_skill(("bash",), [ep])
        assert "bash" in desc

    def test_describe_warning_includes_keyword(self) -> None:
        oc = _outcome(errors=["permission denied: /etc/secret"])
        desc = _describe_warning("permission", [oc])
        assert "permission" in desc

    def test_describe_warning_includes_example_error(self) -> None:
        oc = _outcome(errors=["permission denied: /etc/secret"])
        desc = _describe_warning("permission", [oc])
        assert "permission denied" in desc

    def test_describe_warning_no_matching_errors_still_works(self) -> None:
        oc = _outcome(errors=[])
        desc = _describe_warning("timeout", [oc])
        assert "timeout" in desc

    def test_describe_strategy_includes_tag(self) -> None:
        ep = _ep(tags=["git"])
        desc = _describe_strategy("git", [ep])
        assert "git" in desc

    def test_describe_strategy_includes_episode_count(self) -> None:
        eps = [_ep(ep_id=f"ep-{i}") for i in range(5)]
        desc = _describe_strategy("code", eps)
        assert "5" in desc

    def test_describe_strategy_includes_example_summary(self) -> None:
        ep = _ep(summary="deployed service to kubernetes cluster")
        desc = _describe_strategy("deployment", [ep])
        assert "deployed service" in desc


# ---------------------------------------------------------------------------
# PatternExtractor — skill extraction
# ---------------------------------------------------------------------------


class TestSkillExtraction:
    def _extractor(self, episodes: list[EpisodeMatch]) -> PatternExtractor:
        return PatternExtractor(
            memory=StubMemory(episodes),
            outcome_port=StubOutcome(),
            skill_suggestion_min_occurrences=2,
            max_skill_suggestions=5,
        )

    @pytest.mark.asyncio
    async def test_empty_episodes_no_skills(self) -> None:
        extractor = self._extractor([])
        evolution = await extractor.extract()
        assert evolution.suggested_skills == []

    @pytest.mark.asyncio
    async def test_below_threshold_no_skills(self) -> None:
        # Only 1 episode — below threshold of 2
        eps = [_match(_ep(ep_id="ep-1", tools_used=["bash", "git"]))]
        extractor = self._extractor(eps)
        evolution = await extractor.extract()
        assert evolution.suggested_skills == []

    @pytest.mark.asyncio
    async def test_above_threshold_skill_suggested(self) -> None:
        eps = [_match(_ep(ep_id=f"ep-{i}", tools_used=["bash", "git"])) for i in range(3)]
        extractor = self._extractor(eps)
        evolution = await extractor.extract()
        assert len(evolution.suggested_skills) == 1
        assert evolution.suggested_skills[0].tool_pattern == ("bash", "git")
        assert evolution.suggested_skills[0].occurrence_count == 3

    @pytest.mark.asyncio
    async def test_failure_episodes_not_counted(self) -> None:
        eps = [
            _match(_ep(ep_id=f"ep-{i}", outcome=Outcome.FAILURE, tools_used=["bash"]))
            for i in range(5)
        ]
        extractor = self._extractor(eps)
        evolution = await extractor.extract()
        assert evolution.suggested_skills == []

    @pytest.mark.asyncio
    async def test_different_patterns_counted_separately(self) -> None:
        eps = [
            _match(_ep(ep_id="ep-1", tools_used=["bash", "git"])),
            _match(_ep(ep_id="ep-2", tools_used=["bash", "git"])),
            _match(_ep(ep_id="ep-3", tools_used=["web_fetch", "file"])),
            _match(_ep(ep_id="ep-4", tools_used=["web_fetch", "file"])),
        ]
        extractor = self._extractor(eps)
        evolution = await extractor.extract()
        assert len(evolution.suggested_skills) == 2

    @pytest.mark.asyncio
    async def test_tools_deduped_within_episode(self) -> None:
        # Even if tools repeat in list, the pattern should be deduplicated
        eps = [_match(_ep(ep_id=f"ep-{i}", tools_used=["bash", "bash", "git"])) for i in range(3)]
        extractor = self._extractor(eps)
        evolution = await extractor.extract()
        assert len(evolution.suggested_skills) == 1
        assert evolution.suggested_skills[0].tool_pattern == ("bash", "git")

    @pytest.mark.asyncio
    async def test_max_skills_respected(self) -> None:
        # Create 10 distinct patterns, each appearing twice
        eps = [
            _match(_ep(ep_id=f"ep-{pattern}-{i}", tools_used=[f"tool{pattern}"]))
            for pattern in range(10)
            for i in range(2)
        ]
        extractor = PatternExtractor(
            memory=StubMemory(eps),
            outcome_port=StubOutcome(),
            skill_suggestion_min_occurrences=2,
            max_skill_suggestions=3,
        )
        evolution = await extractor.extract()
        assert len(evolution.suggested_skills) <= 3

    @pytest.mark.asyncio
    async def test_episodes_with_no_tools_skipped(self) -> None:
        eps = [_match(_ep(ep_id=f"ep-{i}", tools_used=[])) for i in range(5)]
        extractor = self._extractor(eps)
        evolution = await extractor.extract()
        assert evolution.suggested_skills == []

    @pytest.mark.asyncio
    async def test_skill_has_source_episode_ids(self) -> None:
        eps = [_match(_ep(ep_id=f"ep-{i}", tools_used=["bash"])) for i in range(3)]
        extractor = self._extractor(eps)
        evolution = await extractor.extract()
        assert len(evolution.suggested_skills[0].source_episode_ids) > 0


# ---------------------------------------------------------------------------
# PatternExtractor — error warning extraction
# ---------------------------------------------------------------------------


class TestErrorWarningExtraction:
    def _extractor(self, outcomes: list[TaskOutcome]) -> PatternExtractor:
        return PatternExtractor(
            memory=StubMemory(),
            outcome_port=StubOutcome(outcomes=outcomes),
            error_warning_min_occurrences=2,
            max_system_warnings=5,
        )

    @pytest.mark.asyncio
    async def test_no_failures_no_warnings(self) -> None:
        outcomes = [_outcome(task_id=f"t-{i}") for i in range(5)]
        extractor = self._extractor(outcomes)
        evolution = await extractor.extract()
        assert evolution.system_warnings == []

    @pytest.mark.asyncio
    async def test_recurring_error_keyword_produces_warning(self) -> None:
        outcomes = [
            _outcome(
                task_id=f"t-{i}",
                outcome=Outcome.FAILURE,
                errors=["permission denied: /etc/hosts"],
            )
            for i in range(3)
        ]
        extractor = self._extractor(outcomes)
        evolution = await extractor.extract()
        assert any("permission" in w.warning_text for w in evolution.system_warnings)

    @pytest.mark.asyncio
    async def test_below_threshold_no_warning(self) -> None:
        outcomes = [_outcome(task_id="t-1", outcome=Outcome.FAILURE, errors=["timeout"])]
        extractor = self._extractor(outcomes)
        evolution = await extractor.extract()
        assert evolution.system_warnings == []

    @pytest.mark.asyncio
    async def test_partial_outcomes_included(self) -> None:
        outcomes = [
            _outcome(
                task_id=f"t-{i}",
                outcome=Outcome.PARTIAL,
                errors=["timeout connecting to server"],
            )
            for i in range(3)
        ]
        extractor = self._extractor(outcomes)
        evolution = await extractor.extract()
        assert any("timeout" in w.warning_text for w in evolution.system_warnings)

    @pytest.mark.asyncio
    async def test_error_keyword_in_reflection_detected(self) -> None:
        outcomes = [
            _outcome(
                task_id=f"t-{i}",
                outcome=Outcome.FAILURE,
                errors=[],
                reflection="The task failed due to a permission error in the filesystem.",
            )
            for i in range(3)
        ]
        extractor = self._extractor(outcomes)
        evolution = await extractor.extract()
        assert any("permission" in w.warning_text for w in evolution.system_warnings)

    @pytest.mark.asyncio
    async def test_max_warnings_respected(self) -> None:
        # Generate failures with many different error keywords
        keywords = ["error", "failed", "exception", "timeout", "permission", "denied"]
        outcomes = [
            _outcome(
                task_id=f"t-{kw}-{i}",
                outcome=Outcome.FAILURE,
                errors=[f"{kw} occurred during processing"],
            )
            for kw in keywords
            for i in range(3)
        ]
        extractor = PatternExtractor(
            memory=StubMemory(),
            outcome_port=StubOutcome(outcomes=outcomes),
            error_warning_min_occurrences=2,
            max_system_warnings=2,
        )
        evolution = await extractor.extract()
        assert len(evolution.system_warnings) <= 2

    @pytest.mark.asyncio
    async def test_warning_has_source_outcome_ids(self) -> None:
        outcomes = [
            _outcome(
                task_id=f"t-{i}",
                outcome=Outcome.FAILURE,
                errors=["error: something went wrong"],
            )
            for i in range(3)
        ]
        extractor = self._extractor(outcomes)
        evolution = await extractor.extract()
        assert any(len(w.source_outcome_ids) > 0 for w in evolution.system_warnings)

    @pytest.mark.asyncio
    async def test_outcome_port_not_implemented_returns_empty(self) -> None:
        extractor = PatternExtractor(
            memory=StubMemory(),
            outcome_port=StubOutcome(raise_list=True),
        )
        evolution = await extractor.extract()
        assert evolution.system_warnings == []
        assert evolution.outcomes_analyzed == 0


# ---------------------------------------------------------------------------
# PatternExtractor — strategy extraction
# ---------------------------------------------------------------------------


class TestStrategyExtraction:
    def _extractor(self, episodes: list[EpisodeMatch]) -> PatternExtractor:
        return PatternExtractor(
            memory=StubMemory(episodes),
            outcome_port=StubOutcome(),
            skill_suggestion_min_occurrences=2,
            max_strategy_injections=3,
        )

    @pytest.mark.asyncio
    async def test_no_tagged_episodes_no_strategies(self) -> None:
        eps = [_match(_ep(ep_id=f"ep-{i}", tags=[])) for i in range(5)]
        extractor = self._extractor(eps)
        evolution = await extractor.extract()
        assert evolution.strategy_injections == []

    @pytest.mark.asyncio
    async def test_recurring_tag_produces_strategy(self) -> None:
        eps = [
            _match(_ep(ep_id=f"ep-{i}", tags=["git"], outcome=Outcome.SUCCESS)) for i in range(3)
        ]
        extractor = self._extractor(eps)
        evolution = await extractor.extract()
        assert any(s.task_type == "git" for s in evolution.strategy_injections)

    @pytest.mark.asyncio
    async def test_failure_episodes_not_counted_for_strategies(self) -> None:
        eps = [
            _match(_ep(ep_id=f"ep-{i}", tags=["git"], outcome=Outcome.FAILURE)) for i in range(5)
        ]
        extractor = self._extractor(eps)
        evolution = await extractor.extract()
        assert evolution.strategy_injections == []

    @pytest.mark.asyncio
    async def test_max_strategies_respected(self) -> None:
        eps = [
            _match(
                _ep(
                    ep_id=f"ep-{tag}-{i}",
                    tags=[f"tag{tag}"],
                    outcome=Outcome.SUCCESS,
                )
            )
            for tag in range(10)
            for i in range(3)
        ]
        extractor = PatternExtractor(
            memory=StubMemory(eps),
            outcome_port=StubOutcome(),
            skill_suggestion_min_occurrences=2,
            max_strategy_injections=2,
        )
        evolution = await extractor.extract()
        assert len(evolution.strategy_injections) <= 2

    @pytest.mark.asyncio
    async def test_strategy_has_success_count(self) -> None:
        eps = [_match(_ep(ep_id=f"ep-{i}", tags=["testing"])) for i in range(4)]
        extractor = self._extractor(eps)
        evolution = await extractor.extract()
        strategy = next(
            (s for s in evolution.strategy_injections if s.task_type == "testing"), None
        )
        assert strategy is not None
        assert strategy.success_count >= 2


# ---------------------------------------------------------------------------
# PatternExtractor — episode loading
# ---------------------------------------------------------------------------


class TestEpisodeLoading:
    @pytest.mark.asyncio
    async def test_episodes_analyzed_count_reflects_loaded(self) -> None:
        eps = [_match(_ep(ep_id=f"ep-{i}")) for i in range(7)]
        extractor = PatternExtractor(
            memory=StubMemory(eps),
            outcome_port=StubOutcome(),
        )
        evolution = await extractor.extract()
        assert evolution.episodes_analyzed == 7

    @pytest.mark.asyncio
    async def test_max_episodes_respected(self) -> None:
        eps = [_match(_ep(ep_id=f"ep-{i}")) for i in range(20)]
        extractor = PatternExtractor(
            memory=StubMemory(eps),
            outcome_port=StubOutcome(),
            max_episodes_to_analyze=5,
        )
        evolution = await extractor.extract()
        assert evolution.episodes_analyzed <= 5

    @pytest.mark.asyncio
    async def test_duplicate_episodes_deduplicated(self) -> None:
        # Same episode_id returned by multiple queries
        ep = _ep(ep_id="ep-duplicate")
        eps = [_match(ep)]
        extractor = PatternExtractor(
            memory=StubMemory(eps),
            outcome_port=StubOutcome(),
        )
        evolution = await extractor.extract()
        # Should only count it once despite multiple queries
        assert evolution.episodes_analyzed == 1

    @pytest.mark.asyncio
    async def test_memory_exception_handled_gracefully(self) -> None:
        memory = AsyncMock(spec=MemoryPort)
        memory.query_episodes = AsyncMock(side_effect=RuntimeError("db down"))
        extractor = PatternExtractor(
            memory=memory,
            outcome_port=StubOutcome(),
        )
        evolution = await extractor.extract()
        assert evolution.episodes_analyzed == 0


# ---------------------------------------------------------------------------
# PatternExtractor — outcomes_analyzed count
# ---------------------------------------------------------------------------


class TestOutcomesAnalyzed:
    @pytest.mark.asyncio
    async def test_outcomes_analyzed_count_reflects_loaded(self) -> None:
        outcomes = [_outcome(task_id=f"t-{i}") for i in range(8)]
        extractor = PatternExtractor(
            memory=StubMemory(),
            outcome_port=StubOutcome(outcomes=outcomes),
        )
        evolution = await extractor.extract()
        assert evolution.outcomes_analyzed == 8

    @pytest.mark.asyncio
    async def test_max_outcomes_respected(self) -> None:
        outcomes = [_outcome(task_id=f"t-{i}") for i in range(30)]
        extractor = PatternExtractor(
            memory=StubMemory(),
            outcome_port=StubOutcome(outcomes=outcomes),
            max_outcomes_to_analyze=10,
        )
        evolution = await extractor.extract()
        assert evolution.outcomes_analyzed <= 10

    @pytest.mark.asyncio
    async def test_not_implemented_outcomes_count_zero(self) -> None:
        extractor = PatternExtractor(
            memory=StubMemory(),
            outcome_port=StubOutcome(raise_list=True),
        )
        evolution = await extractor.extract()
        assert evolution.outcomes_analyzed == 0


# ---------------------------------------------------------------------------
# OutcomePort — default implementations
# ---------------------------------------------------------------------------


class TestOutcomePortDefaults:
    @pytest.mark.asyncio
    async def test_count_all_outcomes_base_returns_zero(self) -> None:
        port = StubOutcome()
        port._count = 42

        # Our stub overrides count_all_outcomes, so use the base via a class
        # that doesn't override it — test via a minimal concrete subclass.
        class MinimalOutcome(OutcomePort):
            async def record_outcome(self, outcome: TaskOutcome) -> None:
                pass

            async def retrieve_lessons(self, task_description: str, *, limit: int = 3) -> str:
                return ""

        mo = MinimalOutcome()
        assert await mo.count_all_outcomes() == 0

    @pytest.mark.asyncio
    async def test_list_recent_outcomes_base_raises_not_implemented(self) -> None:
        class MinimalOutcome(OutcomePort):
            async def record_outcome(self, outcome: TaskOutcome) -> None:
                pass

            async def retrieve_lessons(self, task_description: str, *, limit: int = 3) -> str:
                return ""

        mo = MinimalOutcome()
        with pytest.raises(NotImplementedError):
            await mo.list_recent_outcomes(10)


# ---------------------------------------------------------------------------
# Integration: full extract() call with config-like parameters
# ---------------------------------------------------------------------------


class TestFullExtract:
    @pytest.mark.asyncio
    async def test_full_extract_returns_evolution(self) -> None:
        episodes = [
            _match(_ep(ep_id=f"ep-{i}", tools_used=["bash", "git"], tags=["code"]))
            for i in range(4)
        ]
        outcomes = [
            _outcome(
                task_id=f"t-{i}",
                outcome=Outcome.FAILURE,
                errors=["error: command not found"],
            )
            for i in range(4)
        ]
        extractor = PatternExtractor(
            memory=StubMemory(episodes),
            outcome_port=StubOutcome(outcomes=outcomes),
            skill_suggestion_min_occurrences=2,
            error_warning_min_occurrences=2,
        )
        evolution = await extractor.extract()
        assert not evolution.is_empty()
        assert evolution.episodes_analyzed == 4
        assert evolution.outcomes_analyzed == 4

    @pytest.mark.asyncio
    async def test_extracted_at_is_recent(self) -> None:
        extractor = PatternExtractor(
            memory=StubMemory(),
            outcome_port=StubOutcome(),
        )
        before = datetime.now(UTC)
        evolution = await extractor.extract()
        after = datetime.now(UTC)
        assert before <= evolution.extracted_at <= after

    @pytest.mark.asyncio
    async def test_as_diff_from_full_extract(self) -> None:
        episodes = [
            _match(_ep(ep_id=f"ep-{i}", tools_used=["bash"], tags=["shell"])) for i in range(3)
        ]
        extractor = PatternExtractor(
            memory=StubMemory(episodes),
            outcome_port=StubOutcome(),
            skill_suggestion_min_occurrences=2,
        )
        evolution = await extractor.extract()
        diff = evolution.as_diff()
        assert "Ravn Prompt Evolution Proposal" in diff
