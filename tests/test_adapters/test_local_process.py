"""Tests for the LocalProcessPodManager adapter."""

from __future__ import annotations

import asyncio
import json
import signal
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from volundr.adapters.outbound.local_process import (
    DEFAULT_CLAUDE_BINARY,
    DEFAULT_MAX_CONCURRENT,
    DEFAULT_SDK_PORT_START,
    DEFAULT_STOP_TIMEOUT,
    LocalProcessPodManager,
    ProcessInfo,
    ProcessState,
    SdkPortAllocator,
    _inject_token_into_url,
)
from volundr.domain.models import (
    GitSource,
    LocalMountSource,
    MountMapping,
    PodSpecAdditions,
    Session,
    SessionSpec,
    SessionStatus,
)
from volundr.domain.ports import PodStartResult

# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------


@pytest.fixture
def tmp_workspaces(tmp_path: Path) -> Path:
    """Temporary workspaces directory."""
    d = tmp_path / "workspaces"
    d.mkdir()
    return d


@pytest.fixture
def tmp_state_file(tmp_path: Path) -> Path:
    """Temporary state file path."""
    return tmp_path / "forge-state.json"


@pytest.fixture
def manager(tmp_workspaces: Path, tmp_state_file: Path) -> LocalProcessPodManager:
    """Create a LocalProcessPodManager with temp directories."""
    return LocalProcessPodManager(
        workspaces_dir=str(tmp_workspaces),
        claude_binary="/usr/bin/fake-claude",
        max_concurrent=DEFAULT_MAX_CONCURRENT,
        sdk_port_start=DEFAULT_SDK_PORT_START,
        stop_timeout=DEFAULT_STOP_TIMEOUT,
        state_file=str(tmp_state_file),
    )


@pytest.fixture
def git_session() -> Session:
    """A session with git source."""
    return Session(
        id=uuid4(),
        name="test-session",
        source=GitSource(
            repo="https://github.com/niuulabs/example",
            branch="feat/test",
            base_branch="main",
        ),
    )


@pytest.fixture
def local_mount_session(tmp_path: Path) -> Session:
    """A session with local mount source."""
    mount_dir = tmp_path / "project"
    mount_dir.mkdir()
    return Session(
        id=uuid4(),
        name="local-session",
        source=LocalMountSource(
            paths=[
                MountMapping(
                    host_path=str(mount_dir),
                    mount_path="/workspace/project",
                ),
            ],
        ),
    )


@pytest.fixture
def default_spec() -> SessionSpec:
    """A minimal SessionSpec for tests."""
    return SessionSpec(
        values={"system_prompt": "You are a helpful assistant."},
        pod_spec=PodSpecAdditions(),
    )


WS = Path("/tmp/ws")


def _mock_provision(mgr: LocalProcessPodManager) -> patch:
    """Patch _provision_workspace to return a fake path."""
    return patch.object(
        mgr,
        "_provision_workspace",
        new_callable=AsyncMock,
        return_value=WS,
    )


def _mock_spawn(
    mgr: LocalProcessPodManager,
    pid: int = 42,
    side_effect: Exception | None = None,
) -> patch:
    """Patch _spawn_claude to return a fake PID."""
    kwargs: dict = {"new_callable": AsyncMock}
    if side_effect:
        kwargs["side_effect"] = side_effect
    else:
        kwargs["return_value"] = pid
    return patch.object(mgr, "_spawn_claude", **kwargs)


# ------------------------------------------------------------------
# SdkPortAllocator tests
# ------------------------------------------------------------------


