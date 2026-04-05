"""Unit tests for introspection tools (ravn_state, ravn_memory_search, ravn_reflect)."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from ravn.adapters.tools.introspection import (
    _INTROSPECT_PERMISSION,
    RavnMemorySearchTool,
    RavnReflectTool,
    RavnStateTool,
)
from ravn.budget import IterationBudget
from ravn.domain.models import (
    Episode,
    EpisodeMatch,
    LLMResponse,
    Message,
    Outcome,
    Session,
    SharedContext,
    StopReason,
    TokenUsage,
)
from ravn.ports.llm import LLMPort
from ravn.ports.memory import MemoryPort

# ---------------------------------------------------------------------------
# Stubs / fakes
# ---------------------------------------------------------------------------


class StubMemory(MemoryPort):
    """Configurable in-memory stub for MemoryPort."""

    def __init__(
        self,
        episodes: list[EpisodeMatch] | None = None,
        raise_on_query: Exception | None = None,
    ) -> None:
        self._episodes = episodes or []
        self._raise_on_query = raise_on_query
        self._shared: SharedContext | None = None

    async def record_episode(self, episode: Episode) -> None:
        pass

    async def query_episodes(
        self, query: str, *, limit: int = 5, min_relevance: float = 0.3
    ) -> list[EpisodeMatch]:
        if self._raise_on_query is not None:
            raise self._raise_on_query
        return self._episodes[:limit]

    async def prefetch(self, context: str) -> str:
        return ""

    async def search_sessions(self, query: str, *, limit: int = 3):  # type: ignore[override]
        return []

    def inject_shared_context(self, context: SharedContext) -> None:
        self._shared = context

    def get_shared_context(self) -> SharedContext | None:
        return self._shared


def _make_episode(
    *,
    outcome: Outcome = Outcome.SUCCESS,
    tools_used: list[str] | None = None,
    tags: list[str] | None = None,
    summary: str = "did some work",
    session_id: str = "sess-abc-12345678",
) -> Episode:
    return Episode(
        episode_id="ep-1",
        session_id=session_id,
        timestamp=datetime(2025, 3, 1, 12, 0, tzinfo=UTC),
        summary=summary,
        task_description="test task",
        tools_used=tools_used or ["bash", "git"],
        outcome=outcome,
        tags=tags or ["shell", "git"],
        embedding=None,
    )


def _make_match(relevance: float = 0.85, **kwargs) -> EpisodeMatch:
    return EpisodeMatch(episode=_make_episode(**kwargs), relevance=relevance)


def _make_llm(response: str = "Reflection content.") -> LLMPort:
    llm = AsyncMock(spec=LLMPort)
    llm.generate = AsyncMock(
        return_value=LLMResponse(
            content=response,
            tool_calls=[],
            stop_reason=StopReason.END_TURN,
            usage=TokenUsage(input_tokens=10, output_tokens=20),
        )
    )
    return llm


# ---------------------------------------------------------------------------
# RavnStateTool — metadata
# ---------------------------------------------------------------------------


class TestRavnStateToolMetadata:
    def test_name(self) -> None:
        tool = RavnStateTool(tool_names=[], permission_mode="workspace_write", model="m")
        assert tool.name == "ravn_state"

    def test_description_not_empty(self) -> None:
        tool = RavnStateTool(tool_names=[], permission_mode="workspace_write", model="m")
        assert len(tool.description) > 20

    def test_required_permission(self) -> None:
        tool = RavnStateTool(tool_names=[], permission_mode="workspace_write", model="m")
        assert tool.required_permission == _INTROSPECT_PERMISSION

    def test_input_schema_type(self) -> None:
        tool = RavnStateTool(tool_names=[], permission_mode="workspace_write", model="m")
        assert tool.input_schema["type"] == "object"

    def test_parallelisable_default(self) -> None:
        tool = RavnStateTool(tool_names=[], permission_mode="workspace_write", model="m")
        assert tool.parallelisable is True

    def test_to_api_dict_has_required_keys(self) -> None:
        tool = RavnStateTool(tool_names=[], permission_mode="workspace_write", model="m")
        d = tool.to_api_dict()
        assert {"name", "description", "input_schema"} <= d.keys()


# ---------------------------------------------------------------------------
# RavnStateTool — execute
# ---------------------------------------------------------------------------


class TestRavnStateToolExecute:
    @pytest.mark.asyncio
    async def test_includes_model(self) -> None:
        tool = RavnStateTool(
            tool_names=[], permission_mode="workspace_write", model="claude-sonnet-4-6"
        )
        result = await tool.execute({})
        assert "claude-sonnet-4-6" in result.content
        assert not result.is_error

    @pytest.mark.asyncio
    async def test_includes_permission_mode(self) -> None:
        tool = RavnStateTool(tool_names=[], permission_mode="read_only", model="m")
        result = await tool.execute({})
        assert "read_only" in result.content

    @pytest.mark.asyncio
    async def test_includes_tool_names(self) -> None:
        tool = RavnStateTool(
            tool_names=["bash", "git", "web_fetch"],
            permission_mode="workspace_write",
            model="m",
        )
        result = await tool.execute({})
        assert "bash" in result.content
        assert "git" in result.content
        assert "web_fetch" in result.content

    @pytest.mark.asyncio
    async def test_includes_tool_count(self) -> None:
        tool = RavnStateTool(
            tool_names=["bash", "git"],
            permission_mode="workspace_write",
            model="m",
        )
        result = await tool.execute({})
        assert "2" in result.content

    @pytest.mark.asyncio
    async def test_no_budget_shows_not_configured(self) -> None:
        tool = RavnStateTool(tool_names=[], permission_mode="workspace_write", model="m")
        result = await tool.execute({})
        assert "not configured" in result.content

    @pytest.mark.asyncio
    async def test_budget_shows_used_and_remaining(self) -> None:
        budget = IterationBudget(total=50, consumed=10)
        tool = RavnStateTool(
            tool_names=[],
            permission_mode="workspace_write",
            model="m",
            iteration_budget=budget,
        )
        result = await tool.execute({})
        assert "10" in result.content
        assert "40" in result.content  # remaining = 50 - 10
        assert "50" in result.content

    @pytest.mark.asyncio
    async def test_budget_near_limit_flag(self) -> None:
        budget = IterationBudget(total=10, consumed=9)
        tool = RavnStateTool(
            tool_names=[],
            permission_mode="workspace_write",
            model="m",
            iteration_budget=budget,
        )
        result = await tool.execute({})
        assert "True" in result.content  # near_limit = True

    @pytest.mark.asyncio
    async def test_budget_task_ceiling_shown(self) -> None:
        budget = IterationBudget(total=100, consumed=5, task_ceiling=30)
        tool = RavnStateTool(
            tool_names=[],
            permission_mode="workspace_write",
            model="m",
            iteration_budget=budget,
        )
        result = await tool.execute({})
        assert "30" in result.content

    @pytest.mark.asyncio
    async def test_memory_active(self) -> None:
        tool = RavnStateTool(
            tool_names=[],
            permission_mode="workspace_write",
            model="m",
            memory=StubMemory(),
        )
        result = await tool.execute({})
        assert "episodic memory active" in result.content

    @pytest.mark.asyncio
    async def test_memory_not_configured(self) -> None:
        tool = RavnStateTool(tool_names=[], permission_mode="workspace_write", model="m")
        result = await tool.execute({})
        assert "not configured" in result.content

    @pytest.mark.asyncio
    async def test_persona_shown(self) -> None:
        tool = RavnStateTool(
            tool_names=[],
            permission_mode="workspace_write",
            model="m",
            persona="coding-agent",
        )
        result = await tool.execute({})
        assert "coding-agent" in result.content

    @pytest.mark.asyncio
    async def test_default_persona_shown_when_empty(self) -> None:
        tool = RavnStateTool(tool_names=[], permission_mode="workspace_write", model="m")
        result = await tool.execute({})
        assert "default" in result.content

    @pytest.mark.asyncio
    async def test_empty_tool_list(self) -> None:
        tool = RavnStateTool(tool_names=[], permission_mode="workspace_write", model="m")
        result = await tool.execute({})
        assert "(none)" in result.content


# ---------------------------------------------------------------------------
# RavnMemorySearchTool — metadata
# ---------------------------------------------------------------------------


class TestRavnMemorySearchToolMetadata:
    def test_name(self) -> None:
        tool = RavnMemorySearchTool(memory=StubMemory())
        assert tool.name == "ravn_memory_search"

    def test_description_not_empty(self) -> None:
        tool = RavnMemorySearchTool(memory=StubMemory())
        assert len(tool.description) > 20

    def test_required_permission(self) -> None:
        tool = RavnMemorySearchTool(memory=StubMemory())
        assert tool.required_permission == _INTROSPECT_PERMISSION

    def test_schema_has_query(self) -> None:
        tool = RavnMemorySearchTool(memory=StubMemory())
        assert "query" in tool.input_schema["properties"]
        assert "query" in tool.input_schema["required"]

    def test_schema_has_limit(self) -> None:
        tool = RavnMemorySearchTool(memory=StubMemory())
        assert "limit" in tool.input_schema["properties"]

    def test_to_api_dict(self) -> None:
        tool = RavnMemorySearchTool(memory=StubMemory())
        d = tool.to_api_dict()
        assert d["name"] == "ravn_memory_search"
        assert "description" in d
        assert "input_schema" in d


# ---------------------------------------------------------------------------
# RavnMemorySearchTool — execute
# ---------------------------------------------------------------------------


class TestRavnMemorySearchToolExecute:
    @pytest.mark.asyncio
    async def test_empty_query_returns_error(self) -> None:
        tool = RavnMemorySearchTool(memory=StubMemory())
        result = await tool.execute({"query": ""})
        assert result.is_error
        assert "empty" in result.content

    @pytest.mark.asyncio
    async def test_whitespace_query_returns_error(self) -> None:
        tool = RavnMemorySearchTool(memory=StubMemory())
        result = await tool.execute({"query": "   "})
        assert result.is_error

    @pytest.mark.asyncio
    async def test_no_matches_returns_not_found(self) -> None:
        tool = RavnMemorySearchTool(memory=StubMemory(episodes=[]))
        result = await tool.execute({"query": "kubernetes deploy"})
        assert not result.is_error
        assert "No episodes found" in result.content

    @pytest.mark.asyncio
    async def test_returns_episode_summary(self) -> None:
        match = _make_match(summary="ran the test suite and all passed")
        tool = RavnMemorySearchTool(memory=StubMemory(episodes=[match]))
        result = await tool.execute({"query": "tests"})
        assert "ran the test suite and all passed" in result.content

    @pytest.mark.asyncio
    async def test_returns_outcome(self) -> None:
        match = _make_match(outcome=Outcome.FAILURE)
        tool = RavnMemorySearchTool(memory=StubMemory(episodes=[match]))
        result = await tool.execute({"query": "deploy"})
        assert "failure" in result.content.lower()

    @pytest.mark.asyncio
    async def test_returns_tools_used(self) -> None:
        match = _make_match(tools_used=["bash", "git"])
        tool = RavnMemorySearchTool(memory=StubMemory(episodes=[match]))
        result = await tool.execute({"query": "work"})
        assert "bash" in result.content
        assert "git" in result.content

    @pytest.mark.asyncio
    async def test_returns_relevance_score(self) -> None:
        match = _make_match(relevance=0.73)
        tool = RavnMemorySearchTool(memory=StubMemory(episodes=[match]))
        result = await tool.execute({"query": "test"})
        assert "0.73" in result.content

    @pytest.mark.asyncio
    async def test_default_limit_used(self) -> None:
        memory = AsyncMock(spec=MemoryPort)
        memory.query_episodes = AsyncMock(return_value=[])
        tool = RavnMemorySearchTool(memory=memory, default_limit=3)
        await tool.execute({"query": "test"})
        _, kwargs = memory.query_episodes.call_args
        assert kwargs.get("limit") == 3

    @pytest.mark.asyncio
    async def test_custom_limit_respected(self) -> None:
        memory = AsyncMock(spec=MemoryPort)
        memory.query_episodes = AsyncMock(return_value=[])
        tool = RavnMemorySearchTool(memory=memory)
        await tool.execute({"query": "test", "limit": 8})
        _, kwargs = memory.query_episodes.call_args
        assert kwargs.get("limit") == 8

    @pytest.mark.asyncio
    async def test_limit_capped_at_max(self) -> None:
        memory = AsyncMock(spec=MemoryPort)
        memory.query_episodes = AsyncMock(return_value=[])
        tool = RavnMemorySearchTool(memory=memory)
        await tool.execute({"query": "test", "limit": 999})
        _, kwargs = memory.query_episodes.call_args
        assert kwargs.get("limit") <= 20

    @pytest.mark.asyncio
    async def test_memory_error_returns_error_result(self) -> None:
        tool = RavnMemorySearchTool(
            memory=StubMemory(raise_on_query=RuntimeError("db connection lost"))
        )
        result = await tool.execute({"query": "something"})
        assert result.is_error
        assert "Memory search failed" in result.content

    @pytest.mark.asyncio
    async def test_session_id_prefix_shown(self) -> None:
        match = _make_match(session_id="abcdef12-rest-of-uuid")
        tool = RavnMemorySearchTool(memory=StubMemory(episodes=[match]))
        result = await tool.execute({"query": "test"})
        assert "abcdef12" in result.content

    @pytest.mark.asyncio
    async def test_multiple_episodes_formatted(self) -> None:
        matches = [
            _make_match(summary="episode one summary"),
            _make_match(summary="episode two summary"),
        ]
        tool = RavnMemorySearchTool(memory=StubMemory(episodes=matches))
        result = await tool.execute({"query": "test"})
        assert "episode one summary" in result.content
        assert "episode two summary" in result.content
        assert "Found 2 episode(s)" in result.content

    @pytest.mark.asyncio
    async def test_tags_shown(self) -> None:
        match = _make_match(tags=["ci", "testing"])
        tool = RavnMemorySearchTool(memory=StubMemory(episodes=[match]))
        result = await tool.execute({"query": "test"})
        assert "ci" in result.content
        assert "testing" in result.content


# ---------------------------------------------------------------------------
# RavnReflectTool — metadata
# ---------------------------------------------------------------------------


class TestRavnReflectToolMetadata:
    def test_name(self) -> None:
        tool = RavnReflectTool(llm=_make_llm(), session=Session(), model="m")
        assert tool.name == "ravn_reflect"

    def test_description_not_empty(self) -> None:
        tool = RavnReflectTool(llm=_make_llm(), session=Session(), model="m")
        assert len(tool.description) > 20

    def test_required_permission(self) -> None:
        tool = RavnReflectTool(llm=_make_llm(), session=Session(), model="m")
        assert tool.required_permission == _INTROSPECT_PERMISSION

    def test_not_parallelisable(self) -> None:
        tool = RavnReflectTool(llm=_make_llm(), session=Session(), model="m")
        assert tool.parallelisable is False

    def test_schema_has_task_description(self) -> None:
        tool = RavnReflectTool(llm=_make_llm(), session=Session(), model="m")
        assert "task_description" in tool.input_schema["properties"]
        assert "task_description" in tool.input_schema["required"]

    def test_to_api_dict(self) -> None:
        tool = RavnReflectTool(llm=_make_llm(), session=Session(), model="m")
        d = tool.to_api_dict()
        assert d["name"] == "ravn_reflect"


# ---------------------------------------------------------------------------
# RavnReflectTool — execute
# ---------------------------------------------------------------------------


class TestRavnReflectToolExecute:
    @pytest.mark.asyncio
    async def test_empty_task_description_returns_error(self) -> None:
        tool = RavnReflectTool(llm=_make_llm(), session=Session(), model="m")
        result = await tool.execute({"task_description": ""})
        assert result.is_error
        assert "empty" in result.content

    @pytest.mark.asyncio
    async def test_whitespace_task_description_returns_error(self) -> None:
        tool = RavnReflectTool(llm=_make_llm(), session=Session(), model="m")
        result = await tool.execute({"task_description": "   "})
        assert result.is_error

    @pytest.mark.asyncio
    async def test_returns_llm_reflection(self) -> None:
        tool = RavnReflectTool(
            llm=_make_llm("Everything is progressing well."),
            session=Session(),
            model="m",
        )
        result = await tool.execute({"task_description": "deploy service"})
        assert not result.is_error
        assert "Everything is progressing well." in result.content

    @pytest.mark.asyncio
    async def test_includes_task_in_header(self) -> None:
        tool = RavnReflectTool(llm=_make_llm(), session=Session(), model="m")
        result = await tool.execute({"task_description": "fix the CI pipeline"})
        assert "fix the CI pipeline" in result.content

    @pytest.mark.asyncio
    async def test_llm_called_with_correct_model(self) -> None:
        llm = _make_llm()
        tool = RavnReflectTool(llm=llm, session=Session(), model="claude-haiku-4-5")
        await tool.execute({"task_description": "some task"})
        _, kwargs = llm.generate.call_args
        assert kwargs.get("model") == "claude-haiku-4-5"

    @pytest.mark.asyncio
    async def test_llm_called_with_empty_tools(self) -> None:
        llm = _make_llm()
        tool = RavnReflectTool(llm=llm, session=Session(), model="m")
        await tool.execute({"task_description": "some task"})
        _, kwargs = llm.generate.call_args
        assert kwargs.get("tools") == []

    @pytest.mark.asyncio
    async def test_extracts_tools_from_session(self) -> None:
        session = Session()
        session.messages.append(
            Message(
                role="assistant",
                content=[
                    {"type": "tool_use", "id": "t1", "name": "bash", "input": {}},
                    {"type": "tool_use", "id": "t2", "name": "git", "input": {}},
                ],
            )
        )
        llm = _make_llm()
        tool = RavnReflectTool(llm=llm, session=session, model="m")
        await tool.execute({"task_description": "run tests"})
        # messages is the first positional arg to generate()
        pos_args, _ = llm.generate.call_args
        prompt = pos_args[0][0].get("content", "")
        assert "bash" in prompt
        assert "git" in prompt

    @pytest.mark.asyncio
    async def test_no_tools_in_session_shows_none(self) -> None:
        session = Session()
        llm = _make_llm()
        tool = RavnReflectTool(llm=llm, session=session, model="m")
        await tool.execute({"task_description": "start task"})
        pos_args, _ = llm.generate.call_args
        prompt = pos_args[0][0].get("content", "")
        assert "none yet" in prompt

    @pytest.mark.asyncio
    async def test_llm_failure_returns_error_result(self) -> None:
        llm = AsyncMock(spec=LLMPort)
        llm.generate = AsyncMock(side_effect=RuntimeError("LLM unavailable"))
        tool = RavnReflectTool(llm=llm, session=Session(), model="m")
        result = await tool.execute({"task_description": "do something"})
        assert result.is_error
        assert "Reflection failed" in result.content

    @pytest.mark.asyncio
    async def test_long_task_description_truncated_in_header(self) -> None:
        long_desc = "x" * 200
        tool = RavnReflectTool(llm=_make_llm(), session=Session(), model="m")
        result = await tool.execute({"task_description": long_desc})
        assert "…" in result.content

    @pytest.mark.asyncio
    async def test_turn_count_shown_in_header(self) -> None:
        session = Session()
        session.record_turn(TokenUsage(input_tokens=5, output_tokens=5))
        session.record_turn(TokenUsage(input_tokens=5, output_tokens=5))
        tool = RavnReflectTool(llm=_make_llm(), session=session, model="m")
        result = await tool.execute({"task_description": "do something"})
        assert "**Turn**: 2" in result.content

    @pytest.mark.asyncio
    async def test_skips_non_list_message_content(self) -> None:
        """String-content messages should not cause errors during tool extraction."""
        session = Session()
        session.messages.append(Message(role="user", content="plain text message"))
        tool = RavnReflectTool(llm=_make_llm(), session=session, model="m")
        result = await tool.execute({"task_description": "task"})
        assert not result.is_error


# ---------------------------------------------------------------------------
# Shared: introspect:read permission passes in read_only mode
# ---------------------------------------------------------------------------


class TestIntrospectPermissionGrantedInReadOnly:
    """The introspect:read permission must not contain any blocked keywords
    that would cause PermissionEnforcer to deny it in read_only mode."""

    def test_no_blocked_keywords_in_permission(self) -> None:
        blocked = ("write", "delete", "execute", "bash", "shell")
        for keyword in blocked:
            assert keyword not in _INTROSPECT_PERMISSION
