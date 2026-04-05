"""Tests for the session_search tool."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock

from ravn.adapters.tools.session_search import SessionSearchTool
from ravn.domain.models import Episode, EpisodeMatch, SessionSummary, SharedContext
from ravn.ports.memory import MemoryPort


class StubMemory(MemoryPort):
    """Configurable stub for MemoryPort."""

    def __init__(self, summaries: list[SessionSummary] | None = None) -> None:
        self._summaries = summaries or []
        self._shared: SharedContext | None = None

    async def record_episode(self, episode: Episode) -> None:
        pass

    async def query_episodes(
        self, query: str, *, limit: int = 5, min_relevance: float = 0.3
    ) -> list[EpisodeMatch]:
        return []

    async def prefetch(self, context: str) -> str:
        return ""

    async def search_sessions(self, query: str, *, limit: int = 3) -> list[SessionSummary]:
        return self._summaries[:limit]

    def inject_shared_context(self, context: SharedContext) -> None:
        self._shared = context

    def get_shared_context(self) -> SharedContext | None:
        return self._shared


def _make_summary(session_id: str = "sess-1", summary: str = "did stuff") -> SessionSummary:
    return SessionSummary(
        session_id=session_id,
        summary=summary,
        episode_count=2,
        last_active=datetime(2025, 1, 1, tzinfo=UTC),
        tags=["git"],
    )


class TestSessionSearchToolMetadata:
    def test_name(self) -> None:
        tool = SessionSearchTool(memory=StubMemory())
        assert tool.name == "session_search"

    def test_description_not_empty(self) -> None:
        tool = SessionSearchTool(memory=StubMemory())
        assert len(tool.description) > 20

    def test_required_permission(self) -> None:
        tool = SessionSearchTool(memory=StubMemory())
        assert tool.required_permission == "memory:read"

    def test_input_schema_has_query(self) -> None:
        tool = SessionSearchTool(memory=StubMemory())
        schema = tool.input_schema
        assert "query" in schema["properties"]
        assert "query" in schema["required"]

    def test_input_schema_has_limit(self) -> None:
        tool = SessionSearchTool(memory=StubMemory())
        schema = tool.input_schema
        assert "limit" in schema["properties"]


class TestSessionSearchToolExecute:
    async def test_empty_query_returns_error(self) -> None:
        tool = SessionSearchTool(memory=StubMemory())
        result = await tool.execute({"query": ""})
        assert result.is_error

    async def test_no_results_returns_not_found_message(self) -> None:
        tool = SessionSearchTool(memory=StubMemory(summaries=[]))
        result = await tool.execute({"query": "kubernetes deployment"})
        assert not result.is_error
        assert "No sessions found" in result.content

    async def test_returns_session_content(self) -> None:
        summaries = [_make_summary(session_id="abc123", summary="configured nginx proxy")]
        tool = SessionSearchTool(memory=StubMemory(summaries=summaries))
        result = await tool.execute({"query": "nginx"})
        assert not result.is_error
        assert "configured nginx proxy" in result.content

    async def test_includes_session_id_prefix(self) -> None:
        summaries = [_make_summary(session_id="deadbeef-1234")]
        tool = SessionSearchTool(memory=StubMemory(summaries=summaries))
        result = await tool.execute({"query": "test"})
        assert "deadbeef" in result.content

    async def test_default_limit_used(self) -> None:
        memory_mock = AsyncMock(spec=MemoryPort)
        memory_mock.search_sessions = AsyncMock(return_value=[])
        tool = SessionSearchTool(memory=memory_mock, limit=3)
        await tool.execute({"query": "test"})
        memory_mock.search_sessions.assert_called_once()
        _, kwargs = memory_mock.search_sessions.call_args
        assert kwargs.get("limit") == 3

    async def test_custom_limit_in_input(self) -> None:
        memory_mock = AsyncMock(spec=MemoryPort)
        memory_mock.search_sessions = AsyncMock(return_value=[])
        tool = SessionSearchTool(memory=memory_mock)
        await tool.execute({"query": "test", "limit": 7})
        _, kwargs = memory_mock.search_sessions.call_args
        assert kwargs.get("limit") == 7

    async def test_limit_capped_at_10(self) -> None:
        memory_mock = AsyncMock(spec=MemoryPort)
        memory_mock.search_sessions = AsyncMock(return_value=[])
        tool = SessionSearchTool(memory=memory_mock)
        await tool.execute({"query": "test", "limit": 99})
        _, kwargs = memory_mock.search_sessions.call_args
        assert kwargs.get("limit") <= 10

    async def test_multiple_sessions_formatted(self) -> None:
        summaries = [
            _make_summary(session_id="s1", summary="deployed to prod"),
            _make_summary(session_id="s2", summary="ran migrations"),
        ]
        tool = SessionSearchTool(memory=StubMemory(summaries=summaries))
        result = await tool.execute({"query": "deploy"})
        assert "deployed to prod" in result.content
        assert "ran migrations" in result.content

    async def test_whitespace_only_query_treated_as_empty(self) -> None:
        tool = SessionSearchTool(memory=StubMemory())
        result = await tool.execute({"query": "   "})
        assert result.is_error

    async def test_to_api_dict_structure(self) -> None:
        tool = SessionSearchTool(memory=StubMemory())
        d = tool.to_api_dict()
        assert d["name"] == "session_search"
        assert "description" in d
        assert "input_schema" in d