class TestSdkPortAllocator:
    """Tests for the SDK port allocator."""

    def test_allocate_returns_start_port(self) -> None:
        """First allocation should return the start port when free."""
        alloc = SdkPortAllocator(start_port=59100)
        with patch.object(SdkPortAllocator, "_is_port_free", return_value=True):
            port = alloc.allocate()
        assert port == 59100

    def test_allocate_increments(self) -> None:
        """Successive allocations return incrementing ports."""
        alloc = SdkPortAllocator(start_port=59100)
        with patch.object(SdkPortAllocator, "_is_port_free", return_value=True):
            p1 = alloc.allocate()
            p2 = alloc.allocate()
        assert p1 == 59100
        assert p2 == 59101

    def test_release_frees_port(self) -> None:
        """Released ports are removed from the allocated set."""
        alloc = SdkPortAllocator(start_port=59100)
        with patch.object(SdkPortAllocator, "_is_port_free", return_value=True):
            port = alloc.allocate()
        assert port in alloc.allocated
        alloc.release(port)
        assert port not in alloc.allocated

    def test_allocate_skips_occupied_port(self) -> None:
        """Ports reported as not free are skipped."""
        alloc = SdkPortAllocator(start_port=59100)
        # First port busy, second free
        with patch.object(
            SdkPortAllocator,
            "_is_port_free",
            side_effect=[False, True],
        ):
            port = alloc.allocate()
        assert port == 59101

    def test_allocate_skips_already_allocated(self) -> None:
        """Already-allocated ports are skipped."""
        alloc = SdkPortAllocator(start_port=59100)
        with patch.object(SdkPortAllocator, "_is_port_free", return_value=True):
            p1 = alloc.allocate()
            p2 = alloc.allocate()
        assert p1 != p2

    def test_allocate_raises_when_exhausted(self) -> None:
        """Raises RuntimeError if no free port found in range."""
        alloc = SdkPortAllocator(start_port=59100)
        with patch.object(SdkPortAllocator, "_is_port_free", return_value=False):
            with pytest.raises(RuntimeError, match="No free SDK port found"):
                alloc.allocate()

    def test_is_port_free_real(self) -> None:
        """Integration test: _is_port_free works with real sockets."""
        # Pick a high ephemeral port that is very likely free
        assert SdkPortAllocator._is_port_free(59999) is True

    def test_release_nonexistent_port_is_noop(self) -> None:
        """Releasing a port that was never allocated is a no-op."""
        alloc = SdkPortAllocator(start_port=59100)
        alloc.release(59999)  # Should not raise


# ------------------------------------------------------------------
# Token injection tests
# ------------------------------------------------------------------


class TestTokenInjection:
    """Tests for _inject_token_into_url."""

    def test_github_url(self) -> None:
        url = _inject_token_into_url("https://github.com/org/repo", "tok123")
        assert url == "https://x-access-token:tok123@github.com/org/repo"

    def test_gitlab_url(self) -> None:
        url = _inject_token_into_url("https://gitlab.com/org/repo", "tok123")
        assert url == "https://x-access-token:tok123@gitlab.com/org/repo"

    def test_no_token(self) -> None:
        url = _inject_token_into_url("https://github.com/org/repo", "")
        assert url == "https://github.com/org/repo"

    def test_unknown_host(self) -> None:
        url = _inject_token_into_url("https://bitbucket.org/org/repo", "tok123")
        assert url == "https://bitbucket.org/org/repo"

    def test_ssh_url_unchanged(self) -> None:
        url = _inject_token_into_url("git@github.com:org/repo.git", "tok123")
        assert url == "git@github.com:org/repo.git"


# ------------------------------------------------------------------
# ProcessInfo serialization tests
# ------------------------------------------------------------------


class TestProcessInfo:
    """Tests for ProcessInfo serialization."""

    def test_to_dict(self) -> None:
        info = ProcessInfo(
            session_id="abc",
            pid=1234,
            port=9100,
            workspace="/tmp/ws",
            state=ProcessState.RUNNING,
        )
        d = info.to_dict()
        assert d["session_id"] == "abc"
        assert d["pid"] == 1234
        assert d["state"] == "running"

    def test_from_dict_roundtrip(self) -> None:
        info = ProcessInfo(
            session_id="abc",
            pid=1234,
            port=9100,
            workspace="/tmp/ws",
            state=ProcessState.RUNNING,
            error=None,
        )
        restored = ProcessInfo.from_dict(info.to_dict())
        assert restored.session_id == info.session_id
        assert restored.pid == info.pid
        assert restored.port == info.port
        assert restored.state == info.state

    def test_from_dict_defaults(self) -> None:
        info = ProcessInfo.from_dict({"session_id": "x"})
        assert info.pid is None
        assert info.port is None
        assert info.state == ProcessState.STOPPED


# ------------------------------------------------------------------
# Workspace provisioning tests
# ------------------------------------------------------------------


