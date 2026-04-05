"""Unit tests for FileSkillRegistry — file-based skill discovery."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import pytest

from ravn.adapters.file_skill_registry import (
    _BUILTIN_SKILLS_DIR,
    FileSkillRegistry,
    _discover_from_dir,
    _filter_by_query,
    _parse_skill_file,
)
from ravn.domain.models import Episode, Outcome, Skill

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_skill(tmp_path: Path, filename: str, content: str) -> Path:
    p = tmp_path / filename
    p.write_text(content, encoding="utf-8")
    return p


def _make_episode(tools: list[str] | None = None) -> Episode:
    return Episode(
        episode_id="ep-1",
        session_id="sess-1",
        timestamp=datetime.now(UTC),
        summary="some work",
        task_description="task",
        tools_used=tools or [],
        outcome=Outcome.SUCCESS,
        tags=[],
    )


# ---------------------------------------------------------------------------
# _parse_skill_file
# ---------------------------------------------------------------------------


class TestParseSkillFile:
    def test_name_from_header(self, tmp_path: Path) -> None:
        p = _write_skill(tmp_path, "my-skill.md", "# skill: my-custom-skill\n\nDoes something.\n")
        skill = _parse_skill_file(p)
        assert skill is not None
        assert skill.name == "my-custom-skill"

    def test_name_from_filename_when_no_header(self, tmp_path: Path) -> None:
        p = _write_skill(tmp_path, "deploy-app.md", "Deploy the application to production.\n")
        skill = _parse_skill_file(p)
        assert skill is not None
        assert skill.name == "deploy-app"

    def test_description_from_first_content_line(self, tmp_path: Path) -> None:
        p = _write_skill(
            tmp_path,
            "skill.md",
            "# skill: run-tests\n\nRun all tests and fix failures.\n",
        )
        skill = _parse_skill_file(p)
        assert skill is not None
        assert skill.description == "Run all tests and fix failures."

    def test_description_skips_blank_lines(self, tmp_path: Path) -> None:
        p = _write_skill(
            tmp_path,
            "skill.md",
            "# skill: run-tests\n\n\nRun all tests.\n",
        )
        skill = _parse_skill_file(p)
        assert skill is not None
        assert skill.description == "Run all tests."

    def test_description_skips_comment_lines(self, tmp_path: Path) -> None:
        p = _write_skill(
            tmp_path,
            "skill.md",
            "# skill: run-tests\n\n## Section header\n\nActual description.\n",
        )
        skill = _parse_skill_file(p)
        assert skill is not None
        assert skill.description == "Actual description."

    def test_content_is_full_file_text(self, tmp_path: Path) -> None:
        text = "# skill: foo\n\nDescription line.\n\nMore content here.\n"
        p = _write_skill(tmp_path, "foo.md", text)
        skill = _parse_skill_file(p)
        assert skill is not None
        assert skill.content == text

    def test_returns_none_for_empty_file(self, tmp_path: Path) -> None:
        p = _write_skill(tmp_path, "empty.md", "")
        assert _parse_skill_file(p) is None

    def test_returns_none_for_whitespace_only(self, tmp_path: Path) -> None:
        p = _write_skill(tmp_path, "ws.md", "   \n\n  \n")
        assert _parse_skill_file(p) is None

    def test_returns_none_for_missing_file(self, tmp_path: Path) -> None:
        missing = tmp_path / "does-not-exist.md"
        assert _parse_skill_file(missing) is None

    def test_skill_id_is_valid_uuid(self, tmp_path: Path) -> None:
        p = _write_skill(tmp_path, "skill.md", "# skill: foo\n\nDoes something.\n")
        skill = _parse_skill_file(p)
        assert skill is not None
        UUID(skill.skill_id)  # raises ValueError if invalid

    def test_created_at_is_aware_utc(self, tmp_path: Path) -> None:
        p = _write_skill(tmp_path, "skill.md", "# skill: foo\n\nDoes something.\n")
        skill = _parse_skill_file(p)
        assert skill is not None
        assert skill.created_at.tzinfo is not None

    def test_requires_tools_empty_by_default(self, tmp_path: Path) -> None:
        p = _write_skill(tmp_path, "skill.md", "# skill: foo\n\nDesc.\n")
        skill = _parse_skill_file(p)
        assert skill is not None
        assert skill.requires_tools == []

    def test_fallback_description_when_no_content_lines(self, tmp_path: Path) -> None:
        p = _write_skill(tmp_path, "my-thing.md", "# skill: my-thing\n\n## Header only\n")
        skill = _parse_skill_file(p)
        assert skill is not None
        assert "my-thing" in skill.description

    def test_header_case_insensitive(self, tmp_path: Path) -> None:
        p = _write_skill(tmp_path, "skill.md", "# SKILL: upper-name\n\nDesc.\n")
        skill = _parse_skill_file(p)
        assert skill is not None
        assert skill.name == "upper-name"


# ---------------------------------------------------------------------------
# _discover_from_dir
# ---------------------------------------------------------------------------


class TestDiscoverFromDir:
    def test_returns_empty_for_missing_dir(self, tmp_path: Path) -> None:
        result = _discover_from_dir(tmp_path / "nonexistent")
        assert result == {}

    def test_returns_empty_for_empty_dir(self, tmp_path: Path) -> None:
        skills_dir = tmp_path / "skills"
        skills_dir.mkdir()
        result = _discover_from_dir(skills_dir)
        assert result == {}

    def test_discovers_single_skill(self, tmp_path: Path) -> None:
        d = tmp_path / "skills"
        d.mkdir()
        _write_skill(d, "fix-tests.md", "# skill: fix-tests\n\nFix failing tests.\n")
        result = _discover_from_dir(d)
        assert "fix-tests" in result
        assert result["fix-tests"].name == "fix-tests"

    def test_discovers_multiple_skills(self, tmp_path: Path) -> None:
        d = tmp_path / "skills"
        d.mkdir()
        _write_skill(d, "fix-tests.md", "# skill: fix-tests\n\nFix tests.\n")
        _write_skill(d, "write-docs.md", "# skill: write-docs\n\nWrite docs.\n")
        result = _discover_from_dir(d)
        assert "fix-tests" in result
        assert "write-docs" in result

    def test_ignores_non_md_files(self, tmp_path: Path) -> None:
        d = tmp_path / "skills"
        d.mkdir()
        (d / "not-a-skill.txt").write_text("hello", encoding="utf-8")
        _write_skill(d, "real-skill.md", "# skill: real-skill\n\nA skill.\n")
        result = _discover_from_dir(d)
        assert len(result) == 1
        assert "real-skill" in result

    def test_key_is_lowercase_name(self, tmp_path: Path) -> None:
        d = tmp_path / "skills"
        d.mkdir()
        _write_skill(d, "My-Skill.md", "# skill: My-Skill\n\nA skill.\n")
        result = _discover_from_dir(d)
        assert "my-skill" in result


# ---------------------------------------------------------------------------
# _filter_by_query
# ---------------------------------------------------------------------------


class TestFilterByQuery:
    def _make_skill(self, name: str, description: str, content: str = "") -> Skill:
        return Skill(
            skill_id="id-1",
            name=name,
            description=description,
            content=content or f"# skill: {name}\n\n{description}\n",
            requires_tools=[],
            fallback_for_tools=[],
            source_episodes=[],
            created_at=datetime.now(UTC),
        )

    def test_matches_name(self) -> None:
        skills = [self._make_skill("fix-tests", "Fix failing tests")]
        result = _filter_by_query(skills, "fix")
        assert len(result) == 1

    def test_matches_description(self) -> None:
        skills = [self._make_skill("skill-a", "Run the deployment pipeline")]
        result = _filter_by_query(skills, "deployment")
        assert len(result) == 1

    def test_matches_content(self) -> None:
        skills = [
            self._make_skill(
                "skill-a", "Something", content="# skill: skill-a\n\nkubernetes stuff\n"
            )
        ]
        result = _filter_by_query(skills, "kubernetes")
        assert len(result) == 1

    def test_case_insensitive(self) -> None:
        skills = [self._make_skill("Fix-Tests", "Fix failing tests")]
        result = _filter_by_query(skills, "FIX")
        assert len(result) == 1

    def test_no_match_returns_empty(self) -> None:
        skills = [self._make_skill("fix-tests", "Fix failing tests")]
        result = _filter_by_query(skills, "deploy")
        assert result == []

    def test_multiple_skills_partial_match(self) -> None:
        skills = [
            self._make_skill("fix-tests", "Fix failing tests"),
            self._make_skill("write-docs", "Write documentation"),
        ]
        result = _filter_by_query(skills, "fix")
        assert len(result) == 1
        assert result[0].name == "fix-tests"


# ---------------------------------------------------------------------------
# FileSkillRegistry — record_episode (no-op)
# ---------------------------------------------------------------------------


class TestFileSkillRegistryRecordEpisode:
    @pytest.mark.asyncio
    async def test_record_episode_returns_none(self, tmp_path: Path) -> None:
        registry = FileSkillRegistry(skill_dirs=[], include_builtin=False)
        result = await registry.record_episode(_make_episode())
        assert result is None


# ---------------------------------------------------------------------------
# FileSkillRegistry — list_skills
# ---------------------------------------------------------------------------


class TestFileSkillRegistryListSkills:
    @pytest.mark.asyncio
    async def test_returns_empty_when_no_dirs(self) -> None:
        registry = FileSkillRegistry(skill_dirs=[], include_builtin=False)
        skills = await registry.list_skills()
        assert skills == []

    @pytest.mark.asyncio
    async def test_discovers_skills_from_custom_dir(self, tmp_path: Path) -> None:
        d = tmp_path / "skills"
        d.mkdir()
        _write_skill(d, "fix-tests.md", "# skill: fix-tests\n\nFix failing tests.\n")
        registry = FileSkillRegistry(skill_dirs=[str(d)], include_builtin=False)
        skills = await registry.list_skills()
        assert len(skills) == 1
        assert skills[0].name == "fix-tests"

    @pytest.mark.asyncio
    async def test_skills_sorted_alphabetically(self, tmp_path: Path) -> None:
        d = tmp_path / "skills"
        d.mkdir()
        _write_skill(d, "zz-last.md", "# skill: zz-last\n\nLast.\n")
        _write_skill(d, "aa-first.md", "# skill: aa-first\n\nFirst.\n")
        registry = FileSkillRegistry(skill_dirs=[str(d)], include_builtin=False)
        skills = await registry.list_skills()
        assert skills[0].name == "aa-first"
        assert skills[1].name == "zz-last"

    @pytest.mark.asyncio
    async def test_higher_priority_dir_wins_on_conflict(self, tmp_path: Path) -> None:
        high = tmp_path / "high"
        high.mkdir()
        low = tmp_path / "low"
        low.mkdir()
        _write_skill(high, "skill.md", "# skill: my-skill\n\nHigh priority version.\n")
        _write_skill(low, "skill.md", "# skill: my-skill\n\nLow priority version.\n")
        registry = FileSkillRegistry(skill_dirs=[str(high), str(low)], include_builtin=False)
        skills = await registry.list_skills()
        assert len(skills) == 1
        assert "High priority version" in skills[0].description

    @pytest.mark.asyncio
    async def test_missing_dir_silently_skipped(self, tmp_path: Path) -> None:
        missing = tmp_path / "nonexistent"
        registry = FileSkillRegistry(skill_dirs=[str(missing)], include_builtin=False)
        skills = await registry.list_skills()
        assert skills == []

    @pytest.mark.asyncio
    async def test_filter_by_query(self, tmp_path: Path) -> None:
        d = tmp_path / "skills"
        d.mkdir()
        _write_skill(d, "fix-tests.md", "# skill: fix-tests\n\nFix failing tests.\n")
        _write_skill(d, "write-docs.md", "# skill: write-docs\n\nWrite docs.\n")
        registry = FileSkillRegistry(skill_dirs=[str(d)], include_builtin=False)
        skills = await registry.list_skills(query="fix")
        assert len(skills) == 1
        assert skills[0].name == "fix-tests"

    @pytest.mark.asyncio
    async def test_includes_builtin_skills(self) -> None:
        registry = FileSkillRegistry(skill_dirs=[], include_builtin=True)
        skills = await registry.list_skills()
        names = [s.name for s in skills]
        assert any("fix-tests" in n or "fix" in n for n in names)

    @pytest.mark.asyncio
    async def test_excludes_builtin_when_disabled(self) -> None:
        registry = FileSkillRegistry(skill_dirs=[], include_builtin=False)
        skills = await registry.list_skills()
        assert skills == []

    @pytest.mark.asyncio
    async def test_builtin_dir_exists(self) -> None:
        assert _BUILTIN_SKILLS_DIR.is_dir(), f"Built-in skills dir missing: {_BUILTIN_SKILLS_DIR}"

    @pytest.mark.asyncio
    async def test_builtin_skills_have_required_names(self) -> None:
        registry = FileSkillRegistry(skill_dirs=[], include_builtin=True)
        skills = await registry.list_skills()
        names = {s.name for s in skills}
        for expected in ("fix-tests", "write-docs", "code-review", "refactor"):
            assert expected in names, f"Built-in skill {expected!r} not found"


# ---------------------------------------------------------------------------
# FileSkillRegistry — get_skill
# ---------------------------------------------------------------------------


class TestFileSkillRegistryGetSkill:
    @pytest.mark.asyncio
    async def test_returns_skill_by_name(self, tmp_path: Path) -> None:
        d = tmp_path / "skills"
        d.mkdir()
        _write_skill(d, "fix-tests.md", "# skill: fix-tests\n\nFix failing tests.\n")
        registry = FileSkillRegistry(skill_dirs=[str(d)], include_builtin=False)
        skill = await registry.get_skill("fix-tests")
        assert skill is not None
        assert skill.name == "fix-tests"

    @pytest.mark.asyncio
    async def test_returns_none_for_unknown_name(self, tmp_path: Path) -> None:
        registry = FileSkillRegistry(skill_dirs=[], include_builtin=False)
        result = await registry.get_skill("does-not-exist")
        assert result is None

    @pytest.mark.asyncio
    async def test_case_insensitive_lookup(self, tmp_path: Path) -> None:
        d = tmp_path / "skills"
        d.mkdir()
        _write_skill(d, "Fix-Tests.md", "# skill: Fix-Tests\n\nFix tests.\n")
        registry = FileSkillRegistry(skill_dirs=[str(d)], include_builtin=False)
        skill = await registry.get_skill("fix-tests")
        assert skill is not None

    @pytest.mark.asyncio
    async def test_high_priority_dir_returned_first(self, tmp_path: Path) -> None:
        high = tmp_path / "high"
        high.mkdir()
        low = tmp_path / "low"
        low.mkdir()
        _write_skill(high, "skill.md", "# skill: my-skill\n\nHigh priority.\n")
        _write_skill(low, "skill.md", "# skill: my-skill\n\nLow priority.\n")
        registry = FileSkillRegistry(skill_dirs=[str(high), str(low)], include_builtin=False)
        skill = await registry.get_skill("my-skill")
        assert skill is not None
        assert "High priority" in skill.description


# ---------------------------------------------------------------------------
# FileSkillRegistry — record_skill
# ---------------------------------------------------------------------------


class TestFileSkillRegistryRecordSkill:
    @pytest.mark.asyncio
    async def test_record_skill_writes_file(self, tmp_path: Path) -> None:
        dest_dir = tmp_path / ".ravn" / "skills"
        registry = FileSkillRegistry.__new__(FileSkillRegistry)
        registry._include_builtin = False
        registry._cwd = tmp_path
        registry._skill_dirs = None

        skill = Skill(
            skill_id="id-1",
            name="my-skill",
            description="Does something.",
            content="# skill: my-skill\n\nDoes something.\n",
            requires_tools=[],
            fallback_for_tools=[],
            source_episodes=[],
            created_at=datetime.now(UTC),
        )

        registry._write_skill_file(dest_dir, skill)
        written = dest_dir / "my-skill.md"
        assert written.exists()
        assert "my-skill" in written.read_text(encoding="utf-8")

    @pytest.mark.asyncio
    async def test_record_skill_skips_empty_content(self, tmp_path: Path) -> None:
        registry = FileSkillRegistry(skill_dirs=[], include_builtin=False)
        skill = Skill(
            skill_id="id-1",
            name="empty",
            description="",
            content="   ",
            requires_tools=[],
            fallback_for_tools=[],
            source_episodes=[],
            created_at=datetime.now(UTC),
        )
        # Should not raise even though content is empty.
        await registry.record_skill(skill)

    @pytest.mark.asyncio
    async def test_write_sanitises_skill_name(self, tmp_path: Path) -> None:
        dest_dir = tmp_path / "skills"
        registry = FileSkillRegistry(skill_dirs=[], include_builtin=False)

        skill = Skill(
            skill_id="id-1",
            name="My Skill: v1.0",
            description="Desc.",
            content="# skill: My Skill\n\nDesc.\n",
            requires_tools=[],
            fallback_for_tools=[],
            source_episodes=[],
            created_at=datetime.now(UTC),
        )
        registry._write_skill_file(dest_dir, skill)
        files = list(dest_dir.glob("*.md"))
        assert len(files) == 1
        # Name should be sanitised (no spaces or colons)
        assert " " not in files[0].name
        assert ":" not in files[0].name


# ---------------------------------------------------------------------------
# FileSkillRegistry — default three-layer discovery
# ---------------------------------------------------------------------------


class TestFileSkillRegistryDefaultDiscovery:
    @pytest.mark.asyncio
    async def test_default_dirs_include_cwd_ravn_skills(self, tmp_path: Path) -> None:
        """Project-local .ravn/skills/ must be in default search paths."""
        local_skills = tmp_path / ".ravn" / "skills"
        local_skills.mkdir(parents=True)
        _write_skill(local_skills, "local-skill.md", "# skill: local-skill\n\nLocal.\n")

        registry = FileSkillRegistry(include_builtin=False, cwd=tmp_path)
        skills = await registry.list_skills()
        names = {s.name for s in skills}
        assert "local-skill" in names

    @pytest.mark.asyncio
    async def test_project_local_overrides_builtin(self, tmp_path: Path) -> None:
        """Project-local skill with same name as built-in must take priority."""
        local_skills = tmp_path / ".ravn" / "skills"
        local_skills.mkdir(parents=True)
        _write_skill(
            local_skills,
            "fix-tests.md",
            "# skill: fix-tests\n\nProject-local override.\n",
        )

        registry = FileSkillRegistry(include_builtin=True, cwd=tmp_path)
        skill = await registry.get_skill("fix-tests")
        assert skill is not None
        assert "Project-local override" in skill.description
