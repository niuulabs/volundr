"""Unit tests for the terminal tool — PersistentShell and TerminalTool."""

from __future__ import annotations

import pytest

from ravn.adapters.tools.terminal import (
    _DEFAULT_SHELL,
    _DEFAULT_TIMEOUT_SECONDS,
    _PERMISSION_SHELL,
    PersistentShell,
    ShellState,
    TerminalTool,
)

# ---------------------------------------------------------------------------
# ShellState
# ---------------------------------------------------------------------------


class TestShellState:
    def test_defaults(self):
        state = ShellState()
        assert state.cwd == ""
        assert state.env_exports == ""

    def test_custom_values(self):
        state = ShellState(cwd="/tmp", env_exports="export FOO=bar")
        assert state.cwd == "/tmp"
        assert state.env_exports == "export FOO=bar"


# ---------------------------------------------------------------------------
# PersistentShell — real subprocess (bash must be available)
# ---------------------------------------------------------------------------


class TestPersistentShellLifecycle:
    @pytest.mark.asyncio
    async def test_start_creates_running_process(self):
        shell = PersistentShell()
        assert not shell.is_running
        await shell.start()
        try:
            assert shell.is_running
        finally:
            await shell.close()

    @pytest.mark.asyncio
    async def test_start_is_idempotent(self):
        shell = PersistentShell()
        await shell.start()
        try:
            pid_before = shell._process.pid  # type: ignore[union-attr]
            await shell.start()
            assert shell._process.pid == pid_before  # type: ignore[union-attr]
        finally:
            await shell.close()

    @pytest.mark.asyncio
    async def test_close_stops_process(self):
        shell = PersistentShell()
        await shell.start()
        assert shell.is_running
        await shell.close()
        assert not shell.is_running

    @pytest.mark.asyncio
    async def test_close_is_idempotent(self):
        shell = PersistentShell()
        await shell.close()  # never started — should not raise
        await shell.start()
        await shell.close()
        await shell.close()  # already closed — should not raise

    @pytest.mark.asyncio
    async def test_context_manager_starts_and_closes(self):
        async with PersistentShell() as shell:
            assert shell.is_running
        assert not shell.is_running


class TestPersistentShellRun:
    @pytest.mark.asyncio
    async def test_run_returns_output(self):
        async with PersistentShell() as shell:
            output, rc = await shell.run("echo hello")
            assert "hello" in output
            assert rc == 0

    @pytest.mark.asyncio
    async def test_run_captures_exit_code_zero(self):
        async with PersistentShell() as shell:
            _, rc = await shell.run("true")
            assert rc == 0

    @pytest.mark.asyncio
    async def test_run_captures_nonzero_exit_code(self):
        async with PersistentShell() as shell:
            _, rc = await shell.run("false")
            assert rc == 1

    @pytest.mark.asyncio
    async def test_run_captures_explicit_exit_code(self):
        async with PersistentShell() as shell:
            _, rc = await shell.run("exit 42")
            # exit terminates the shell; process is gone
            assert rc == 42

    @pytest.mark.asyncio
    async def test_run_persists_working_directory(self):
        async with PersistentShell() as shell:
            await shell.run("cd /tmp")
            output, rc = await shell.run("pwd")
            assert rc == 0
            assert "/tmp" in output

    @pytest.mark.asyncio
    async def test_run_persists_environment_variable(self):
        async with PersistentShell() as shell:
            await shell.run("export RAVN_TEST_VAR=sentinel42")
            output, rc = await shell.run("echo $RAVN_TEST_VAR")
            assert rc == 0
            assert "sentinel42" in output

    @pytest.mark.asyncio
    async def test_run_stderr_captured_in_output(self):
        async with PersistentShell() as shell:
            output, _ = await shell.run("echo oops >&2")
            assert "oops" in output

    @pytest.mark.asyncio
    async def test_run_starts_shell_if_not_yet_started(self):
        shell = PersistentShell()
        assert not shell.is_running
        try:
            output, rc = await shell.run("echo auto-start")
            assert rc == 0
            assert "auto-start" in output
        finally:
            await shell.close()

    @pytest.mark.asyncio
    async def test_run_multiline_command(self):
        async with PersistentShell() as shell:
            output, rc = await shell.run("echo first\necho second")
            assert rc == 0
            assert "first" in output
            assert "second" in output

    @pytest.mark.asyncio
    async def test_run_timeout_returns_124(self):
        shell = PersistentShell(timeout_seconds=0.2)
        await shell.start()
        try:
            output, rc = await shell.run("sleep 10")
            assert rc == 124
            assert "timed out" in output
        finally:
            # shell may be in bad state after timeout; close gracefully
            await shell.close()