class TestWorkspaceProvisioning:
    """Tests for workspace creation and setup."""

    async def test_creates_workspace_dir(
        self,
        manager: LocalProcessPodManager,
        git_session: Session,
        default_spec: SessionSpec,
        tmp_workspaces: Path,
    ) -> None:
        """Workspace directory is created for the session."""
        with patch.object(manager, "_clone_repo", new_callable=AsyncMock):
            workspace = await manager._provision_workspace(git_session, default_spec)
        assert workspace.exists()
        assert workspace == tmp_workspaces / str(git_session.id)

    async def test_writes_claude_md(
        self,
        manager: LocalProcessPodManager,
        git_session: Session,
        default_spec: SessionSpec,
    ) -> None:
        """CLAUDE.md is written with system prompt."""
        with patch.object(manager, "_clone_repo", new_callable=AsyncMock):
            workspace = await manager._provision_workspace(git_session, default_spec)
        claude_md = workspace / "CLAUDE.md"
        assert claude_md.exists()
        content = claude_md.read_text()
        assert "You are a helpful assistant." in content

    async def test_writes_claude_md_with_initial_prompt(
        self,
        manager: LocalProcessPodManager,
        git_session: Session,
    ) -> None:
        """CLAUDE.md includes initial prompt when provided."""
        spec = SessionSpec(
            values={
                "system_prompt": "System.",
                "initial_prompt": "Do the thing.",
            },
            pod_spec=PodSpecAdditions(),
        )
        with patch.object(manager, "_clone_repo", new_callable=AsyncMock):
            workspace = await manager._provision_workspace(git_session, spec)
        content = (workspace / "CLAUDE.md").read_text()
        assert "Initial Task" in content
        assert "Do the thing." in content

    async def test_no_claude_md_when_no_prompts(
        self,
        manager: LocalProcessPodManager,
        git_session: Session,
    ) -> None:
        """No CLAUDE.md is written when there are no prompts."""
        spec = SessionSpec(values={}, pod_spec=PodSpecAdditions())
        with patch.object(manager, "_clone_repo", new_callable=AsyncMock):
            workspace = await manager._provision_workspace(git_session, spec)
        assert not (workspace / "CLAUDE.md").exists()

    async def test_local_mount_creates_symlinks(
        self,
        manager: LocalProcessPodManager,
        local_mount_session: Session,
        default_spec: SessionSpec,
    ) -> None:
        """Local mount source creates symlinks in workspace."""
        workspace = await manager._provision_workspace(local_mount_session, default_spec)
        source = local_mount_session.source
        assert isinstance(source, LocalMountSource)
        link = workspace / Path(source.paths[0].host_path).name
        assert link.is_symlink()

    async def test_local_mount_skips_nonexistent(
        self,
        manager: LocalProcessPodManager,
        default_spec: SessionSpec,
    ) -> None:
        """Non-existent mount paths are skipped."""
        session = Session(
            id=uuid4(),
            name="missing-mount",
            source=LocalMountSource(
                paths=[
                    MountMapping(
                        host_path="/nonexistent/path",
                        mount_path="/workspace/x",
                    ),
                ],
            ),
        )
        workspace = await manager._provision_workspace(session, default_spec)
        # Should not raise, just skip
        assert workspace.exists()


class TestAllowedMountPrefixes:
    """Tests for mount prefix validation."""

    def test_all_allowed_when_no_prefixes(
        self,
        manager: LocalProcessPodManager,
    ) -> None:
        assert manager._is_allowed_mount(Path("/any/path")) is True

    def test_allowed_prefix_match(
        self,
        tmp_workspaces: Path,
        tmp_state_file: Path,
    ) -> None:
        mgr = LocalProcessPodManager(
            workspaces_dir=str(tmp_workspaces),
            state_file=str(tmp_state_file),
            allowed_mount_prefixes=["/home/user/projects"],
        )
        assert mgr._is_allowed_mount(Path("/home/user/projects/repo")) is True

    def test_disallowed_prefix(
        self,
        tmp_workspaces: Path,
        tmp_state_file: Path,
    ) -> None:
        mgr = LocalProcessPodManager(
            workspaces_dir=str(tmp_workspaces),
            state_file=str(tmp_state_file),
            allowed_mount_prefixes=["/home/user/projects"],
        )
        assert mgr._is_allowed_mount(Path("/etc/secrets")) is False


# ------------------------------------------------------------------
# Git clone tests
# ------------------------------------------------------------------


