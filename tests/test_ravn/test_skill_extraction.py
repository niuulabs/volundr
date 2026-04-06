"""Tests for SqliteSkillAdapter skill extraction and storage."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest

from ravn.adapters.skill.sqlite import (
    SqliteSkillAdapter,
    _dominant_tool,
    _LRUCache,
    _pattern_key,
    _synthesise_skill,
)
from ravn.domain.models import Episode, Outcome, Skill

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ep(
    episode_id: str | None = None,
    summary: str = "completed successfully",
    task_description: str = "run a task",
    tools_used: list[str] | None = None,
    outcome: Outcome = Outcome.SUCCESS,
    tags: list[str] | None = None,
) -> Episode:
    return Episode(
        episode_id=episode_id or str(uuid4()),
        session_id="sess-1",
        timestamp=datetime.now(UTC),
        summary=summary,
        task_description=task_description,
        tools_used=tools_used or ["bash"],
        outcome=outcome,
        tags=tags or [],
    )


def _skill(name: str = "Test skill") -> Skill:
    return Skill(
        skill_id=str(uuid4()),
        name=name,
        description="A test skill",
        content="---\nname: Test skill\n---\n\nContent here.",
        requires_tools=["bash"],
        fallback_for_tools=[],
        source_episodes=["ep-1"],
        created_at=datetime.now(UTC),
        success_count=3,
    )


@pytest.fixture
async def skill_adapter(tmp_path: Path) -> SqliteSkillAdapter:
    adapter = SqliteSkillAdapter(
        path=str(tmp_path / "skills.db"),
        suggestion_threshold=3,
        cache_max_entries=16,
    )
    await adapter.initialize()
    return adapter


# ---------------------------------------------------------------------------
# Unit helpers
# ---------------------------------------------------------------------------


class TestDominantTool:
    def test_single_tool(self) -> None:
        assert _dominant_tool(["bash"]) == "bash"

    def test_most_frequent_wins(self) -> None:
        assert _dominant_tool(["bash", "git", "bash", "bash"]) == "bash"

    def test_empty_returns_none(self) -> None:
        assert _dominant_tool([]) is None

    def test_tie_returns_one_of_them(self) -> None:
        result = _dominant_tool(["a", "b"])
        assert result in ("a", "b")


class TestPatternKey:
    def test_returns_tool_key(self) -> None:
        ep = _ep(tools_used=["bash"])
        assert _pattern_key(ep) == "tool:bash"

    def test_no_tools_returns_none(self) -> None:
        # Create episode directly with empty tools to bypass the helper default.
        ep = Episode(
            episode_id="ep-notools",
            session_id="sess-1",
            timestamp=datetime.now(UTC),
            summary="completed",
            task_description="task",
            tools_used=[],
            outcome=Outcome.SUCCESS,
            tags=[],
        )
        assert _pattern_key(ep) is None


class TestSynthesiseSkill:
    def test_returns_skill_object(self) -> None:
        episodes = [_ep() for _ in range(3)]
        skill = _synthesise_skill("tool:bash", episodes)
        assert isinstance(skill, Skill)

    def test_skill_content_has_frontmatter(self) -> None:
        episodes = [_ep() for _ in range(3)]
        skill = _synthesise_skill("tool:bash", episodes)
        assert "---" in skill.content
        assert "requires_tools" in skill.content

    def test_skill_contains_tool(self) -> None:
        episodes = [_ep(tools_used=["git"]) for _ in range(3)]
        skill = _synthesise_skill("tool:git", episodes)
        assert "git" in skill.requires_tools

    def test_source_episodes_populated(self) -> None:
        eps = [_ep(episode_id=f"ep-{i}") for i in range(3)]
        skill = _synthesise_skill("tool:bash", eps)
        assert len(skill.source_episodes) == 3

    def test_success_count_matches_episodes(self) -> None:
        eps = [_ep() for _ in range(5)]
        skill = _synthesise_skill("tool:bash", eps)
        assert skill.success_count == 5


# ---------------------------------------------------------------------------
# LRUCache
# ---------------------------------------------------------------------------


class TestLRUCache:
    def test_put_and_get(self) -> None:
        cache = _LRUCache(max_entries=4)
        s = _skill()
        cache.put("key1", s)
        assert cache.get("key1") is s

    def test_get_missing_returns_none(self) -> None:
        cache = _LRUCache(max_entries=4)
        assert cache.get("missing") is None

    def test_evicts_least_recently_used(self) -> None:
        cache = _LRUCache(max_entries=2)
        s1, s2, s3 = _skill("s1"), _skill("s2"), _skill("s3")
        cache.put("k1", s1)
        cache.put("k2", s2)
        cache.put("k3", s3)  # k1 should be evicted
        assert cache.get("k1") is None
        assert cache.get("k2") is s2
        assert cache.get("k3") is s3

    def test_access_updates_lru_order(self) -> None:
        cache = _LRUCache(max_entries=2)
        s1, s2, s3 = _skill("s1"), _skill("s2"), _skill("s3")
        cache.put("k1", s1)
        cache.put("k2", s2)
        cache.get("k1")  # access k1 — makes k2 LRU
        cache.put("k3", s3)  # k2 should be evicted, not k1
        assert cache.get("k1") is s1
        assert cache.get("k2") is None

    def test_invalidate(self) -> None:
        cache = _LRUCache(max_entries=4)
        s = _skill()
        cache.put("k", s)
        cache.invalidate("k")
        assert cache.get("k") is None

    def test_invalidate_missing_key_is_safe(self) -> None:
        cache = _LRUCache(max_entries=4)
        cache.invalidate("nonexistent")  # should not raise


# ---------------------------------------------------------------------------
# SqliteSkillAdapter integration
# ---------------------------------------------------------------------------


class TestSqliteSkillAdapterInit:
    async def test_creates_db_file(self, tmp_path: Path) -> None:
        adapter = SqliteSkillAdapter(path=str(tmp_path / "sub" / "skills.db"))
        await adapter.initialize()
        assert (tmp_path / "sub" / "skills.db").exists()

    async def test_idempotent_init(self, skill_adapter: SqliteSkillAdapter) -> None:
        await skill_adapter.initialize()


class TestRecordSkillDirect:
    async def test_record_and_list(self, skill_adapter: SqliteSkillAdapter) -> None:
        s = _skill("My custom skill")
        await skill_adapter.record_skill(s)
        skills = await skill_adapter.list_skills()
        assert any(sk.name == "My custom skill" for sk in skills)

    async def test_record_multiple(self, skill_adapter: SqliteSkillAdapter) -> None:
        for i in range(3):
            await skill_adapter.record_skill(_skill(f"Skill {i}"))
        skills = await skill_adapter.list_skills()
        assert len(skills) >= 3

    async def test_record_updates_lru_cache(self, skill_adapter: SqliteSkillAdapter) -> None:
        s = Skill(
            skill_id="s1",
            name="bash skill",
            description="bash",
            content="---\n---",
            requires_tools=["bash"],
            fallback_for_tools=[],
            source_episodes=[],
            created_at=datetime.now(UTC),
        )
        await skill_adapter.record_skill(s)
        cached = skill_adapter._cache.get("tool:bash")
        assert cached is not None
        assert cached.skill_id == "s1"


class TestListSkills:
    async def test_empty_returns_empty(self, skill_adapter: SqliteSkillAdapter) -> None:
        assert await skill_adapter.list_skills() == []

    async def test_query_filter(self, skill_adapter: SqliteSkillAdapter) -> None:
        await skill_adapter.record_skill(_skill("bash helper"))
        await skill_adapter.record_skill(_skill("git workflow"))
        bash_results = await skill_adapter.list_skills("bash")
        assert all("bash" in s.name.lower() for s in bash_results)

    async def test_no_query_returns_all(self, skill_adapter: SqliteSkillAdapter) -> None:
        for i in range(3):
            await skill_adapter.record_skill(_skill(f"skill {i}"))
        all_skills = await skill_adapter.list_skills()
        assert len(all_skills) == 3


class TestAutoDiscovery:
    async def test_no_skill_for_failure(self, skill_adapter: SqliteSkillAdapter) -> None:
        ep = _ep(outcome=Outcome.FAILURE)
        result = await skill_adapter.record_episode(ep)
        assert result is None

    async def test_no_skill_below_threshold(self, skill_adapter: SqliteSkillAdapter) -> None:
        """Below threshold → no skill suggested."""
        result = await skill_adapter.record_episode(_ep(outcome=Outcome.SUCCESS))
        assert result is None

    async def test_no_skill_without_tools(self, skill_adapter: SqliteSkillAdapter) -> None:
        ep = Episode(
            episode_id="ep-notools2",
            session_id="sess",
            timestamp=datetime.now(UTC),
            summary="done",
            task_description="task",
            tools_used=[],
            outcome=Outcome.SUCCESS,
            tags=[],
        )
        result = await skill_adapter.record_episode(ep)
        assert result is None

    async def test_manifest_written_on_record(self, skill_adapter: SqliteSkillAdapter) -> None:
        s = _skill("manifest test skill")
        await skill_adapter.record_skill(s)
        manifest_path = skill_adapter._manifest_path
        assert manifest_path.exists()
        import json

        data = json.loads(manifest_path.read_text())
        assert any(entry["name"] == "manifest test skill" for entry in data)

    async def test_partial_outcome_skipped(self, skill_adapter: SqliteSkillAdapter) -> None:
        ep = _ep(outcome=Outcome.PARTIAL)
        result = await skill_adapter.record_episode(ep)
        assert result is None

    async def test_skill_suggested_at_threshold(self, skill_adapter: SqliteSkillAdapter) -> None:
        """Record 3 successful 'git' episodes → skill should be suggested."""
        for i in range(3):
            ep = _ep(
                episode_id=f"git-ep-{i}",
                tools_used=["git"],
                outcome=Outcome.SUCCESS,
                summary=f"git commit {i}",
                task_description=f"commit task {i}",
            )
            result = await skill_adapter.record_episode(ep)

        # The third episode should trigger skill creation.
        assert result is not None
        assert isinstance(result, Skill)
        assert "git" in result.requires_tools

    async def test_skill_not_duplicated_on_further_episodes(
        self, skill_adapter: SqliteSkillAdapter
    ) -> None:
        """After skill is created, further episodes with same pattern → None."""
        for i in range(3):
            ep = _ep(
                episode_id=f"bash-ep-{i}",
                tools_used=["bash"],
                outcome=Outcome.SUCCESS,
            )
            await skill_adapter.record_episode(ep)

        # Fourth episode should not create a second skill.
        ep4 = _ep(episode_id="bash-ep-4", tools_used=["bash"], outcome=Outcome.SUCCESS)
        result = await skill_adapter.record_episode(ep4)
        assert result is None

        # Still only one skill for bash.
        skills = await skill_adapter.list_skills("bash")
        bash_skills = [s for s in skills if "bash" in s.requires_tools]
        assert len(bash_skills) == 1

    async def test_skill_already_exists_returns_none(
        self, skill_adapter: SqliteSkillAdapter
    ) -> None:
        """Pre-existing skill for a pattern prevents duplicate creation."""
        existing = Skill(
            skill_id="pre-existing",
            name="git workflow",
            description="git",
            content="---\n---",
            requires_tools=["git"],
            fallback_for_tools=[],
            source_episodes=[],
            created_at=datetime.now(UTC),
        )
        await skill_adapter.record_skill(existing)

        # Now record enough episodes to normally trigger skill creation.
        for i in range(3):
            ep = _ep(
                episode_id=f"git2-ep-{i}",
                tools_used=["git"],
                outcome=Outcome.SUCCESS,
            )
            result = await skill_adapter.record_episode(ep)
        # Should be None since skill already exists.
        assert result is None

    async def test_pattern_tracking_persists(self, tmp_path: Path) -> None:
        """Patterns are stored in DB so counts survive object recreation."""
        path = str(tmp_path / "skills.db")
        adapter1 = SqliteSkillAdapter(path=path, suggestion_threshold=3)
        await adapter1.initialize()

        # Record 2 episodes — not yet at threshold.
        for i in range(2):
            ep = _ep(episode_id=f"persist-{i}", tools_used=["grep"], outcome=Outcome.SUCCESS)
            await adapter1.record_episode(ep)

        # New adapter instance — counts should still be in DB.
        adapter2 = SqliteSkillAdapter(path=path, suggestion_threshold=3)
        await adapter2.initialize()
        ep3 = _ep(episode_id="persist-2", tools_used=["grep"], outcome=Outcome.SUCCESS)
        result = await adapter2.record_episode(ep3)
        assert result is not None
        assert "grep" in result.requires_tools