class TestPersistentShellState:
    @pytest.mark.asyncio
    async def test_get_state_returns_cwd(self):
        async with PersistentShell() as shell:
            await shell.run("cd /tmp")
            state = await shell.get_state()
            assert "/tmp" in state.cwd

    @pytest.mark.asyncio
    async def test_get_state_env_exports_contains_variable(self):
        async with PersistentShell() as shell:
            await shell.run("export RAVN_STATE_VAR=check")
            state = await shell.get_state()
            assert "RAVN_STATE_VAR" in state.env_exports

    @pytest.mark.asyncio
    async def test_restore_state_sets_cwd(self):
        async with PersistentShell() as shell:
            await shell.run("cd /tmp")
            state = await shell.get_state()

        async with PersistentShell() as shell2:
            await shell2.restore_state(state)
            output, rc = await shell2.run("pwd")
            assert rc == 0
            assert "/tmp" in output

    @pytest.mark.asyncio
    async def test_restore_state_sets_env_variable(self):
        async with PersistentShell() as shell:
            await shell.run("export RAVN_RESTORE_VAR=restored")
            state = await shell.get_state()

        async with PersistentShell() as shell2:
            await shell2.restore_state(state)
            output, rc = await shell2.run("echo $RAVN_RESTORE_VAR")
            assert rc == 0
            assert "restored" in output

    @pytest.mark.asyncio
    async def test_restore_state_empty_state_is_noop(self):
        async with PersistentShell() as shell:
            state = ShellState()
            await shell.restore_state(state)  # should not raise
            output, rc = await shell.run("echo ok")
            assert rc == 0
            assert "ok" in output


# ---------------------------------------------------------------------------
# TerminalTool — interface
# ---------------------------------------------------------------------------


class TestTerminalToolInterface:
    def test_name(self):
        assert TerminalTool().name == "terminal"

    def test_description_mentions_persistence(self):
        desc = TerminalTool().description
        assert "persist" in desc.lower()

    def test_required_permission(self):
        assert TerminalTool().required_permission == _PERMISSION_SHELL

    def test_input_schema_requires_command(self):
        schema = TerminalTool().input_schema
        assert schema["type"] == "object"
        assert "command" in schema["properties"]
        assert "command" in schema["required"]

    def test_to_api_dict_shape(self):
        api = TerminalTool().to_api_dict()
        assert api["name"] == "terminal"
        assert "description" in api
        assert "input_schema" in api


# ---------------------------------------------------------------------------
# TerminalTool — persistent execution
# ---------------------------------------------------------------------------