class TestGitClone:
    """Tests for git clone and branch checkout."""

    async def test_clone_calls_git(
        self,
        manager: LocalProcessPodManager,
    ) -> None:
        """_clone_repo calls git clone with correct args."""
        source = GitSource(
            repo="https://github.com/org/repo",
            branch="feat",
            base_branch="main",
        )
        workspace = manager._workspaces_dir / "test-clone"
        workspace.mkdir(parents=True)

        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.communicate = AsyncMock(return_value=(b"", b""))

        checkout_proc = AsyncMock()
        checkout_proc.returncode = 0
        checkout_proc.communicate = AsyncMock(return_value=(b"", b""))

        spec = SessionSpec(
            values={"git_token": "tok123"},
            pod_spec=PodSpecAdditions(),
        )

        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_exec.side_effect = [mock_proc, checkout_proc]
            await manager._clone_repo(source, workspace, spec)

        clone_call = mock_exec.call_args_list[0]
        args = clone_call[0]
        assert "git" in args
        assert "clone" in args
        assert "x-access-token:tok123@github.com" in args[4]

    async def test_clone_failure_raises(
        self,
        manager: LocalProcessPodManager,
    ) -> None:
        """Git clone failure raises RuntimeError."""
        source = GitSource(repo="https://github.com/org/repo")
        workspace = manager._workspaces_dir / "fail-clone"
        workspace.mkdir(parents=True)
        spec = SessionSpec(values={}, pod_spec=PodSpecAdditions())

        mock_proc = AsyncMock()
        mock_proc.returncode = 1
        mock_proc.communicate = AsyncMock(return_value=(b"", b"fatal: error"))

        with (
            patch("asyncio.create_subprocess_exec", return_value=mock_proc),
            pytest.raises(RuntimeError, match="Git clone failed"),
        ):
            await manager._clone_repo(source, workspace, spec)

    async def test_branch_fallback_to_base(
        self,
        manager: LocalProcessPodManager,
    ) -> None:
        """Falls back to base_branch when feature branch checkout fails."""
        source = GitSource(
            repo="https://github.com/org/repo",
            branch="feat/missing",
            base_branch="main",
        )
        workspace = manager._workspaces_dir / "fallback"
        workspace.mkdir(parents=True)
        spec = SessionSpec(values={}, pod_spec=PodSpecAdditions())

        clone_proc = AsyncMock()
        clone_proc.returncode = 0
        clone_proc.communicate = AsyncMock(return_value=(b"", b""))

        # First checkout fails (feature branch), second succeeds (base)
        fail_proc = AsyncMock()
        fail_proc.returncode = 1
        fail_proc.communicate = AsyncMock(return_value=(b"", b""))

        ok_proc = AsyncMock()
        ok_proc.returncode = 0
        ok_proc.communicate = AsyncMock(return_value=(b"", b""))

        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_exec.side_effect = [clone_proc, fail_proc, ok_proc]
            await manager._clone_repo(source, workspace, spec)

        # 3 calls: clone, checkout feat, checkout main
        assert mock_exec.call_count == 3


# ------------------------------------------------------------------
# Process spawning tests
# ------------------------------------------------------------------


