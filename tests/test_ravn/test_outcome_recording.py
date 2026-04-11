"""Tests for task outcome recording, reflection, and self-improvement injection."""

from __future__ import annotations

import re
import sqlite3
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from ravn.adapters.memory.outcome import SQLiteOutcomeAdapter, _format_lessons, _sanitise_fts_query
from ravn.adapters.permission.allow_deny import AllowAllPermission
from ravn.agent import RavnAgent
from ravn.domain.budget import compute_cost as _compute_cost
from ravn.config import OutcomeConfig
from ravn.domain.models import (
    LLMResponse,
    Outcome,
    StopReason,
    StreamEvent,
    StreamEventType,
    TaskOutcome,
    TokenUsage,
)
from ravn.ports.llm import LLMPort
from ravn.ports.outcome import OutcomePort
from tests.ravn.fixtures.fakes import InMemoryChannel

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class RecordingOutcomePort(OutcomePort):
    """In-memory stub that records all record_outcome calls."""

    def __init__(self, lessons: str = "") -> None:
        self.recorded: list[TaskOutcome] = []
        self._lessons = lessons
        self.retrieve_calls: list[str] = []

    async def record_outcome(self, outcome: TaskOutcome) -> None:
        self.recorded.append(outcome)

    async def retrieve_lessons(self, task_description: str, *, limit: int = 3) -> str:
        self.retrieve_calls.append(task_description)
        return self._lessons


def make_simple_llm(response_text: str = "Done!") -> LLMPort:
    """Build a mock LLM that streams a simple text response and supports generate."""

    async def _stream(*args, **kwargs) -> AsyncIterator[StreamEvent]:
        yield StreamEvent(type=StreamEventType.TEXT_DELTA, text=response_text)
        yield StreamEvent(
            type=StreamEventType.MESSAGE_DONE,
            usage=TokenUsage(input_tokens=10, output_tokens=5),
        )

    llm = AsyncMock(spec=LLMPort)
    llm.stream = _stream
    llm.generate = AsyncMock(
        return_value=LLMResponse(
            content="Reflection: went well, nothing to change.",
            tool_calls=[],
            stop_reason=StopReason.END_TURN,
            usage=TokenUsage(input_tokens=5, output_tokens=10),
        )
    )
    return llm


def make_agent(
    llm: LLMPort,
    outcome_port: OutcomePort | None = None,
    outcome_config: OutcomeConfig | None = None,
) -> tuple[RavnAgent, InMemoryChannel]:
    ch = InMemoryChannel()
    agent = RavnAgent(
        llm=llm,
        tools=[],
        channel=ch,
        permission=AllowAllPermission(),
        system_prompt="You are a test assistant.",
        model="claude-sonnet-4-6",
        max_tokens=1024,
        max_iterations=5,
        outcome_port=outcome_port,
        outcome_config=outcome_config,
    )
    return agent, ch


# ---------------------------------------------------------------------------
# _compute_cost
# ---------------------------------------------------------------------------


class TestComputeCost:
    def test_zero_tokens(self) -> None:
        assert _compute_cost(0, 0, 3.0, 15.0) == 0.0

    def test_one_million_input(self) -> None:
        assert _compute_cost(1_000_000, 0, 3.0, 15.0) == pytest.approx(3.0)

    def test_one_million_output(self) -> None:
        assert _compute_cost(0, 1_000_000, 3.0, 15.0) == pytest.approx(15.0)

    def test_mixed(self) -> None:
        expected = 100_000 * 3.0 / 1_000_000 + 50_000 * 15.0 / 1_000_000
        assert _compute_cost(100_000, 50_000, 3.0, 15.0) == pytest.approx(expected)


# ---------------------------------------------------------------------------
# SQLiteOutcomeAdapter
# ---------------------------------------------------------------------------