class TestTerminalToolPersistentExecution:
    @pytest.mark.asyncio
    async def test_execute_runs_command(self):
        tool = TerminalTool()
        try:
            result = await tool.execute({"command": "echo hi"})
            assert not result.is_error
            assert "hi" in result.content
        finally:
            await tool.close()

    @pytest.mark.asyncio
    async def test_execute_state_persists_across_calls(self):
        tool = TerminalTool()
        try:
            await tool.execute({"command": "cd /tmp"})
            result = await tool.execute({"command": "pwd"})
            assert not result.is_error
            assert "/tmp" in result.content
        finally:
            await tool.close()

    @pytest.mark.asyncio
    async def test_execute_nonzero_exit_is_error(self):
        tool = TerminalTool()
        try:
            result = await tool.execute({"command": "false"})
            assert result.is_error
            assert "exit 1" in result.content
        finally:
            await tool.close()

    @pytest.mark.asyncio
    async def test_execute_empty_command_returns_error(self):
        tool = TerminalTool()
        result = await tool.execute({"command": ""})
        assert result.is_error
        assert "No command" in result.content

    @pytest.mark.asyncio
    async def test_execute_whitespace_only_returns_error(self):
        tool = TerminalTool()
        result = await tool.execute({"command": "   "})
        assert result.is_error

    @pytest.mark.asyncio
    async def test_initial_state_restored_on_first_call(self):
        # Capture state with /tmp as cwd
        source = TerminalTool()
        try:
            await source.execute({"command": "cd /tmp"})
            state = await source.get_state()
        finally:
            await source.close()

        assert state is not None

        # Resume into a new tool with that state
        resumed = TerminalTool(initial_state=state)
        try:
            result = await resumed.execute({"command": "pwd"})
            assert not result.is_error
            assert "/tmp" in result.content
        finally:
            await resumed.close()

    @pytest.mark.asyncio
    async def test_get_state_none_before_first_call(self):
        tool = TerminalTool()
        state = await tool.get_state()
        assert state is None

    @pytest.mark.asyncio
    async def test_get_state_returns_state_after_call(self):
        tool = TerminalTool()
        try:
            await tool.execute({"command": "cd /tmp"})
            state = await tool.get_state()
            assert state is not None
            assert "/tmp" in state.cwd
        finally:
            await tool.close()

    @pytest.mark.asyncio
    async def test_close_cleans_up_shell(self):
        tool = TerminalTool()
        await tool.execute({"command": "echo init"})
        assert tool._shell is not None
        await tool.close()
        assert tool._shell is None

    @pytest.mark.asyncio
    async def test_close_is_idempotent(self):
        tool = TerminalTool()
        await tool.close()  # never started
        await tool.execute({"command": "echo ok"})
        await tool.close()
        await tool.close()  # second close should not raise


# ---------------------------------------------------------------------------
# TerminalTool — ephemeral execution
# ---------------------------------------------------------------------------


class TestTerminalToolEphemeralExecution:
    @pytest.mark.asyncio
    async def test_execute_ephemeral_runs_command(self):
        tool = TerminalTool(persistent_shell=False)
        result = await tool.execute({"command": "echo ephemeral"})
        assert not result.is_error
        assert "ephemeral" in result.content

    @pytest.mark.asyncio
    async def test_execute_ephemeral_nonzero_exit_is_error(self):
        tool = TerminalTool(persistent_shell=False)
        result = await tool.execute({"command": "false"})
        assert result.is_error

    @pytest.mark.asyncio
    async def test_execute_ephemeral_does_not_create_shell(self):
        tool = TerminalTool(persistent_shell=False)
        await tool.execute({"command": "echo ok"})
        assert tool._shell is None

    @pytest.mark.asyncio
    async def test_execute_ephemeral_timeout(self):
        tool = TerminalTool(persistent_shell=False, timeout_seconds=0.1)
        result = await tool.execute({"command": "sleep 10"})
        assert result.is_error
        assert "timed out" in result.content

    @pytest.mark.asyncio
    async def test_execute_ephemeral_invalid_command(self):
        tool = TerminalTool(persistent_shell=False)
        result = await tool.execute({"command": "this_command_does_not_exist_xyzzy"})
        # Non-zero exit or error — either is acceptable
        assert result.is_error or "not found" in result.content.lower()


# ---------------------------------------------------------------------------
# TerminalTool — config integration
# ---------------------------------------------------------------------------


class TestTerminalToolConfig:
    def test_default_shell_path(self):
        tool = TerminalTool()
        assert tool._shell_path == _DEFAULT_SHELL

    def test_custom_shell_path(self):
        tool = TerminalTool(shell="/bin/sh")
        assert tool._shell_path == "/bin/sh"

    def test_default_timeout(self):
        tool = TerminalTool()
        assert tool._timeout == _DEFAULT_TIMEOUT_SECONDS

    def test_custom_timeout(self):
        tool = TerminalTool(timeout_seconds=60.0)
        assert tool._timeout == 60.0

    def test_persistent_shell_default_true(self):
        tool = TerminalTool()
        assert tool._persistent is True

    def test_persistent_shell_false(self):
        tool = TerminalTool(persistent_shell=False)
        assert tool._persistent is False