class TestProcessSpawning:
    """Tests for Claude process spawning."""

    async def test_spawn_claude_returns_pid(
        self,
        manager: LocalProcessPodManager,
        git_session: Session,
        default_spec: SessionSpec,
        tmp_workspaces: Path,
    ) -> None:
        """_spawn_claude returns the PID of the subprocess."""
        workspace = tmp_workspaces / str(git_session.id)
        workspace.mkdir(parents=True)

        mock_proc = MagicMock()
        mock_proc.pid = 42

        with (
            patch.object(manager, "_resolve_claude_binary", return_value="/usr/bin/fake-claude"),
            patch("asyncio.create_subprocess_exec", new_callable=AsyncMock, return_value=mock_proc),
        ):
            pid = await manager._spawn_claude(git_session, default_spec, workspace, 9100)

        assert pid == 42

    async def test_spawn_sets_sdk_url_arg(
        self,
        manager: LocalProcessPodManager,
        git_session: Session,
        default_spec: SessionSpec,
        tmp_workspaces: Path,
    ) -> None:
        """The --sdk-url argument is passed to the Claude binary."""
        workspace = tmp_workspaces / str(git_session.id)
        workspace.mkdir(parents=True)

        mock_proc = MagicMock()
        mock_proc.pid = 42

        with (
            patch.object(
                manager,
                "_resolve_claude_binary",
                return_value="/usr/bin/fake-claude",
            ),
            patch(
                "asyncio.create_subprocess_exec",
                new_callable=AsyncMock,
                return_value=mock_proc,
            ) as mock_exec,
        ):
            await manager._spawn_claude(git_session, default_spec, workspace, 9100)

        call_args = mock_exec.call_args[0]
        assert "--sdk-url" in call_args
        sdk_url_idx = call_args.index("--sdk-url")
        assert f"ws://127.0.0.1:9100/ws/cli/{git_session.id}" in call_args[sdk_url_idx + 1]

    def test_build_env_includes_api_key(self) -> None:
        """Environment includes ANTHROPIC_API_KEY when provided."""
        spec = SessionSpec(
            values={"anthropic_api_key": "sk-test"},
            pod_spec=PodSpecAdditions(),
        )
        env = LocalProcessPodManager._build_env(spec, Path("/tmp/ws"))
        assert env["ANTHROPIC_API_KEY"] == "sk-test"

    def test_build_env_includes_extra(self) -> None:
        """Extra env vars from spec are included."""
        spec = SessionSpec(
            values={"env": {"FOO": "bar", "NUM": 42}},
            pod_spec=PodSpecAdditions(),
        )
        env = LocalProcessPodManager._build_env(spec, Path("/tmp/ws"))
        assert env["FOO"] == "bar"
        assert env["NUM"] == "42"

    def test_build_env_sets_workspace_dir(self) -> None:
        """WORKSPACE_DIR is set in the environment."""
        spec = SessionSpec(values={}, pod_spec=PodSpecAdditions())
        env = LocalProcessPodManager._build_env(spec, Path("/tmp/ws"))
        assert env["WORKSPACE_DIR"] == "/tmp/ws"


class TestResolveClaude:
    """Tests for claude binary resolution."""

    def test_absolute_path_exists(
        self,
        manager: LocalProcessPodManager,
    ) -> None:
        with patch("os.path.isfile", return_value=True):
            result = manager._resolve_claude_binary()
        assert result == "/usr/bin/fake-claude"

    def test_absolute_path_missing_raises(
        self,
        tmp_workspaces: Path,
        tmp_state_file: Path,
    ) -> None:
        mgr = LocalProcessPodManager(
            workspaces_dir=str(tmp_workspaces),
            claude_binary="/nonexistent/claude",
            state_file=str(tmp_state_file),
        )
        with pytest.raises(FileNotFoundError, match="not found"):
            mgr._resolve_claude_binary()

    def test_path_lookup(
        self,
        tmp_workspaces: Path,
        tmp_state_file: Path,
    ) -> None:
        mgr = LocalProcessPodManager(
            workspaces_dir=str(tmp_workspaces),
            claude_binary="claude",
            state_file=str(tmp_state_file),
        )
        with patch("shutil.which", return_value="/usr/local/bin/claude"):
            result = mgr._resolve_claude_binary()
        assert result == "/usr/local/bin/claude"

    def test_path_lookup_fails(
        self,
        tmp_workspaces: Path,
        tmp_state_file: Path,
    ) -> None:
        mgr = LocalProcessPodManager(
            workspaces_dir=str(tmp_workspaces),
            claude_binary="claude",
            state_file=str(tmp_state_file),
        )
        with (
            patch("shutil.which", return_value=None),
            pytest.raises(FileNotFoundError, match="not found in PATH"),
        ):
            mgr._resolve_claude_binary()


# ------------------------------------------------------------------
# Full start / stop lifecycle tests
# ------------------------------------------------------------------


