"""Tests for the slash command dispatcher."""

from __future__ import annotations

from pathlib import Path

import pytest

from ravn.adapters.slash_commands import SlashCommandContext, handle
from ravn.domain.models import Session, TodoItem, TodoStatus

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ctx(
    *,
    session: Session | None = None,
    tools=None,
    max_iterations: int = 20,
    llm_adapter_name: str = "AnthropicAdapter",
    permission_mode: str = "allow_all",
    cwd: Path | None = None,
) -> SlashCommandContext:
    return SlashCommandContext(
        session=session or Session(),
        tools=tools or [],
        max_iterations=max_iterations,
        llm_adapter_name=llm_adapter_name,
        permission_mode=permission_mode,
        cwd=cwd,
    )


# ---------------------------------------------------------------------------
# Dispatcher routing
# ---------------------------------------------------------------------------


class TestHandleRouting:
    def test_non_slash_returns_none(self) -> None:
        assert handle("hello there", _ctx()) is None

    def test_empty_returns_none(self) -> None:
        assert handle("", _ctx()) is None

    def test_whitespace_returns_none(self) -> None:
        assert handle("   ", _ctx()) is None

    def test_unknown_command_returns_error_message(self) -> None:
        result = handle("/unknown", _ctx())
        assert result is not None
        assert "Unknown command" in result
        assert "/unknown" in result

    def test_case_insensitive(self) -> None:
        result = handle("/HELP", _ctx())
        assert result is not None
        assert "/help" in result.lower()

    def test_leading_whitespace_stripped(self) -> None:
        result = handle("  /help", _ctx())
        assert result is not None


# ---------------------------------------------------------------------------
# /help
# ---------------------------------------------------------------------------


class TestCmdHelp:
    def test_lists_all_commands(self) -> None:
        result = handle("/help", _ctx())
        assert result is not None
        all_cmds = (
            "/help",
            "/tools",
            "/memory",
            "/compact",
            "/budget",
            "/todo",
            "/status",
            "/init",
        )
        for cmd in all_cmds:
            assert cmd in result


# ---------------------------------------------------------------------------
# /tools
# ---------------------------------------------------------------------------


class TestCmdTools:
    def test_no_tools_message(self) -> None:
        result = handle("/tools", _ctx(tools=[]))
        assert result is not None
        assert "No tools" in result

    def test_lists_tool_names(self) -> None:
        from tests.ravn.fixtures.fakes import EchoTool

        result = handle("/tools", _ctx(tools=[EchoTool()]))
        assert result is not None
        assert "echo" in result

    def test_shows_permission(self) -> None:
        from tests.ravn.fixtures.fakes import EchoTool

        result = handle("/tools", _ctx(tools=[EchoTool()]))
        assert result is not None
        assert "tool:echo" in result


# ---------------------------------------------------------------------------
# /memory
# ---------------------------------------------------------------------------


class TestCmdMemory:
    def test_shows_session_id(self) -> None:
        s = Session()
        result = handle("/memory", _ctx(session=s))
        assert result is not None
        assert str(s.id) in result

    def test_shows_turn_count(self) -> None:
        s = Session()
        s.record_turn(s.total_usage)
        result = handle("/memory", _ctx(session=s))
        assert result is not None
        assert "1" in result

    def test_shows_message_count(self) -> None:
        from ravn.domain.models import Message

        s = Session()
        s.add_message(Message(role="user", content="hi"))
        result = handle("/memory", _ctx(session=s))
        assert result is not None
        assert "1" in result

    def test_shows_open_todos_count(self) -> None:
        s = Session()
        s.upsert_todo(TodoItem(id="1", content="do something", status=TodoStatus.PENDING))
        result = handle("/memory", _ctx(session=s))
        assert result is not None
        assert "1" in result


# ---------------------------------------------------------------------------
# /compact
# ---------------------------------------------------------------------------


class TestCmdCompact:
    def test_clears_messages(self) -> None:
        from ravn.domain.models import Message

        s = Session()
        s.add_message(Message(role="user", content="hi"))
        s.add_message(Message(role="assistant", content="hey"))
        handle("/compact", _ctx(session=s))
        assert s.messages == []

    def test_reports_count(self) -> None:
        from ravn.domain.models import Message

        s = Session()
        s.add_message(Message(role="user", content="x"))
        result = handle("/compact", _ctx(session=s))
        assert result is not None
        assert "1" in result

    def test_compact_empty_history(self) -> None:
        result = handle("/compact", _ctx())
        assert result is not None
        assert "0" in result


# ---------------------------------------------------------------------------
# /budget
# ---------------------------------------------------------------------------