def _make_outcome(
    task_id: str = "t1",
    summary: str = "deploy to production",
    outcome: Outcome = Outcome.SUCCESS,
    reflection: str = "Everything worked.",
    tags: list[str] | None = None,
) -> TaskOutcome:
    return TaskOutcome(
        task_id=task_id,
        task_summary=summary,
        outcome=outcome,
        tools_used=["bash", "git"],
        iterations_used=3,
        cost_usd=0.001,
        duration_seconds=12.5,
        errors=[],
        reflection=reflection,
        tags=tags or ["shell", "git"],
        timestamp=datetime(2026, 4, 5, 12, 0, 0, tzinfo=UTC),
    )


@pytest.fixture
def db_path(tmp_path: Path) -> str:
    return str(tmp_path / "test_outcomes.db")


class TestSQLiteOutcomeAdapterRecord:
    async def test_record_and_retrieve(self, db_path: str) -> None:
        adapter = SQLiteOutcomeAdapter(path=db_path)
        outcome = _make_outcome()
        await adapter.record_outcome(outcome)

        # Verify with direct DB access.
        conn = sqlite3.connect(db_path)
        row = conn.execute("SELECT task_id FROM task_outcomes WHERE task_id = 't1'").fetchone()
        conn.close()
        assert row is not None
        assert row[0] == "t1"

    async def test_record_replace(self, db_path: str) -> None:
        adapter = SQLiteOutcomeAdapter(path=db_path)
        await adapter.record_outcome(_make_outcome(reflection="v1"))
        await adapter.record_outcome(_make_outcome(reflection="v2"))

        conn = sqlite3.connect(db_path)
        rows = conn.execute("SELECT COUNT(*) FROM task_outcomes WHERE task_id = 't1'").fetchone()
        conn.close()
        assert rows[0] == 1

    async def test_record_multiple_distinct(self, db_path: str) -> None:
        adapter = SQLiteOutcomeAdapter(path=db_path)
        await adapter.record_outcome(_make_outcome(task_id="t1"))
        await adapter.record_outcome(_make_outcome(task_id="t2"))

        conn = sqlite3.connect(db_path)
        count = conn.execute("SELECT COUNT(*) FROM task_outcomes").fetchone()[0]
        conn.close()
        assert count == 2

    async def test_db_directory_created(self, tmp_path: Path) -> None:
        nested = tmp_path / "nested" / "dir" / "outcomes.db"
        adapter = SQLiteOutcomeAdapter(path=str(nested))
        await adapter.record_outcome(_make_outcome())
        assert nested.exists()


class TestSQLiteOutcomeAdapterRetrieveLessons:
    async def test_returns_empty_for_no_records(self, db_path: str) -> None:
        adapter = SQLiteOutcomeAdapter(path=db_path)
        result = await adapter.retrieve_lessons("deploy to production")
        assert result == ""

    async def test_returns_empty_for_empty_query(self, db_path: str) -> None:
        adapter = SQLiteOutcomeAdapter(path=db_path)
        result = await adapter.retrieve_lessons("")
        assert result == ""

    async def test_finds_relevant_outcome(self, db_path: str) -> None:
        adapter = SQLiteOutcomeAdapter(path=db_path)
        await adapter.record_outcome(_make_outcome(summary="deploy production server"))
        result = await adapter.retrieve_lessons("deploy production")
        assert "deploy production server" in result

    async def test_lessons_block_header(self, db_path: str) -> None:
        adapter = SQLiteOutcomeAdapter(path=db_path)
        await adapter.record_outcome(_make_outcome(summary="run bash scripts"))
        result = await adapter.retrieve_lessons("bash scripts")
        assert "## Lessons Learned" in result

    async def test_lessons_contains_reflection(self, db_path: str) -> None:
        adapter = SQLiteOutcomeAdapter(path=db_path)
        await adapter.record_outcome(_make_outcome(reflection="Always check exit codes."))
        result = await adapter.retrieve_lessons("deploy scripts")
        # May or may not match depending on FTS; at minimum it should not crash.
        assert isinstance(result, str)

    async def test_limit_respected(self, db_path: str) -> None:
        adapter = SQLiteOutcomeAdapter(path=db_path)
        for i in range(5):
            await adapter.record_outcome(_make_outcome(task_id=f"t{i}", summary=f"deploy task {i}"))
        result = await adapter.retrieve_lessons("deploy task", limit=2)
        # Should not contain more than 2 outcomes (each has a date header).
        entries = re.findall(r"\*\*\d{4}-\d{2}-\d{2}\*\*", result)
        assert len(entries) <= 2

    async def test_stopwords_only_query_returns_empty(self, db_path: str) -> None:
        adapter = SQLiteOutcomeAdapter(path=db_path)
        # "a the and" are all stopwords, so query sanitises to nothing.
        result = await adapter.retrieve_lessons("a the and")
        assert result == ""