class TestStartStop:
    """Tests for the full start/stop lifecycle."""

    async def test_start_returns_pod_start_result(
        self,
        manager: LocalProcessPodManager,
        git_session: Session,
        default_spec: SessionSpec,
    ) -> None:
        """start() returns a PodStartResult with correct endpoints."""
        with (
            _mock_provision(manager),
            _mock_spawn(manager),
        ):
            result = await manager.start(git_session, default_spec)

        assert isinstance(result, PodStartResult)
        assert "ws://127.0.0.1:" in result.chat_endpoint
        assert str(git_session.id) in result.chat_endpoint
        assert result.code_endpoint == "file:///tmp/ws"
        assert result.pod_name.startswith("local-")

    async def test_start_tracks_process(
        self,
        manager: LocalProcessPodManager,
        git_session: Session,
        default_spec: SessionSpec,
    ) -> None:
        """start() stores process info in the internal dict."""
        with (
            _mock_provision(manager),
            _mock_spawn(manager),
        ):
            await manager.start(git_session, default_spec)

        session_id = str(git_session.id)
        assert session_id in manager._processes
        assert manager._processes[session_id].pid == 42
        assert manager._processes[session_id].state == ProcessState.RUNNING

    async def test_stop_terminates_process(
        self,
        manager: LocalProcessPodManager,
        git_session: Session,
        default_spec: SessionSpec,
    ) -> None:
        """stop() calls _terminate_process and releases the port."""
        with (
            _mock_provision(manager),
            _mock_spawn(manager),
        ):
            await manager.start(git_session, default_spec)

        with patch.object(manager, "_terminate_process", new_callable=AsyncMock) as mock_term:
            result = await manager.stop(git_session)

        assert result is True
        mock_term.assert_called_once_with(42)
        info = manager._processes[str(git_session.id)]
        assert info.state == ProcessState.STOPPED

    async def test_stop_unknown_session(
        self,
        manager: LocalProcessPodManager,
    ) -> None:
        """stop() returns False for unknown sessions."""
        session = Session(id=uuid4(), name="unknown")
        result = await manager.stop(session)
        assert result is False

    async def test_stop_already_stopped(
        self,
        manager: LocalProcessPodManager,
        git_session: Session,
        default_spec: SessionSpec,
    ) -> None:
        """stop() returns True for already-stopped sessions."""
        with (
            _mock_provision(manager),
            _mock_spawn(manager),
        ):
            await manager.start(git_session, default_spec)

        with patch.object(manager, "_terminate_process", new_callable=AsyncMock):
            await manager.stop(git_session)

        result = await manager.stop(git_session)
        assert result is True

    async def test_max_concurrent_enforced(
        self,
        tmp_workspaces: Path,
        tmp_state_file: Path,
    ) -> None:
        """start() raises when max concurrent sessions reached."""
        mgr = LocalProcessPodManager(
            workspaces_dir=str(tmp_workspaces),
            claude_binary="/usr/bin/fake-claude",
            max_concurrent=1,
            state_file=str(tmp_state_file),
        )
        session1 = Session(id=uuid4(), name="s1")
        session2 = Session(id=uuid4(), name="s2")
        spec = SessionSpec(values={}, pod_spec=PodSpecAdditions())

        with (
            _mock_provision(mgr),
            _mock_spawn(mgr),
        ):
            await mgr.start(session1, spec)
            with pytest.raises(RuntimeError, match="Max concurrent sessions"):
                await mgr.start(session2, spec)

    async def test_start_failure_releases_port(
        self,
        manager: LocalProcessPodManager,
        git_session: Session,
        default_spec: SessionSpec,
    ) -> None:
        """If spawn fails, port is released and state is FAILED."""
        err = RuntimeError("spawn failed")
        with (
            _mock_provision(manager),
            _mock_spawn(manager, side_effect=err),
            pytest.raises(RuntimeError, match="spawn failed"),
        ):
            await manager.start(git_session, default_spec)

        info = manager._processes[str(git_session.id)]
        assert info.state == ProcessState.FAILED
        assert info.port not in manager._port_allocator.allocated


# ------------------------------------------------------------------
# Status and wait_for_ready tests
# ------------------------------------------------------------------


