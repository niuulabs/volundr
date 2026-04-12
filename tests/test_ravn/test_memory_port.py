"""Tests for the MemoryPort abstract interface and in-memory stub."""

from __future__ import annotations

from datetime import UTC, datetime

from ravn.domain.models import Episode, EpisodeMatch, Outcome, SessionSummary, SharedContext
from ravn.ports.memory import MemoryPort


class InMemoryMemory(MemoryPort):
    """Minimal in-memory implementation of MemoryPort for interface tests."""

    def __init__(self) -> None:
        self._episodes: list[Episode] = []
        self._shared: SharedContext | None = None

    async def record_episode(self, episode: Episode) -> None:
        self._episodes.append(episode)

    async def query_episodes(
        self,
        query: str,
        *,
        limit: int = 5,
        min_relevance: float = 0.3,
    ) -> list[EpisodeMatch]:
        # Simple substring match for testing.
        matches = [
            EpisodeMatch(episode=ep, relevance=1.0)
            for ep in self._episodes
            if query.lower() in ep.summary.lower() or query.lower() in ep.task_description.lower()
        ]
        return matches[:limit]

    async def prefetch(self, context: str) -> str:
        matches = await self.query_episodes(context)
        if not matches:
            return ""
        lines = [f"- {m.episode.summary}" for m in matches]
        return "## Past Context\n\n" + "\n".join(lines)

    async def search_sessions(
        self,
        query: str,
        *,
        limit: int = 3,
    ) -> list[SessionSummary]:
        matches = await self.query_episodes(query, limit=50)
        sessions: dict[str, list[Episode]] = {}
        for m in matches:
            sessions.setdefault(m.episode.session_id, []).append(m.episode)
        result = []
        for sid, eps in list(sessions.items())[:limit]:
            result.append(
                SessionSummary(
                    session_id=sid,
                    summary="; ".join(e.summary for e in eps),
                    episode_count=len(eps),
                    last_active=max(e.timestamp for e in eps),
                    tags=[t for e in eps for t in e.tags][:5],
                )
            )
        return result

    def inject_shared_context(self, context: SharedContext) -> None:
        self._shared = context

    def get_shared_context(self) -> SharedContext | None:
        return self._shared


def _make_episode(
    episode_id: str = "ep-1",
    session_id: str = "sess-1",
    summary: str = "wrote tests",
    task_description: str = "write tests",
    tools_used: list[str] | None = None,
    outcome: Outcome = Outcome.SUCCESS,
    tags: list[str] | None = None,
) -> Episode:
    return Episode(
        episode_id=episode_id,
        session_id=session_id,
        timestamp=datetime.now(UTC),
        summary=summary,
        task_description=task_description,
        tools_used=tools_used or [],
        outcome=outcome,
        tags=tags or ["general"],
    )


class TestMemoryPortInterface:
    """Verify the contract is fulfilled by InMemoryMemory."""

    async def test_record_and_query(self) -> None:
        mem = InMemoryMemory()
        ep = _make_episode(summary="fixed the CI pipeline")
        await mem.record_episode(ep)

        results = await mem.query_episodes("CI pipeline")
        assert len(results) == 1
        assert results[0].episode.episode_id == ep.episode_id

    async def test_query_no_match(self) -> None:
        mem = InMemoryMemory()
        await mem.record_episode(_make_episode(summary="deployed to prod"))
        results = await mem.query_episodes("testing framework")
        assert results == []

    async def test_query_limit(self) -> None:
        mem = InMemoryMemory()
        for i in range(5):
            await mem.record_episode(_make_episode(episode_id=f"ep-{i}", summary="python tests"))
        results = await mem.query_episodes("python tests", limit=3)
        assert len(results) <= 3

    async def test_prefetch_returns_empty_when_no_match(self) -> None:
        mem = InMemoryMemory()
        result = await mem.prefetch("docker deployment")
        assert result == ""

    async def test_prefetch_returns_context_block(self) -> None:
        mem = InMemoryMemory()
        await mem.record_episode(_make_episode(summary="ran pytest suite"))
        result = await mem.prefetch("pytest")
        assert "Past Context" in result
        assert "ran pytest suite" in result

    async def test_search_sessions_groups_by_session(self) -> None:
        mem = InMemoryMemory()
        await mem.record_episode(
            _make_episode(episode_id="e1", session_id="s1", summary="git commit message")
        )
        await mem.record_episode(
            _make_episode(episode_id="e2", session_id="s1", summary="git push to remote")
        )
        await mem.record_episode(
            _make_episode(episode_id="e3", session_id="s2", summary="git rebase main")
        )

        summaries = await mem.search_sessions("git")
        session_ids = {s.session_id for s in summaries}
        assert "s1" in session_ids
        assert "s2" in session_ids
        # s1 has 2 episodes
        s1 = next(s for s in summaries if s.session_id == "s1")
        assert s1.episode_count == 2

    async def test_inject_and_get_shared_context(self) -> None:
        mem = InMemoryMemory()
        assert mem.get_shared_context() is None
        ctx = SharedContext(data={"region": "sköll"})
        mem.inject_shared_context(ctx)
        retrieved = mem.get_shared_context()
        assert retrieved is not None
        assert retrieved.data["region"] == "sköll"

    async def test_inject_replaces_previous_context(self) -> None:
        mem = InMemoryMemory()
        mem.inject_shared_context(SharedContext(data={"a": 1}))
        mem.inject_shared_context(SharedContext(data={"b": 2}))
        ctx = mem.get_shared_context()
        assert ctx is not None
        assert "b" in ctx.data
        assert "a" not in ctx.data