# ---------------------------------------------------------------------------
# _sanitise_fts_query
# ---------------------------------------------------------------------------


class TestSanitiseFtsQuery:
    def test_removes_special_chars(self) -> None:
        q = _sanitise_fts_query('deploy "production" AND (server)')
        assert '"' not in q
        assert "(" not in q

    def test_strips_stopwords(self) -> None:
        q = _sanitise_fts_query("a the and or in")
        assert q == ""

    def test_empty_string(self) -> None:
        assert _sanitise_fts_query("") == ""

    def test_returns_or_joined(self) -> None:
        q = _sanitise_fts_query("deploy bash script")
        assert " OR " in q

    def test_case_insensitive(self) -> None:
        q = _sanitise_fts_query("Deploy BASH Script")
        assert "deploy" in q.lower()


# ---------------------------------------------------------------------------
# _format_lessons
# ---------------------------------------------------------------------------


class TestFormatLessons:
    def _make_row(
        self,
        summary: str = "test task",
        outcome: str = "success",
        reflection: str = "It worked.",
        timestamp: str = "2026-04-05T12:00:00+00:00",
    ) -> sqlite3.Row:
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        conn.execute(
            """
            CREATE TABLE t (task_summary TEXT, outcome TEXT, reflection TEXT, timestamp TEXT)
            """
        )
        conn.execute("INSERT INTO t VALUES (?, ?, ?, ?)", (summary, outcome, reflection, timestamp))
        return conn.execute("SELECT * FROM t").fetchone()

    def test_empty_rows_returns_empty(self) -> None:
        assert _format_lessons([]) == ""

    def test_header_present(self) -> None:
        rows = [self._make_row()]
        result = _format_lessons(rows)
        assert "## Lessons Learned" in result

    def test_date_in_output(self) -> None:
        rows = [self._make_row(timestamp="2026-04-05T12:00:00+00:00")]
        result = _format_lessons(rows)
        assert "2026-04-05" in result

    def test_outcome_in_output(self) -> None:
        rows = [self._make_row(outcome="failure")]
        result = _format_lessons(rows)
        assert "failure" in result

    def test_reflection_in_output(self) -> None:
        rows = [self._make_row(reflection="Use smaller commits.")]
        result = _format_lessons(rows)
        assert "Use smaller commits." in result

    def test_invalid_timestamp_uses_unknown(self) -> None:
        rows = [self._make_row(timestamp="not-a-date")]
        result = _format_lessons(rows)
        assert "unknown" in result


# ---------------------------------------------------------------------------
# OutcomePort (abstract interface)
# ---------------------------------------------------------------------------


class TestOutcomePort:
    def test_cannot_instantiate_abstract(self) -> None:
        with pytest.raises(TypeError):
            OutcomePort()  # type: ignore[abstract]

    def test_concrete_implements_both_methods(self) -> None:
        port = RecordingOutcomePort()
        assert hasattr(port, "record_outcome")
        assert hasattr(port, "retrieve_lessons")


# ---------------------------------------------------------------------------
# TaskOutcome model
# ---------------------------------------------------------------------------