class TestStatus:
    """Tests for status() and wait_for_ready()."""

    async def test_status_unknown_session(
        self,
        manager: LocalProcessPodManager,
    ) -> None:
        session = Session(id=uuid4(), name="unknown")
        assert await manager.status(session) == SessionStatus.STOPPED

    async def test_status_running(
        self,
        manager: LocalProcessPodManager,
        git_session: Session,
        default_spec: SessionSpec,
    ) -> None:
        with (
            _mock_provision(manager),
            _mock_spawn(manager),
        ):
            await manager.start(git_session, default_spec)

        assert await manager.status(git_session) == SessionStatus.RUNNING

    async def test_status_after_stop(
        self,
        manager: LocalProcessPodManager,
        git_session: Session,
        default_spec: SessionSpec,
    ) -> None:
        with (
            _mock_provision(manager),
            _mock_spawn(manager),
        ):
            await manager.start(git_session, default_spec)

        with patch.object(manager, "_terminate_process", new_callable=AsyncMock):
            await manager.stop(git_session)

        assert await manager.status(git_session) == SessionStatus.STOPPED

    async def test_wait_for_ready_already_running(
        self,
        manager: LocalProcessPodManager,
        git_session: Session,
        default_spec: SessionSpec,
    ) -> None:
        with (
            _mock_provision(manager),
            _mock_spawn(manager),
        ):
            await manager.start(git_session, default_spec)

        result = await manager.wait_for_ready(git_session, timeout=5.0)
        assert result == SessionStatus.RUNNING

    async def test_wait_for_ready_unknown_session(
        self,
        manager: LocalProcessPodManager,
    ) -> None:
        session = Session(id=uuid4(), name="unknown")
        result = await manager.wait_for_ready(session, timeout=1.0)
        assert result == SessionStatus.FAILED

    async def test_wait_for_ready_timeout(
        self,
        manager: LocalProcessPodManager,
        git_session: Session,
    ) -> None:
        """Timeout returns FAILED."""
        sid = str(git_session.id)
        manager._processes[sid] = ProcessInfo(
            session_id=sid,
            state=ProcessState.STARTING,
        )
        result = await manager.wait_for_ready(git_session, timeout=0.6)
        assert result == SessionStatus.FAILED


# ------------------------------------------------------------------
# Shutdown sequence tests
# ------------------------------------------------------------------


class TestShutdownSequence:
    """Tests for SIGTERM -> SIGKILL shutdown."""

    async def test_sigterm_then_exit(
        self,
        manager: LocalProcessPodManager,
    ) -> None:
        """SIGTERM is sent and process exits before timeout."""
        with patch("os.kill") as mock_kill:
            # SIGTERM succeeds, then process is gone
            mock_kill.side_effect = [None, OSError("No such process")]
            await manager._terminate_process(1234)

        mock_kill.assert_any_call(1234, signal.SIGTERM)

    async def test_sigkill_after_timeout(
        self,
        tmp_workspaces: Path,
        tmp_state_file: Path,
    ) -> None:
        """SIGKILL is sent when process doesn't exit after SIGTERM."""
        mgr = LocalProcessPodManager(
            workspaces_dir=str(tmp_workspaces),
            claude_binary="/usr/bin/fake-claude",
            stop_timeout=1,
            state_file=str(tmp_state_file),
        )

        call_count = 0

        def kill_side_effect(pid: int, sig: int) -> None:
            nonlocal call_count
            call_count += 1
            if sig == signal.SIGKILL:
                return
            # Process stays alive for all SIGTERM and probe calls
            return

        with patch("os.kill", side_effect=kill_side_effect):
            await mgr._terminate_process(1234)

        # Should have called SIGTERM + probes + SIGKILL
        assert call_count >= 3

    async def test_sigterm_oserror_returns(
        self,
        manager: LocalProcessPodManager,
    ) -> None:
        """OSError on SIGTERM means process already gone."""
        with patch("os.kill", side_effect=OSError("No such process")):
            await manager._terminate_process(1234)
        # Should not raise


# ------------------------------------------------------------------
# State persistence tests
# ------------------------------------------------------------------


