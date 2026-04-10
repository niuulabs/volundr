"""Unit tests for the Docker-sandboxed terminal backend.

All tests mock ``asyncio.create_subprocess_exec`` so Docker is not required.
The fake process is a simple in-memory pipe that simulates a bash process
responding to commands with a sentinel line.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ravn.adapters.tools.terminal_docker import (
    _PERMISSION_SHELL,
    _SENTINEL_PREFIX,
    DockerPersistentShell,
    DockerTerminalTool,
    ShellState,
)
from ravn.config import DockerTerminalConfig

# ---------------------------------------------------------------------------
# Helpers — fake asyncio subprocess
# ---------------------------------------------------------------------------

WORKSPACE = Path("/workspace")


def _make_config(**kwargs) -> DockerTerminalConfig:
    return DockerTerminalConfig(**kwargs)


class FakeStdin:
    """Fake stdin that records writes."""

    def __init__(self) -> None:
        self._buf = bytearray()

    def write(self, data: bytes) -> None:
        self._buf.extend(data)

    async def drain(self) -> None:
        pass

    @property
    def written(self) -> str:
        return self._buf.decode()


class FakeStdout:
    """Fake stdout that returns pre-configured lines."""

    def __init__(self, lines: list[bytes]) -> None:
        self._lines = iter(lines)

    async def readline(self) -> bytes:
        try:
            return next(self._lines)
        except StopIteration:
            return b""


def _make_fake_process(
    lines: list[bytes],
    returncode: int = 0,
    pid: int = 12345,
) -> MagicMock:
    """Build a fake asyncio.subprocess.Process with configurable stdout lines."""
    proc = MagicMock()
    proc.pid = pid
    proc.returncode = None  # still running
    proc.stdin = FakeStdin()
    proc.stdout = FakeStdout(lines)

    async def _wait():
        proc.returncode = returncode

    proc.wait = _wait
    proc.kill = MagicMock()
    return proc


def _sentinel_line(sentinel: str, exit_code: int = 0) -> bytes:
    return f"{sentinel}:{exit_code}\n".encode()


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
# DockerPersistentShell — lifecycle
# ---------------------------------------------------------------------------


class TestDockerPersistentShellLifecycle:
    @pytest.mark.asyncio
    async def test_start_launches_docker_run(self):
        config = _make_config()
        shell = DockerPersistentShell(config=config, workspace_root=WORKSPACE)
        assert not shell.is_running

        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = _make_fake_process([])
            await shell.start()
            assert shell.is_running
            call_args = mock_exec.call_args[0]
            assert call_args[0] == "docker"
            assert call_args[1] == "run"

        await shell.close()

    @pytest.mark.asyncio
    async def test_start_is_idempotent(self):
        config = _make_config()
        shell = DockerPersistentShell(config=config, workspace_root=WORKSPACE)

        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = _make_fake_process([])
            await shell.start()
            await shell.start()
            # create_subprocess_exec called only once
            assert mock_exec.call_count == 1

        await shell.close()

    @pytest.mark.asyncio
    async def test_close_kills_process_and_removes_container(self):
        config = _make_config()
        shell = DockerPersistentShell(config=config, workspace_root=WORKSPACE)

        proc = _make_fake_process([])

        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_exec.side_effect = [
                proc,  # docker run
                _make_fake_process([]),  # docker rm -f
            ]
            await shell.start()
            assert shell.is_running
            await shell.close()

        assert not shell.is_running

    @pytest.mark.asyncio
    async def test_close_before_start_is_safe(self):
        config = _make_config()
        shell = DockerPersistentShell(config=config, workspace_root=WORKSPACE)

        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = _make_fake_process([])
            await shell.close()  # never started — should not raise

    @pytest.mark.asyncio
    async def test_context_manager(self):
        config = _make_config()

        proc = _make_fake_process([])

        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_exec.side_effect = [
                proc,  # docker run
                _make_fake_process([]),  # docker rm -f
            ]
            async with DockerPersistentShell(config=config, workspace_root=WORKSPACE) as shell:
                assert shell.is_running
            assert not shell.is_running


# ---------------------------------------------------------------------------
# DockerPersistentShell — docker command construction
# ---------------------------------------------------------------------------


class TestDockerCmdConstruction:
    @pytest.mark.asyncio
    async def test_network_flag_included(self):
        config = _make_config(network="bridge")
        shell = DockerPersistentShell(config=config, workspace_root=WORKSPACE)

        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = _make_fake_process([])
            await shell.start()
            args = mock_exec.call_args[0]
            assert "--network=bridge" in args

        await shell.close()

    @pytest.mark.asyncio
    async def test_workspace_mount_included_when_enabled(self):
        config = _make_config(mount_workspace=True)
        shell = DockerPersistentShell(config=config, workspace_root=WORKSPACE)

        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = _make_fake_process([])
            await shell.start()
            args = mock_exec.call_args[0]
            assert "-v" in args
            # workspace path appears as both source and target
            ws = str(WORKSPACE)
            assert any(f"{ws}:{ws}" == arg for arg in args)

        await shell.close()

    @pytest.mark.asyncio
    async def test_workspace_mount_omitted_when_disabled(self):
        config = _make_config(mount_workspace=False)
        shell = DockerPersistentShell(config=config, workspace_root=WORKSPACE)

        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = _make_fake_process([])
            await shell.start()
            args = mock_exec.call_args[0]
            ws = str(WORKSPACE)
            assert not any(f"{ws}:{ws}" == arg for arg in args)

        await shell.close()

    @pytest.mark.asyncio
    async def test_extra_mounts_included(self):
        config = _make_config(extra_mounts=["/data:/data:ro"])
        shell = DockerPersistentShell(config=config, workspace_root=WORKSPACE)

        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = _make_fake_process([])
            await shell.start()
            args = mock_exec.call_args[0]
            assert "/data:/data:ro" in args

        await shell.close()

    @pytest.mark.asyncio
    async def test_image_used(self):
        config = _make_config(image="ubuntu:22.04")
        shell = DockerPersistentShell(config=config, workspace_root=WORKSPACE)

        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = _make_fake_process([])
            await shell.start()
            args = mock_exec.call_args[0]
            assert "ubuntu:22.04" in args

        await shell.close()

    @pytest.mark.asyncio
    async def test_rm_and_interactive_flags_present(self):
        config = _make_config()
        shell = DockerPersistentShell(config=config, workspace_root=WORKSPACE)

        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = _make_fake_process([])
            await shell.start()
            args = mock_exec.call_args[0]
            assert "--rm" in args
            assert "--interactive" in args

        await shell.close()

    @pytest.mark.asyncio
    async def test_shell_flags_present(self):
        config = _make_config()
        shell = DockerPersistentShell(config=config, workspace_root=WORKSPACE)

        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = _make_fake_process([])
            await shell.start()
            args = mock_exec.call_args[0]
            assert "--norc" in args
            assert "--noprofile" in args

        await shell.close()


# ---------------------------------------------------------------------------
# DockerPersistentShell — command execution
# ---------------------------------------------------------------------------


class TestDockerPersistentShellRun:
    """Tests for run() using a fake process with sentinel-terminated output."""

    async def _run_with_output(
        self,
        command: str,
        output_lines: list[str],
        exit_code: int = 0,
        config: DockerTerminalConfig | None = None,
    ) -> tuple[str, int]:
        """Helper: start a shell, inject output_lines + sentinel, run command."""
        cfg = config or _make_config()
        shell = DockerPersistentShell(config=cfg, workspace_root=WORKSPACE)

        # We need to intercept the sentinel written by run() itself.
        # Strategy: patch create_subprocess_exec, capture the stdin writes,
        # and serve back lines dynamically.

        written_chunks: list[bytes] = []

        class DynamicStdin:
            def write(self, data: bytes) -> None:
                written_chunks.append(data)

            async def drain(self) -> None:
                pass

        # Build response lines: user-defined output + sentinel line.
        # The sentinel is written as part of the wrapped command;
        # we extract it by inspecting what was written to stdin.
        response_queue: asyncio.Queue[bytes] = asyncio.Queue()

        class DynamicStdout:
            async def readline(self) -> bytes:
                return await response_queue.get()

        async def populate_responses():
            # Wait until stdin has the sentinel written into it
            await asyncio.sleep(0.01)
            # Extract sentinel from the last write
            combined = b"".join(written_chunks).decode()
            sentinel = ""
            for line in combined.splitlines():
                if line.startswith(f"echo {_SENTINEL_PREFIX}_"):
                    sentinel = line.split()[1].split(":")[0]
                    break

            for line in output_lines:
                await response_queue.put(line.encode() + b"\n")
            await response_queue.put(f"{sentinel}:{exit_code}\n".encode())

        proc = MagicMock()
        proc.pid = 42
        proc.returncode = None
        proc.stdin = DynamicStdin()
        proc.stdout = DynamicStdout()

        async def _wait():
            proc.returncode = 0

        proc.wait = _wait
        proc.kill = MagicMock()

        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            rm_proc = _make_fake_process([])
            mock_exec.side_effect = [proc, rm_proc]

            await shell.start()
            asyncio.create_task(populate_responses())
            result = await shell.run(command)
            await shell.close()

        return result

    @pytest.mark.asyncio
    async def test_run_returns_output_and_zero_exit(self):
        output, rc = await self._run_with_output("echo hello", ["hello"], exit_code=0)
        assert "hello" in output
        assert rc == 0

    @pytest.mark.asyncio
    async def test_run_returns_nonzero_exit(self):
        _, rc = await self._run_with_output("false", [], exit_code=1)
        assert rc == 1

    @pytest.mark.asyncio
    async def test_run_captures_multiple_output_lines(self):
        output, rc = await self._run_with_output("printf 'a\\nb\\nc'", ["a", "b", "c"], exit_code=0)
        assert "a" in output
        assert "b" in output
        assert "c" in output
        assert rc == 0

    @pytest.mark.asyncio
    async def test_run_auto_starts_shell(self):
        """run() must start the shell automatically if not yet started."""
        cfg = _make_config()
        shell = DockerPersistentShell(config=cfg, workspace_root=WORKSPACE)
        assert not shell.is_running

        written_chunks: list[bytes] = []

        class DynamicStdin:
            def write(self, data: bytes) -> None:
                written_chunks.append(data)

            async def drain(self) -> None:
                pass

        response_queue: asyncio.Queue[bytes] = asyncio.Queue()

        class DynamicStdout:
            async def readline(self) -> bytes:
                return await response_queue.get()

        proc = MagicMock()
        proc.pid = 99
        proc.returncode = None
        proc.stdin = DynamicStdin()
        proc.stdout = DynamicStdout()

        async def _wait():
            proc.returncode = 0

        proc.wait = _wait
        proc.kill = MagicMock()

        async def populate():
            await asyncio.sleep(0.01)
            combined = b"".join(written_chunks).decode()
            sentinel = ""
            for line in combined.splitlines():
                if line.startswith(f"echo {_SENTINEL_PREFIX}_"):
                    sentinel = line.split()[1].split(":")[0]
                    break
            await response_queue.put(b"auto-started\n")
            await response_queue.put(f"{sentinel}:0\n".encode())

        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            rm_proc = _make_fake_process([])
            mock_exec.side_effect = [proc, rm_proc]
            asyncio.create_task(populate())
            output, rc = await shell.run("echo auto-started")
            await shell.close()

        assert "auto-started" in output
        assert rc == 0

    @pytest.mark.asyncio
    async def test_run_eof_returns_process_exit_code(self):
        """When stdout returns EOF, run() returns the process returncode."""
        cfg = _make_config()
        shell = DockerPersistentShell(config=cfg, workspace_root=WORKSPACE)

        proc = MagicMock()
        proc.pid = 1
        proc.returncode = None
        proc.stdin = FakeStdin()
        # stdout immediately returns EOF
        proc.stdout = FakeStdout([])  # empty — immediately returns b""

        async def _wait():
            proc.returncode = 42

        proc.wait = _wait
        proc.kill = MagicMock()

        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            rm_proc = _make_fake_process([])
            mock_exec.side_effect = [proc, rm_proc]
            await shell.start()
            output, rc = await shell.run("exit 42")
            await shell.close()

        assert rc == 42


# ---------------------------------------------------------------------------
# DockerPersistentShell — timeout
# ---------------------------------------------------------------------------


class TestDockerPersistentShellTimeout:
    @pytest.mark.asyncio
    async def test_timeout_returns_124(self):
        cfg = _make_config()
        shell = DockerPersistentShell(config=cfg, workspace_root=WORKSPACE, timeout_seconds=0.05)

        proc = MagicMock()
        proc.pid = 5
        proc.returncode = None
        proc.stdin = FakeStdin()

        class HangingStdout:
            async def readline(self) -> bytes:
                await asyncio.sleep(60)  # never returns within timeout
                return b""

        proc.stdout = HangingStdout()

        async def _wait():
            proc.returncode = 0

        proc.wait = _wait
        proc.kill = MagicMock()

        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            rm_proc = _make_fake_process([])
            mock_exec.side_effect = [proc, rm_proc]
            await shell.start()
            output, rc = await shell.run("sleep 60")

        assert rc == 124
        assert "timed out" in output
        assert not shell.is_running


# ---------------------------------------------------------------------------
# DockerPersistentShell — state capture / restore
# ---------------------------------------------------------------------------


class TestDockerShellState:
    @pytest.mark.asyncio
    async def test_get_state_calls_pwd_and_export(self):
        """get_state() must run both pwd and export -p."""
        cfg = _make_config()
        shell = DockerPersistentShell(config=cfg, workspace_root=WORKSPACE)

        written: list[str] = []
        response_queue: asyncio.Queue[bytes] = asyncio.Queue()
        written_bytes: list[bytes] = []

        class CapturingStdin:
            def write(self, data: bytes) -> None:
                written_bytes.append(data)

            async def drain(self) -> None:
                pass

        class DynamicStdout:
            async def readline(self) -> bytes:
                return await response_queue.get()

        proc = MagicMock()
        proc.pid = 77
        proc.returncode = None
        proc.stdin = CapturingStdin()
        proc.stdout = DynamicStdout()

        async def _wait():
            proc.returncode = 0

        proc.wait = _wait
        proc.kill = MagicMock()

        sentinel_count = 0

        async def populate():
            nonlocal sentinel_count
            # get_state sends two commands: pwd and export -p
            # We respond with sentinel for each
            for _ in range(2):
                await asyncio.sleep(0.02)
                combined = b"".join(written_bytes).decode()
                # Find the latest unseen sentinel
                lines = combined.splitlines()
                last_sentinel = ""
                for line in reversed(lines):
                    if line.startswith(f"echo {_SENTINEL_PREFIX}_"):
                        candidate = line.split()[1].split(":")[0]
                        if candidate not in written:
                            last_sentinel = candidate
                            written.append(candidate)
                            break
                if sentinel_count == 0:
                    await response_queue.put(b"/tmp\n")
                else:
                    await response_queue.put(b"export FOO=bar\n")
                await response_queue.put(f"{last_sentinel}:0\n".encode())
                sentinel_count += 1

        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            rm_proc = _make_fake_process([])
            mock_exec.side_effect = [proc, rm_proc]
            await shell.start()
            asyncio.create_task(populate())
            await asyncio.sleep(0.01)
            state = await shell.get_state()
            await shell.close()

        assert "/tmp" in state.cwd
        assert "FOO" in state.env_exports

    @pytest.mark.asyncio
    async def test_restore_state_empty_is_noop(self):
        """restore_state with empty ShellState should not raise or send commands."""
        cfg = _make_config()
        shell = DockerPersistentShell(config=cfg, workspace_root=WORKSPACE)

        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            rm_proc = _make_fake_process([])
            mock_exec.side_effect = [rm_proc]
            await shell.restore_state(ShellState())  # no-op, shell not started


# ---------------------------------------------------------------------------
# DockerTerminalTool — interface
# ---------------------------------------------------------------------------


class TestDockerTerminalToolInterface:
    def test_name(self):
        assert DockerTerminalTool().name == "terminal"

    def test_description_mentions_docker(self):
        desc = DockerTerminalTool().description
        assert "docker" in desc.lower() or "container" in desc.lower()

    def test_required_permission(self):
        assert DockerTerminalTool().required_permission == _PERMISSION_SHELL

    def test_input_schema_requires_command(self):
        schema = DockerTerminalTool().input_schema
        assert schema["type"] == "object"
        assert "command" in schema["properties"]
        assert "command" in schema["required"]

    def test_to_api_dict_shape(self):
        api = DockerTerminalTool().to_api_dict()
        assert api["name"] == "terminal"
        assert "description" in api
        assert "input_schema" in api

    def test_not_parallelisable(self):
        assert DockerTerminalTool().parallelisable is False

    def test_default_config_applied(self):
        tool = DockerTerminalTool()
        assert isinstance(tool._config, DockerTerminalConfig)

    def test_custom_config_applied(self):
        cfg = DockerTerminalConfig(image="node:20-slim", network="bridge")
        tool = DockerTerminalTool(config=cfg)
        assert tool._config.image == "node:20-slim"
        assert tool._config.network == "bridge"

    def test_timeout_propagated(self):
        tool = DockerTerminalTool(timeout_seconds=99.0)
        assert tool._timeout == 99.0

    def test_initial_state_stored(self):
        state = ShellState(cwd="/app", env_exports="export X=1")
        tool = DockerTerminalTool(initial_state=state)
        assert tool._initial_state is state


# ---------------------------------------------------------------------------
# DockerTerminalTool — execute
# ---------------------------------------------------------------------------


class TestDockerTerminalToolExecute:
    @pytest.mark.asyncio
    async def test_empty_command_returns_error(self):
        tool = DockerTerminalTool()
        result = await tool.execute({"command": ""})
        assert result.is_error
        assert "No command" in result.content

    @pytest.mark.asyncio
    async def test_whitespace_command_returns_error(self):
        tool = DockerTerminalTool()
        result = await tool.execute({"command": "   "})
        assert result.is_error

    @pytest.mark.asyncio
    async def test_execute_calls_shell_run(self):
        tool = DockerTerminalTool()
        mock_shell = AsyncMock()
        mock_shell.is_running = True
        mock_shell.run = AsyncMock(return_value=("hello", 0))
        mock_shell.restore_state = AsyncMock()
        tool._shell = mock_shell

        result = await tool.execute({"command": "echo hello"})
        assert not result.is_error
        assert "hello" in result.content
        mock_shell.run.assert_called_once_with("echo hello")

    @pytest.mark.asyncio
    async def test_execute_nonzero_exit_is_error(self):
        tool = DockerTerminalTool()
        mock_shell = AsyncMock()
        mock_shell.is_running = True
        mock_shell.run = AsyncMock(return_value=("", 1))
        tool._shell = mock_shell

        result = await tool.execute({"command": "false"})
        assert result.is_error
        assert "exit 1" in result.content

    @pytest.mark.asyncio
    async def test_execute_creates_shell_on_first_call(self):
        tool = DockerTerminalTool()
        assert tool._shell is None

        with patch("ravn.adapters.tools.terminal_docker.DockerPersistentShell") as mock_shell_cls:
            instance = AsyncMock()
            instance.is_running = True
            instance.run = AsyncMock(return_value=("ok", 0))
            instance.start = AsyncMock()
            instance.restore_state = AsyncMock()
            mock_shell_cls.return_value = instance

            result = await tool.execute({"command": "echo ok"})
            instance.start.assert_called_once()
            assert result.content == "ok"

    @pytest.mark.asyncio
    async def test_execute_restores_initial_state_on_first_call(self):
        initial = ShellState(cwd="/app", env_exports="export X=1")
        tool = DockerTerminalTool(initial_state=initial)

        with patch("ravn.adapters.tools.terminal_docker.DockerPersistentShell") as mock_shell_cls:
            instance = AsyncMock()
            instance.is_running = True
            instance.run = AsyncMock(return_value=("ok", 0))
            instance.start = AsyncMock()
            instance.restore_state = AsyncMock()
            mock_shell_cls.return_value = instance

            await tool.execute({"command": "echo ok"})
            instance.restore_state.assert_called_once_with(initial)

    @pytest.mark.asyncio
    async def test_execute_does_not_restore_state_without_initial_state(self):
        tool = DockerTerminalTool()

        with patch("ravn.adapters.tools.terminal_docker.DockerPersistentShell") as mock_shell_cls:
            instance = AsyncMock()
            instance.is_running = True
            instance.run = AsyncMock(return_value=("ok", 0))
            instance.start = AsyncMock()
            instance.restore_state = AsyncMock()
            mock_shell_cls.return_value = instance

            await tool.execute({"command": "echo ok"})
            instance.restore_state.assert_not_called()


# ---------------------------------------------------------------------------
# DockerTerminalTool — get_state and close
# ---------------------------------------------------------------------------


class TestDockerTerminalToolStateAndClose:
    @pytest.mark.asyncio
    async def test_get_state_none_before_first_call(self):
        tool = DockerTerminalTool()
        state = await tool.get_state()
        assert state is None

    @pytest.mark.asyncio
    async def test_get_state_none_when_shell_not_running(self):
        tool = DockerTerminalTool()
        mock_shell = AsyncMock()
        mock_shell.is_running = False
        tool._shell = mock_shell

        state = await tool.get_state()
        assert state is None

    @pytest.mark.asyncio
    async def test_get_state_delegates_to_shell(self):
        tool = DockerTerminalTool()
        expected_state = ShellState(cwd="/tmp", env_exports="")
        mock_shell = AsyncMock()
        mock_shell.is_running = True
        mock_shell.get_state = AsyncMock(return_value=expected_state)
        tool._shell = mock_shell

        state = await tool.get_state()
        assert state is expected_state

    @pytest.mark.asyncio
    async def test_close_destroys_shell(self):
        tool = DockerTerminalTool()
        mock_shell = AsyncMock()
        mock_shell.close = AsyncMock()
        tool._shell = mock_shell

        await tool.close()
        mock_shell.close.assert_called_once()
        assert tool._shell is None

    @pytest.mark.asyncio
    async def test_close_is_idempotent(self):
        tool = DockerTerminalTool()
        await tool.close()  # no shell — should not raise
        await tool.close()  # still no shell — should not raise

    @pytest.mark.asyncio
    async def test_close_sets_shell_to_none(self):
        tool = DockerTerminalTool()
        mock_shell = AsyncMock()
        mock_shell.close = AsyncMock()
        tool._shell = mock_shell

        await tool.close()
        assert tool._shell is None


# ---------------------------------------------------------------------------
# DockerTerminalConfig defaults
# ---------------------------------------------------------------------------


class TestDockerTerminalConfig:
    def test_default_image(self):
        cfg = DockerTerminalConfig()
        assert cfg.image == "python:3.11-slim"

    def test_default_network_is_none(self):
        cfg = DockerTerminalConfig()
        assert cfg.network == "none"

    def test_default_mount_workspace_true(self):
        cfg = DockerTerminalConfig()
        assert cfg.mount_workspace is True

    def test_default_extra_mounts_empty(self):
        cfg = DockerTerminalConfig()
        assert cfg.extra_mounts == []

    def test_custom_values(self):
        cfg = DockerTerminalConfig(
            image="node:20",
            network="bridge",
            mount_workspace=False,
            extra_mounts=["/data:/data"],
        )
        assert cfg.image == "node:20"
        assert cfg.network == "bridge"
        assert cfg.mount_workspace is False
        assert cfg.extra_mounts == ["/data:/data"]


# ---------------------------------------------------------------------------
# TerminalToolConfig integration
# ---------------------------------------------------------------------------


class TestTerminalToolConfigIntegration:
    def test_terminal_config_has_backend_field(self):
        from ravn.config import TerminalToolConfig

        cfg = TerminalToolConfig()
        assert cfg.backend == "local"

    def test_terminal_config_backend_docker(self):
        from ravn.config import TerminalToolConfig

        cfg = TerminalToolConfig(backend="docker")
        assert cfg.backend == "docker"

    def test_terminal_config_has_docker_sub_config(self):
        from ravn.config import TerminalToolConfig

        cfg = TerminalToolConfig()
        assert isinstance(cfg.docker, DockerTerminalConfig)