class TestCmdBudget:
    def test_shows_budget_values(self) -> None:
        s = Session()
        s.record_turn(s.total_usage)  # used = 1
        result = handle("/budget", _ctx(session=s, max_iterations=10))
        assert result is not None
        assert "1" in result  # used
        assert "9" in result  # remaining
        assert "10" in result  # limit

    def test_remaining_never_negative(self) -> None:
        s = Session()
        for _ in range(25):
            s.record_turn(s.total_usage)
        result = handle("/budget", _ctx(session=s, max_iterations=20))
        assert result is not None
        assert "0" in result  # remaining clamped to 0


# ---------------------------------------------------------------------------
# /todo
# ---------------------------------------------------------------------------


class TestCmdTodo:
    def test_no_todos_message(self) -> None:
        result = handle("/todo", _ctx())
        assert result is not None
        assert "No todos" in result

    def test_shows_todo_content(self) -> None:
        s = Session()
        s.upsert_todo(TodoItem(id="t1", content="write the thing"))
        result = handle("/todo", _ctx(session=s))
        assert result is not None
        assert "write the thing" in result

    def test_shows_status_icon_pending(self) -> None:
        s = Session()
        s.upsert_todo(TodoItem(id="t1", content="x", status=TodoStatus.PENDING))
        result = handle("/todo", _ctx(session=s))
        assert result is not None
        assert "○" in result

    def test_shows_status_icon_done(self) -> None:
        s = Session()
        s.upsert_todo(TodoItem(id="t1", content="x", status=TodoStatus.DONE))
        result = handle("/todo", _ctx(session=s))
        assert result is not None
        assert "✓" in result

    def test_shows_status_icon_cancelled(self) -> None:
        s = Session()
        s.upsert_todo(TodoItem(id="t1", content="x", status=TodoStatus.CANCELLED))
        result = handle("/todo", _ctx(session=s))
        assert result is not None
        assert "✗" in result

    def test_shows_status_icon_in_progress(self) -> None:
        s = Session()
        s.upsert_todo(TodoItem(id="t1", content="x", status=TodoStatus.IN_PROGRESS))
        result = handle("/todo", _ctx(session=s))
        assert result is not None
        assert "◑" in result


# ---------------------------------------------------------------------------
# /status
# ---------------------------------------------------------------------------


class TestCmdStatus:
    def test_shows_session_id(self) -> None:
        s = Session()
        result = handle("/status", _ctx(session=s))
        assert result is not None
        assert str(s.id) in result

    def test_shows_llm_adapter_name(self) -> None:
        result = handle("/status", _ctx(llm_adapter_name="AnthropicAdapter"))
        assert result is not None
        assert "AnthropicAdapter" in result

    def test_shows_permission_mode(self) -> None:
        result = handle("/status", _ctx(permission_mode="deny_all"))
        assert result is not None
        assert "deny_all" in result

    def test_shows_max_iterations(self) -> None:
        result = handle("/status", _ctx(max_iterations=42))
        assert result is not None
        assert "42" in result

    def test_shows_tool_count(self) -> None:
        from tests.ravn.fixtures.fakes import EchoTool

        result = handle("/status", _ctx(tools=[EchoTool()]))
        assert result is not None
        assert "echo" in result

    def test_no_tools_shows_none(self) -> None:
        result = handle("/status", _ctx(tools=[]))
        assert result is not None
        assert "none" in result.lower()


# ---------------------------------------------------------------------------
# /init
# ---------------------------------------------------------------------------