class TestStatePersistence:
    """Tests for JSON state file persistence and recovery."""

    def test_persist_creates_file(
        self,
        manager: LocalProcessPodManager,
        tmp_state_file: Path,
    ) -> None:
        manager._processes["abc"] = ProcessInfo(
            session_id="abc",
            pid=1234,
            port=9100,
            state=ProcessState.RUNNING,
        )
        manager._persist_state()
        assert tmp_state_file.exists()
        data = json.loads(tmp_state_file.read_text())
        assert "abc" in data
        assert data["abc"]["pid"] == 1234

    def test_load_marks_dead_as_stopped(
        self,
        tmp_workspaces: Path,
        tmp_state_file: Path,
    ) -> None:
        """On load, running sessions with dead processes are marked stopped."""
        data = {
            "sess1": {
                "session_id": "sess1",
                "pid": 999999,
                "port": 9100,
                "workspace": "/tmp/ws",
                "state": "running",
            }
        }
        tmp_state_file.write_text(json.dumps(data))

        mgr = LocalProcessPodManager(
            workspaces_dir=str(tmp_workspaces),
            state_file=str(tmp_state_file),
        )
        assert mgr._processes["sess1"].state == ProcessState.STOPPED

    def test_load_corrupt_file(
        self,
        tmp_workspaces: Path,
        tmp_state_file: Path,
    ) -> None:
        """Corrupt state file is handled gracefully."""
        tmp_state_file.write_text("not json{{{")
        mgr = LocalProcessPodManager(
            workspaces_dir=str(tmp_workspaces),
            state_file=str(tmp_state_file),
        )
        assert len(mgr._processes) == 0

    def test_load_missing_file(
        self,
        tmp_workspaces: Path,
        tmp_state_file: Path,
    ) -> None:
        """Missing state file is handled gracefully."""
        mgr = LocalProcessPodManager(
            workspaces_dir=str(tmp_workspaces),
            state_file=str(tmp_state_file),
        )
        assert len(mgr._processes) == 0

    async def test_persist_state_on_start(
        self,
        manager: LocalProcessPodManager,
        git_session: Session,
        default_spec: SessionSpec,
        tmp_state_file: Path,
    ) -> None:
        """State file is updated after start."""
        with (
            _mock_provision(manager),
            _mock_spawn(manager),
        ):
            await manager.start(git_session, default_spec)

        assert tmp_state_file.exists()
        data = json.loads(tmp_state_file.read_text())
        assert str(git_session.id) in data


# ------------------------------------------------------------------
# Process monitor tests
# ------------------------------------------------------------------


class TestProcessMonitor:
    """Tests for the process monitoring task."""

    async def test_monitor_detects_exit(
        self,
        manager: LocalProcessPodManager,
    ) -> None:
        """Monitor updates state when process exits."""
        sid = "monitor-test"
        manager._processes[sid] = ProcessInfo(
            session_id=sid,
            pid=99999,
            port=9100,
            state=ProcessState.RUNNING,
        )
        manager._port_allocator._allocated.add(9100)

        with patch("os.kill", side_effect=OSError("No such process")):
            await manager._monitor_process(sid, 99999)

        assert manager._processes[sid].state == ProcessState.STOPPED
        assert 9100 not in manager._port_allocator.allocated

    async def test_monitor_cancellation(
        self,
        manager: LocalProcessPodManager,
    ) -> None:
        """Monitor handles cancellation gracefully."""
        sid = "cancel-test"
        manager._processes[sid] = ProcessInfo(
            session_id=sid,
            pid=99999,
            state=ProcessState.RUNNING,
        )

        # Kill always succeeds (process alive), so monitor loops
        with patch("os.kill", return_value=None):
            task = asyncio.create_task(manager._monitor_process(sid, 99999))
            await asyncio.sleep(0.1)
            task.cancel()
            # Monitor catches CancelledError and returns cleanly
            await task
        # State should remain RUNNING (not updated on cancel)
        assert manager._processes[sid].state == ProcessState.RUNNING


# ------------------------------------------------------------------
# Constructor / config tests
# ------------------------------------------------------------------


class TestConstructor:
    """Tests for constructor and configuration."""

    def test_default_values(
        self,
        tmp_workspaces: Path,
        tmp_state_file: Path,
    ) -> None:
        mgr = LocalProcessPodManager(
            workspaces_dir=str(tmp_workspaces),
            state_file=str(tmp_state_file),
        )
        assert mgr._max_concurrent == DEFAULT_MAX_CONCURRENT
        assert mgr._stop_timeout == DEFAULT_STOP_TIMEOUT
        assert mgr._claude_binary == DEFAULT_CLAUDE_BINARY

    def test_extra_kwargs_ignored(
        self,
        tmp_workspaces: Path,
        tmp_state_file: Path,
    ) -> None:
        """Extra kwargs from dynamic config are ignored."""
        mgr = LocalProcessPodManager(
            workspaces_dir=str(tmp_workspaces),
            state_file=str(tmp_state_file),
            unknown_key="should not raise",
        )
        assert mgr._max_concurrent == DEFAULT_MAX_CONCURRENT

    def test_expanduser_paths(self) -> None:
        """Paths with ~ are expanded."""
        with patch("pathlib.Path.exists", return_value=False):
            mgr = LocalProcessPodManager(
                workspaces_dir="~/test-ws",
                state_file="~/test-state.json",
            )
        assert "~" not in str(mgr._workspaces_dir)
        assert "~" not in str(mgr._state_file)