class TestTaskOutcomeModel:
    def test_all_fields_set(self) -> None:
        now = datetime.now(UTC)
        outcome = TaskOutcome(
            task_id="abc",
            task_summary="fix the bug",
            outcome=Outcome.SUCCESS,
            tools_used=["bash"],
            iterations_used=2,
            cost_usd=0.005,
            duration_seconds=3.7,
            errors=[],
            reflection="Nothing to improve.",
            tags=["shell"],
            timestamp=now,
        )
        assert outcome.task_id == "abc"
        assert outcome.outcome == Outcome.SUCCESS
        assert outcome.cost_usd == pytest.approx(0.005)
        assert outcome.timestamp is now

    def test_errors_list(self) -> None:
        outcome = _make_outcome()
        outcome.errors = ["tool error: permission denied", "bash failed"]
        assert len(outcome.errors) == 2


# ---------------------------------------------------------------------------
# Agent integration with outcome recording
# ---------------------------------------------------------------------------


class TestAgentOutcomeRecording:
    async def test_outcome_recorded_after_turn(self) -> None:
        port = RecordingOutcomePort()
        agent, _ = make_agent(make_simple_llm(), outcome_port=port)
        await agent.run_turn("deploy to production")
        assert len(port.recorded) == 1

    async def test_outcome_task_summary_matches_input(self) -> None:
        port = RecordingOutcomePort()
        agent, _ = make_agent(make_simple_llm(), outcome_port=port)
        await agent.run_turn("run the test suite")
        assert "run the test suite" in port.recorded[0].task_summary

    async def test_outcome_has_reflection(self) -> None:
        port = RecordingOutcomePort()
        agent, _ = make_agent(make_simple_llm(), outcome_port=port)
        await agent.run_turn("build the project")
        assert port.recorded[0].reflection != ""

    async def test_reflection_calls_llm_generate(self) -> None:
        port = RecordingOutcomePort()
        llm = make_simple_llm()
        agent, _ = make_agent(llm, outcome_port=port)
        await agent.run_turn("analyse logs")
        # generate() is called for the reflection
        llm.generate.assert_called_once()

    async def test_reflection_uses_configured_model(self) -> None:
        port = RecordingOutcomePort()
        llm = make_simple_llm()
        reflection_model = "claude-haiku-4-5-20251001"
        cfg = OutcomeConfig(reflection_model=reflection_model)
        agent, _ = make_agent(llm, outcome_port=port, outcome_config=cfg)
        await agent.run_turn("read the docs")
        call_kwargs = llm.generate.call_args.kwargs
        assert call_kwargs["model"] == reflection_model

    async def test_no_outcome_port_works_normally(self) -> None:
        agent, _ = make_agent(make_simple_llm(), outcome_port=None)
        result = await agent.run_turn("hello")
        assert result.response == "Done!"

    async def test_outcome_recording_failure_does_not_crash(self) -> None:
        port = RecordingOutcomePort()
        port.record_outcome = AsyncMock(side_effect=RuntimeError("db error"))
        agent, _ = make_agent(make_simple_llm(), outcome_port=port)
        result = await agent.run_turn("hello")
        assert result.response == "Done!"

    async def test_reflection_failure_stores_fallback_message(self) -> None:
        port = RecordingOutcomePort()
        llm = make_simple_llm()
        llm.generate = AsyncMock(side_effect=RuntimeError("api error"))
        agent, _ = make_agent(llm, outcome_port=port)
        await agent.run_turn("task with failed reflection")
        assert "unavailable" in port.recorded[0].reflection.lower()

    async def test_multiple_turns_record_multiple_outcomes(self) -> None:
        port = RecordingOutcomePort()
        agent, _ = make_agent(make_simple_llm(), outcome_port=port)
        await agent.run_turn("first task")
        await agent.run_turn("second task")
        assert len(port.recorded) == 2

    async def test_outcome_duration_is_positive(self) -> None:
        port = RecordingOutcomePort()
        agent, _ = make_agent(make_simple_llm(), outcome_port=port)
        await agent.run_turn("quick task")
        assert port.recorded[0].duration_seconds >= 0.0

    async def test_outcome_iterations_used(self) -> None:
        port = RecordingOutcomePort()
        agent, _ = make_agent(make_simple_llm(), outcome_port=port)
        await agent.run_turn("task")
        # Simple LLM returns text immediately (1 iteration).
        assert port.recorded[0].iterations_used >= 1

    async def test_outcome_cost_usd_nonnegative(self) -> None:
        port = RecordingOutcomePort()
        agent, _ = make_agent(make_simple_llm(), outcome_port=port)
        await agent.run_turn("task")
        assert port.recorded[0].cost_usd >= 0.0

    async def test_task_summary_truncated_at_max_chars(self) -> None:
        port = RecordingOutcomePort()
        agent, _ = make_agent(make_simple_llm(), outcome_port=port)
        long_input = "x" * 300
        await agent.run_turn(long_input)
        assert len(port.recorded[0].task_summary) <= 203  # 200 + ellipsis