class TestCmdInit:
    def test_creates_ravn_md(self, tmp_path: Path) -> None:
        result = handle("/init", _ctx(cwd=tmp_path))
        assert result is not None
        ravn_md = tmp_path / "RAVN.md"
        assert ravn_md.exists()

    def test_ravn_md_contains_project_name(self, tmp_path: Path) -> None:
        handle("/init", _ctx(cwd=tmp_path))
        content = (tmp_path / "RAVN.md").read_text()
        assert tmp_path.name in content

    def test_ravn_md_is_parseable_by_project_config(self, tmp_path: Path) -> None:
        from ravn.config import ProjectConfig

        handle("/init", _ctx(cwd=tmp_path))
        cfg = ProjectConfig.load(tmp_path / "RAVN.md")
        assert cfg is not None
        assert cfg.project_name == tmp_path.name
        assert cfg.iteration_budget > 0

    def test_already_exists_returns_error(self, tmp_path: Path) -> None:
        (tmp_path / "RAVN.md").write_text("# RAVN Project: existing\n")
        result = handle("/init", _ctx(cwd=tmp_path))
        assert result is not None
        assert "already exists" in result

    def test_uses_cwd_when_context_cwd_is_none(self, tmp_path: Path, monkeypatch) -> None:
        monkeypatch.chdir(tmp_path)
        result = handle("/init", _ctx(cwd=None))
        assert result is not None
        assert (tmp_path / "RAVN.md").exists()

    def test_ravn_md_contains_primary_alias(self, tmp_path: Path) -> None:
        handle("/init", _ctx(cwd=tmp_path))
        content = (tmp_path / "RAVN.md").read_text()
        assert "primary_alias" in content

    def test_ravn_md_contains_thinking_enabled(self, tmp_path: Path) -> None:
        handle("/init", _ctx(cwd=tmp_path))
        content = (tmp_path / "RAVN.md").read_text()
        assert "thinking_enabled" in content

    def test_python_project_detected(self, tmp_path: Path) -> None:
        (tmp_path / "pyproject.toml").write_text("[project]\nname = 'mylib'\n")
        result = handle("/init", _ctx(cwd=tmp_path))
        assert result is not None
        assert "python" in result
        content = (tmp_path / "RAVN.md").read_text()
        assert "pytest" in content

    def test_go_project_detected(self, tmp_path: Path) -> None:
        (tmp_path / "go.mod").write_text("module example.com/myapp\n")
        result = handle("/init", _ctx(cwd=tmp_path))
        assert result is not None
        assert "go" in result
        content = (tmp_path / "RAVN.md").read_text()
        assert "go test" in content

    def test_rust_project_detected(self, tmp_path: Path) -> None:
        (tmp_path / "Cargo.toml").write_text("[package]\nname = 'myapp'\n")
        result = handle("/init", _ctx(cwd=tmp_path))
        assert result is not None
        assert "rust" in result
        content = (tmp_path / "RAVN.md").read_text()
        assert "cargo" in content.lower()

    def test_node_project_detected(self, tmp_path: Path) -> None:
        (tmp_path / "package.json").write_text('{"name": "myapp"}\n')
        result = handle("/init", _ctx(cwd=tmp_path))
        assert result is not None
        assert "node" in result

    def test_generic_project_no_markers(self, tmp_path: Path) -> None:
        result = handle("/init", _ctx(cwd=tmp_path))
        assert result is not None
        assert "generic" in result

    @pytest.mark.parametrize(
        "project_type,marker_file,marker_content",
        [
            ("python", "pyproject.toml", "[project]\nname = 'mylib'\n"),
            ("go", "go.mod", "module example.com/myapp\n"),
            ("rust", "Cargo.toml", "[package]\nname = 'myapp'\n"),
            ("node", "package.json", '{"name": "myapp"}\n'),
            ("generic", None, None),
        ],
    )
    def test_generated_ravn_md_no_schema_warnings(
        self,
        tmp_path: Path,
        project_type: str,
        marker_file: str | None,
        marker_content: str | None,
    ) -> None:
        from ravn.config import ProjectConfig

        if marker_file is not None:
            (tmp_path / marker_file).write_text(marker_content or "")
        handle("/init", _ctx(cwd=tmp_path))
        cfg = ProjectConfig.load(tmp_path / "RAVN.md")
        assert cfg is not None, f"ProjectConfig.load returned None for {project_type} template"
        assert cfg.warnings == [], (
            f"{project_type} template produced schema warnings: {cfg.warnings}"
        )


# ---------------------------------------------------------------------------
# _detect_project_type
# ---------------------------------------------------------------------------


class TestDetectProjectType:
    def test_pyproject_toml(self, tmp_path: Path) -> None:
        from ravn.adapters.slash_commands import _detect_project_type

        (tmp_path / "pyproject.toml").write_text("")
        assert _detect_project_type(tmp_path) == "python"

    def test_setup_py(self, tmp_path: Path) -> None:
        from ravn.adapters.slash_commands import _detect_project_type

        (tmp_path / "setup.py").write_text("")
        assert _detect_project_type(tmp_path) == "python"

    def test_requirements_txt(self, tmp_path: Path) -> None:
        from ravn.adapters.slash_commands import _detect_project_type

        (tmp_path / "requirements.txt").write_text("")
        assert _detect_project_type(tmp_path) == "python"

    def test_go_mod(self, tmp_path: Path) -> None:
        from ravn.adapters.slash_commands import _detect_project_type

        (tmp_path / "go.mod").write_text("")
        assert _detect_project_type(tmp_path) == "go"

    def test_cargo_toml(self, tmp_path: Path) -> None:
        from ravn.adapters.slash_commands import _detect_project_type

        (tmp_path / "Cargo.toml").write_text("")
        assert _detect_project_type(tmp_path) == "rust"

    def test_package_json(self, tmp_path: Path) -> None:
        from ravn.adapters.slash_commands import _detect_project_type

        (tmp_path / "package.json").write_text("")
        assert _detect_project_type(tmp_path) == "node"

    def test_no_markers_returns_generic(self, tmp_path: Path) -> None:
        from ravn.adapters.slash_commands import _detect_project_type

        assert _detect_project_type(tmp_path) == "generic"

    def test_python_priority_over_node(self, tmp_path: Path) -> None:
        """Python markers are checked before Node when both exist."""
        from ravn.adapters.slash_commands import _detect_project_type

        (tmp_path / "pyproject.toml").write_text("")
        (tmp_path / "package.json").write_text("")
        assert _detect_project_type(tmp_path) == "python"
