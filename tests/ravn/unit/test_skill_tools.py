"""Unit tests for SkillListTool and SkillRunTool."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from ravn.adapters.tools.skill_tools import (
    _SKILL_PERMISSION,
    SkillListTool,
    SkillRunTool,
)
from ravn.domain.models import Skill
from ravn.ports.skill import SkillPort

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_skill(
    name: str = "fix-tests",
    description: str = "Fix failing tests.",
    content: str = "",
) -> Skill:
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


class StubSkillPort(SkillPort):
    """Configurable in-memory stub for SkillPort."""

    def __init__(
        self,
        skills: list[Skill] | None = None,
        raise_on_list: Exception | None = None,
        raise_on_get: Exception | None = None,
    ) -> None:
        self._skills = skills or []
        self._raise_on_list = raise_on_list
        self._raise_on_get = raise_on_get

    async def record_episode(self, episode) -> Skill | None:
        return None

    async def list_skills(self, query: str | None = None) -> list[Skill]:
        if self._raise_on_list is not None:
            raise self._raise_on_list
        if query:
            q = query.lower()
            return [s for s in self._skills if q in s.name.lower() or q in s.description.lower()]
        return list(self._skills)

    async def record_skill(self, skill: Skill) -> None:
        self._skills.append(skill)

    async def get_skill(self, name: str) -> Skill | None:
        if self._raise_on_get is not None:
            raise self._raise_on_get
        name_lower = name.lower()
        for s in self._skills:
            if s.name.lower() == name_lower:
                return s
        return None


# ---------------------------------------------------------------------------
# SkillListTool — metadata
# ---------------------------------------------------------------------------


class TestSkillListToolMetadata:
    def test_name(self) -> None:
        tool = SkillListTool(StubSkillPort())
        assert tool.name == "skill_list"

    def test_description_not_empty(self) -> None:
        tool = SkillListTool(StubSkillPort())
        assert len(tool.description) > 20

    def test_required_permission(self) -> None:
        tool = SkillListTool(StubSkillPort())
        assert tool.required_permission == _SKILL_PERMISSION

    def test_permission_has_no_blocked_keywords(self) -> None:
        blocked = ("write", "delete", "execute", "bash", "shell")
        for kw in blocked:
            assert kw not in _SKILL_PERMISSION

    def test_input_schema_type(self) -> None:
        tool = SkillListTool(StubSkillPort())
        assert tool.input_schema["type"] == "object"

    def test_input_schema_has_optional_query(self) -> None:
        tool = SkillListTool(StubSkillPort())
        assert "query" in tool.input_schema["properties"]

    def test_query_not_required(self) -> None:
        tool = SkillListTool(StubSkillPort())
        assert "required" not in tool.input_schema or "query" not in tool.input_schema.get(
            "required", []
        )

    def test_parallelisable_default(self) -> None:
        tool = SkillListTool(StubSkillPort())
        assert tool.parallelisable is True

    def test_to_api_dict_has_required_keys(self) -> None:
        tool = SkillListTool(StubSkillPort())
        d = tool.to_api_dict()
        assert {"name", "description", "input_schema"} <= d.keys()


# ---------------------------------------------------------------------------
# SkillListTool — execute
# ---------------------------------------------------------------------------


class TestSkillListToolExecute:
    @pytest.mark.asyncio
    async def test_empty_skills_returns_no_skills_message(self) -> None:
        tool = SkillListTool(StubSkillPort(skills=[]))
        result = await tool.execute({})
        assert not result.is_error
        assert "No skills" in result.content

    @pytest.mark.asyncio
    async def test_empty_skills_with_no_query_suggests_creating_skills(self) -> None:
        tool = SkillListTool(StubSkillPort(skills=[]))
        result = await tool.execute({})
        assert ".ravn/skills/" in result.content

    @pytest.mark.asyncio
    async def test_lists_skills_with_names(self) -> None:
        skills = [
            _make_skill("fix-tests", "Fix failing tests."),
            _make_skill("write-docs", "Write documentation."),
        ]
        tool = SkillListTool(StubSkillPort(skills=skills))
        result = await tool.execute({})
        assert not result.is_error
        assert "fix-tests" in result.content
        assert "write-docs" in result.content

    @pytest.mark.asyncio
    async def test_lists_skills_with_descriptions(self) -> None:
        skills = [_make_skill("fix-tests", "Run and fix all tests.")]
        tool = SkillListTool(StubSkillPort(skills=skills))
        result = await tool.execute({})
        assert "Run and fix all tests." in result.content

    @pytest.mark.asyncio
    async def test_shows_skill_count(self) -> None:
        skills = [_make_skill("s1", "d1"), _make_skill("s2", "d2"), _make_skill("s3", "d3")]
        tool = SkillListTool(StubSkillPort(skills=skills))
        result = await tool.execute({})
        assert "3" in result.content

    @pytest.mark.asyncio
    async def test_filter_by_query_no_match(self) -> None:
        skills = [_make_skill("fix-tests", "Fix tests.")]
        tool = SkillListTool(StubSkillPort(skills=skills))
        result = await tool.execute({"query": "deploy"})
        assert not result.is_error
        assert "No skills found" in result.content
        assert "deploy" in result.content

    @pytest.mark.asyncio
    async def test_filter_by_query_with_match(self) -> None:
        skills = [
            _make_skill("fix-tests", "Fix tests."),
            _make_skill("write-docs", "Write docs."),
        ]
        tool = SkillListTool(StubSkillPort(skills=skills))
        result = await tool.execute({"query": "fix"})
        assert not result.is_error
        assert "fix-tests" in result.content
        assert "write-docs" not in result.content

    @pytest.mark.asyncio
    async def test_empty_query_string_treated_as_no_filter(self) -> None:
        skills = [_make_skill("fix-tests", "Fix tests.")]
        tool = SkillListTool(StubSkillPort(skills=skills))
        result = await tool.execute({"query": ""})
        assert "fix-tests" in result.content

    @pytest.mark.asyncio
    async def test_list_skills_error_returns_error_result(self) -> None:
        tool = SkillListTool(StubSkillPort(raise_on_list=RuntimeError("disk error")))
        result = await tool.execute({})
        assert result.is_error
        assert "Failed to list skills" in result.content

    @pytest.mark.asyncio
    async def test_passes_query_to_skill_port(self) -> None:
        port = AsyncMock(spec=SkillPort)
        port.list_skills = AsyncMock(return_value=[])
        tool = SkillListTool(port)
        await tool.execute({"query": "fix"})
        port.list_skills.assert_called_once_with(query="fix")

    @pytest.mark.asyncio
    async def test_passes_none_query_when_no_query_given(self) -> None:
        port = AsyncMock(spec=SkillPort)
        port.list_skills = AsyncMock(return_value=[])
        tool = SkillListTool(port)
        await tool.execute({})
        port.list_skills.assert_called_once_with(query=None)


# ---------------------------------------------------------------------------
# SkillRunTool — metadata
# ---------------------------------------------------------------------------


class TestSkillRunToolMetadata:
    def test_name(self) -> None:
        tool = SkillRunTool(StubSkillPort())
        assert tool.name == "skill_run"

    def test_description_not_empty(self) -> None:
        tool = SkillRunTool(StubSkillPort())
        assert len(tool.description) > 20

    def test_required_permission(self) -> None:
        tool = SkillRunTool(StubSkillPort())
        assert tool.required_permission == _SKILL_PERMISSION

    def test_not_parallelisable(self) -> None:
        tool = SkillRunTool(StubSkillPort())
        assert tool.parallelisable is False

    def test_schema_has_skill_name_required(self) -> None:
        tool = SkillRunTool(StubSkillPort())
        assert "skill_name" in tool.input_schema["properties"]
        assert "skill_name" in tool.input_schema["required"]

    def test_schema_has_optional_args(self) -> None:
        tool = SkillRunTool(StubSkillPort())
        assert "args" in tool.input_schema["properties"]

    def test_args_not_required(self) -> None:
        tool = SkillRunTool(StubSkillPort())
        required = tool.input_schema.get("required", [])
        assert "args" not in required

    def test_to_api_dict(self) -> None:
        tool = SkillRunTool(StubSkillPort())
        d = tool.to_api_dict()
        assert d["name"] == "skill_run"


# ---------------------------------------------------------------------------
# SkillRunTool — execute
# ---------------------------------------------------------------------------


class TestSkillRunToolExecute:
    @pytest.mark.asyncio
    async def test_empty_skill_name_returns_error(self) -> None:
        tool = SkillRunTool(StubSkillPort())
        result = await tool.execute({"skill_name": ""})
        assert result.is_error
        assert "empty" in result.content.lower()

    @pytest.mark.asyncio
    async def test_missing_skill_name_returns_error(self) -> None:
        tool = SkillRunTool(StubSkillPort())
        result = await tool.execute({})
        assert result.is_error

    @pytest.mark.asyncio
    async def test_whitespace_only_skill_name_returns_error(self) -> None:
        tool = SkillRunTool(StubSkillPort())
        result = await tool.execute({"skill_name": "   "})
        assert result.is_error

    @pytest.mark.asyncio
    async def test_unknown_skill_returns_error(self) -> None:
        tool = SkillRunTool(StubSkillPort(skills=[]))
        result = await tool.execute({"skill_name": "unknown-skill"})
        assert result.is_error
        assert "not found" in result.content.lower() or "unknown-skill" in result.content

    @pytest.mark.asyncio
    async def test_skill_not_found_suggests_skill_list(self) -> None:
        tool = SkillRunTool(StubSkillPort(skills=[]))
        result = await tool.execute({"skill_name": "missing"})
        assert "skill_list" in result.content

    @pytest.mark.asyncio
    async def test_returns_skill_content(self) -> None:
        content = "# skill: fix-tests\n\nRun the test suite and fix failures.\n"
        skills = [_make_skill("fix-tests", "Fix tests.", content)]
        tool = SkillRunTool(StubSkillPort(skills=skills))
        result = await tool.execute({"skill_name": "fix-tests"})
        assert not result.is_error
        assert "Run the test suite and fix failures." in result.content

    @pytest.mark.asyncio
    async def test_result_includes_skill_name_header(self) -> None:
        skills = [_make_skill("fix-tests", "Fix tests.")]
        tool = SkillRunTool(StubSkillPort(skills=skills))
        result = await tool.execute({"skill_name": "fix-tests"})
        assert "fix-tests" in result.content

    @pytest.mark.asyncio
    async def test_appends_args_when_provided(self) -> None:
        content = "# skill: fix-tests\n\nRun tests.\n"
        skills = [_make_skill("fix-tests", "Fix tests.", content)]
        tool = SkillRunTool(StubSkillPort(skills=skills))
        result = await tool.execute({"skill_name": "fix-tests", "args": "target: test_auth.py"})
        assert not result.is_error
        assert "target: test_auth.py" in result.content

    @pytest.mark.asyncio
    async def test_no_args_does_not_add_separator(self) -> None:
        content = "# skill: fix-tests\n\nRun tests.\n"
        skills = [_make_skill("fix-tests", "Fix tests.", content)]
        tool = SkillRunTool(StubSkillPort(skills=skills))
        result = await tool.execute({"skill_name": "fix-tests"})
        assert "---" not in result.content

    @pytest.mark.asyncio
    async def test_empty_args_treated_as_no_args(self) -> None:
        content = "# skill: fix-tests\n\nRun tests.\n"
        skills = [_make_skill("fix-tests", "Fix tests.", content)]
        tool = SkillRunTool(StubSkillPort(skills=skills))
        result = await tool.execute({"skill_name": "fix-tests", "args": ""})
        assert "---" not in result.content

    @pytest.mark.asyncio
    async def test_args_with_separator_when_provided(self) -> None:
        content = "# skill: fix-tests\n\nRun tests.\n"
        skills = [_make_skill("fix-tests", "Fix tests.", content)]
        tool = SkillRunTool(StubSkillPort(skills=skills))
        result = await tool.execute({"skill_name": "fix-tests", "args": "extra context"})
        assert "---" in result.content
        assert "extra context" in result.content

    @pytest.mark.asyncio
    async def test_get_skill_error_returns_error_result(self) -> None:
        tool = SkillRunTool(StubSkillPort(raise_on_get=RuntimeError("io error")))
        result = await tool.execute({"skill_name": "fix-tests"})
        assert result.is_error
        assert "Failed to load skill" in result.content

    @pytest.mark.asyncio
    async def test_calls_get_skill_with_name(self) -> None:
        port = AsyncMock(spec=SkillPort)
        port.get_skill = AsyncMock(return_value=None)
        tool = SkillRunTool(port)
        await tool.execute({"skill_name": "my-skill"})
        port.get_skill.assert_called_once_with("my-skill")

    @pytest.mark.asyncio
    async def test_skill_name_stripped_before_lookup(self) -> None:
        port = AsyncMock(spec=SkillPort)
        port.get_skill = AsyncMock(return_value=None)
        tool = SkillRunTool(port)
        await tool.execute({"skill_name": "  fix-tests  "})
        port.get_skill.assert_called_once_with("fix-tests")


# ---------------------------------------------------------------------------
# SkillPort — default get_skill (via port's default implementation)
# ---------------------------------------------------------------------------


class TestSkillPortDefaultGetSkill:
    @pytest.mark.asyncio
    async def test_default_get_skill_returns_matching_skill(self) -> None:
        skill = _make_skill("fix-tests", "Fix tests.")
        port = StubSkillPort(skills=[skill])
        result = await port.get_skill("fix-tests")
        assert result is not None
        assert result.name == "fix-tests"

    @pytest.mark.asyncio
    async def test_default_get_skill_case_insensitive(self) -> None:
        skill = _make_skill("Fix-Tests", "Fix tests.")
        port = StubSkillPort(skills=[skill])
        result = await port.get_skill("fix-tests")
        assert result is not None

    @pytest.mark.asyncio
    async def test_default_get_skill_returns_none_for_missing(self) -> None:
        port = StubSkillPort(skills=[])
        result = await port.get_skill("nonexistent")
        assert result is None