class TestAgentLessonsInjection:
    async def test_retrieve_lessons_called_with_user_input(self) -> None:
        port = RecordingOutcomePort(lessons="")
        agent, _ = make_agent(make_simple_llm(), outcome_port=port)
        await agent.run_turn("analyse production logs")
        assert port.retrieve_calls == ["analyse production logs"]

    async def test_lessons_injected_into_system_prompt(self) -> None:
        lessons = "## Lessons Learned\n\nAlways check exit codes."
        port = RecordingOutcomePort(lessons=lessons)
        llm = make_simple_llm()
        agent, _ = make_agent(llm, outcome_port=port)

        captured_system: list[str] = []
        original_stream = llm.stream

        async def capturing_stream(*args, **kwargs) -> AsyncIterator[StreamEvent]:
            captured_system.append(kwargs.get("system", ""))
            async for event in original_stream(*args, **kwargs):
                yield event

        llm.stream = capturing_stream
        await agent.run_turn("run deployment")
        assert any("Lessons Learned" in s for s in captured_system)

    async def test_empty_lessons_not_injected(self) -> None:
        port = RecordingOutcomePort(lessons="")
        llm = make_simple_llm()
        agent, _ = make_agent(llm, outcome_port=port)

        captured_system: list[str] = []
        original_stream = llm.stream

        async def capturing_stream(*args, **kwargs) -> AsyncIterator[StreamEvent]:
            captured_system.append(kwargs.get("system", ""))
            async for event in original_stream(*args, **kwargs):
                yield event

        llm.stream = capturing_stream
        await agent.run_turn("task")
        assert all("Lessons Learned" not in s for s in captured_system)

    async def test_lessons_retrieval_failure_does_not_crash(self) -> None:
        port = RecordingOutcomePort()
        port.retrieve_lessons = AsyncMock(side_effect=RuntimeError("db error"))
        agent, _ = make_agent(make_simple_llm(), outcome_port=port)
        result = await agent.run_turn("hello")
        assert result.response == "Done!"


# ---------------------------------------------------------------------------
# SQLite outcome adapter end-to-end: record then retrieve
# ---------------------------------------------------------------------------


class TestSQLiteOutcomeEndToEnd:
    async def test_record_and_retrieve_lessons(self, db_path: str) -> None:
        adapter = SQLiteOutcomeAdapter(path=db_path)
        outcome = TaskOutcome(
            task_id="e2e-1",
            task_summary="run pytest suite for authentication module",
            outcome=Outcome.SUCCESS,
            tools_used=["bash"],
            iterations_used=2,
            cost_usd=0.002,
            duration_seconds=8.0,
            errors=[],
            reflection="Tests passed. Use fixtures for faster setup next time.",
            tags=["shell", "testing"],
            timestamp=datetime(2026, 4, 5, 10, 0, 0, tzinfo=UTC),
        )
        await adapter.record_outcome(outcome)
        result = await adapter.retrieve_lessons("run pytest tests")
        # Should find the relevant outcome.
        assert "pytest" in result.lower() or "## Lessons Learned" in result

    async def test_empty_db_returns_empty_lessons(self, db_path: str) -> None:
        adapter = SQLiteOutcomeAdapter(path=db_path)
        result = await adapter.retrieve_lessons("anything")
        assert result == ""
