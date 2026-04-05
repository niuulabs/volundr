"""Unit tests for approval memory (NIU-508)."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from ravn.adapters.approval_memory import (
    _SCHEMA_VERSION,
    ApprovalEntry,
    ApprovalMemory,
    _find_git_root,
)
from ravn.adapters.permission_enforcer import PermissionEnforcer
from ravn.config import PermissionConfig
from ravn.ports.permission import Allow, Deny, NeedsApproval

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _memory(tmp_path: Path) -> ApprovalMemory:
    return ApprovalMemory(project_root=tmp_path)


def _enforcer_prompt(tmp_path: Path) -> PermissionEnforcer:
    cfg = PermissionConfig(mode="prompt")
    mem = _memory(tmp_path)
    return PermissionEnforcer(cfg, workspace_root=tmp_path, approval_memory=mem)


# ---------------------------------------------------------------------------
# ApprovalEntry
# ---------------------------------------------------------------------------


class TestApprovalEntry:
    def test_fields(self) -> None:
        e = ApprovalEntry(
            command="make build",
            pattern=re.escape("make build"),
            approved_at="2026-01-01T00:00:00+00:00",
        )
        assert e.command == "make build"
        assert e.auto_approved_count == 0

    def test_auto_approved_count_default(self) -> None:
        e = ApprovalEntry(command="ls", pattern="ls", approved_at="")
        assert e.auto_approved_count == 0


# ---------------------------------------------------------------------------
# _find_git_root
# ---------------------------------------------------------------------------


class TestFindGitRoot:
    def test_finds_root_in_git_repo(self) -> None:
        root = _find_git_root()
        assert root is None or isinstance(root, Path)

    def test_returns_none_outside_git(self, tmp_path: Path) -> None:
        root = _find_git_root(start=tmp_path)
        assert root is None


# ---------------------------------------------------------------------------
# ApprovalMemory — basic operations
# ---------------------------------------------------------------------------


class TestApprovalMemoryBasic:
    def test_empty_on_init(self, tmp_path: Path) -> None:
        mem = _memory(tmp_path)
        assert mem.list_entries() == []

    def test_storage_path(self, tmp_path: Path) -> None:
        mem = _memory(tmp_path)
        assert mem.storage_path == tmp_path / ".ravn" / "approvals.json"

    def test_is_approved_false_when_empty(self, tmp_path: Path) -> None:
        mem = _memory(tmp_path)
        assert not mem.is_approved("make build")

    def test_remember_stores_entry(self, tmp_path: Path) -> None:
        mem = _memory(tmp_path)
        mem.remember("make build")
        entries = mem.list_entries()
        assert len(entries) == 1
        assert entries[0].command == "make build"

    def test_remember_pattern_is_exact_escape(self, tmp_path: Path) -> None:
        mem = _memory(tmp_path)
        mem.remember("rm -rf ./build")
        entries = mem.list_entries()
        assert entries[0].pattern == re.escape("rm -rf ./build")

    def test_is_approved_after_remember(self, tmp_path: Path) -> None:
        mem = _memory(tmp_path)
        mem.remember("make test")
        assert mem.is_approved("make test")

    def test_is_approved_no_partial_match(self, tmp_path: Path) -> None:
        mem = _memory(tmp_path)
        mem.remember("make build")
        assert not mem.is_approved("make build --clean")
        assert not mem.is_approved("make")

    def test_remember_deduplicates(self, tmp_path: Path) -> None:
        mem = _memory(tmp_path)
        mem.remember("make build")
        mem.remember("make build")
        assert len(mem.list_entries()) == 1

    def test_remember_multiple_commands(self, tmp_path: Path) -> None:
        mem = _memory(tmp_path)
        mem.remember("make build")
        mem.remember("make test")
        assert len(mem.list_entries()) == 2

    def test_list_entries_returns_copy(self, tmp_path: Path) -> None:
        mem = _memory(tmp_path)
        mem.remember("ls")
        entries = mem.list_entries()
        entries.clear()
        assert len(mem.list_entries()) == 1


# ---------------------------------------------------------------------------
# ApprovalMemory — revoke
# ---------------------------------------------------------------------------


class TestApprovalMemoryRevoke:
    def test_revoke_by_command_returns_true(self, tmp_path: Path) -> None:
        mem = _memory(tmp_path)
        mem.remember("make build")
        removed = mem.revoke("make build")
        assert removed is True
        assert not mem.is_approved("make build")

    def test_revoke_by_pattern_returns_true(self, tmp_path: Path) -> None:
        mem = _memory(tmp_path)
        mem.remember("make build")
        pattern = mem.list_entries()[0].pattern
        removed = mem.revoke(pattern)
        assert removed is True
        assert len(mem.list_entries()) == 0

    def test_revoke_nonexistent_returns_false(self, tmp_path: Path) -> None:
        mem = _memory(tmp_path)
        assert mem.revoke("nonexistent") is False

    def test_revoke_leaves_others_intact(self, tmp_path: Path) -> None:
        mem = _memory(tmp_path)
        mem.remember("make build")
        mem.remember("make test")
        mem.revoke("make build")
        assert not mem.is_approved("make build")
        assert mem.is_approved("make test")


# ---------------------------------------------------------------------------
# ApprovalMemory — auto-approval counter
# ---------------------------------------------------------------------------


class TestApprovalMemoryAutoApproval:
    def test_record_auto_approval_increments(self, tmp_path: Path) -> None:
        mem = _memory(tmp_path)
        mem.remember("make build")
        mem.record_auto_approval("make build")
        assert mem.list_entries()[0].auto_approved_count == 1

    def test_record_auto_approval_multiple(self, tmp_path: Path) -> None:
        mem = _memory(tmp_path)
        mem.remember("make build")
        mem.record_auto_approval("make build")
        mem.record_auto_approval("make build")
        assert mem.list_entries()[0].auto_approved_count == 2

    def test_record_auto_approval_unknown_command_noop(self, tmp_path: Path) -> None:
        mem = _memory(tmp_path)
        mem.record_auto_approval("unknown command")


# ---------------------------------------------------------------------------
# ApprovalMemory — persistence
# ---------------------------------------------------------------------------


class TestApprovalMemoryPersistence:
    def test_saved_to_disk(self, tmp_path: Path) -> None:
        mem = _memory(tmp_path)
        mem.remember("make build")
        assert (tmp_path / ".ravn" / "approvals.json").exists()

    def test_loaded_from_disk(self, tmp_path: Path) -> None:
        mem1 = _memory(tmp_path)
        mem1.remember("make build")

        mem2 = _memory(tmp_path)
        assert mem2.is_approved("make build")

    def test_schema_version_written(self, tmp_path: Path) -> None:
        mem = _memory(tmp_path)
        mem.remember("ls")
        raw = json.loads((tmp_path / ".ravn" / "approvals.json").read_text())
        assert raw["version"] == _SCHEMA_VERSION

    def test_corrupted_file_handled_gracefully(self, tmp_path: Path) -> None:
        path = tmp_path / ".ravn" / "approvals.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("not json", encoding="utf-8")
        mem = _memory(tmp_path)
        assert mem.list_entries() == []

    def test_missing_dir_created_on_save(self, tmp_path: Path) -> None:
        ravn_dir = tmp_path / ".ravn"
        assert not ravn_dir.exists()
        mem = _memory(tmp_path)
        mem.remember("ls")
        assert ravn_dir.exists()

    def test_revoke_persists_to_disk(self, tmp_path: Path) -> None:
        mem1 = _memory(tmp_path)
        mem1.remember("make build")
        mem1.revoke("make build")

        mem2 = _memory(tmp_path)
        assert not mem2.is_approved("make build")

    def test_approved_at_timestamp_set(self, tmp_path: Path) -> None:
        mem = _memory(tmp_path)
        mem.remember("ls")
        entry = mem.list_entries()[0]
        assert entry.approved_at != ""

    def test_auto_approved_count_persists(self, tmp_path: Path) -> None:
        mem1 = _memory(tmp_path)
        mem1.remember("make build")
        mem1.record_auto_approval("make build")

        mem2 = _memory(tmp_path)
        assert mem2.list_entries()[0].auto_approved_count == 1


# ---------------------------------------------------------------------------
# PermissionEnforcer + ApprovalMemory integration
# ---------------------------------------------------------------------------


class TestEnforcerApprovalMemoryIntegration:
    @pytest.mark.asyncio
    async def test_prompt_mode_asks_first_time(self, tmp_path: Path) -> None:
        enforcer = _enforcer_prompt(tmp_path)
        result = await enforcer.evaluate("bash", {"command": "make build"})
        assert isinstance(result, NeedsApproval)

    @pytest.mark.asyncio
    async def test_prompt_mode_auto_approves_after_record(self, tmp_path: Path) -> None:
        enforcer = _enforcer_prompt(tmp_path)
        enforcer.record_approval("bash", {"command": "make build"})
        result = await enforcer.evaluate("bash", {"command": "make build"})
        assert isinstance(result, Allow)

    @pytest.mark.asyncio
    async def test_different_command_still_asks(self, tmp_path: Path) -> None:
        enforcer = _enforcer_prompt(tmp_path)
        enforcer.record_approval("bash", {"command": "make build"})
        result = await enforcer.evaluate("bash", {"command": "make test"})
        assert isinstance(result, NeedsApproval)

    @pytest.mark.asyncio
    async def test_auto_approval_increments_counter(self, tmp_path: Path) -> None:
        enforcer = _enforcer_prompt(tmp_path)
        mem: ApprovalMemory = enforcer._approval_memory  # type: ignore[assignment]
        enforcer.record_approval("bash", {"command": "make build"})
        await enforcer.evaluate("bash", {"command": "make build"})
        assert mem.list_entries()[0].auto_approved_count == 1

    @pytest.mark.asyncio
    async def test_record_approval_noop_without_memory(self, tmp_path: Path) -> None:
        cfg = PermissionConfig(mode="prompt")
        enforcer = PermissionEnforcer(cfg, workspace_root=tmp_path)
        enforcer.record_approval("bash", {"command": "make build"})

    @pytest.mark.asyncio
    async def test_record_approval_noop_for_non_bash_tool(self, tmp_path: Path) -> None:
        enforcer = _enforcer_prompt(tmp_path)
        mem: ApprovalMemory = enforcer._approval_memory  # type: ignore[assignment]
        enforcer.record_approval("write_file", {"path": "/workspace/foo.txt"})
        assert mem.list_entries() == []

    @pytest.mark.asyncio
    async def test_record_approval_noop_empty_command(self, tmp_path: Path) -> None:
        enforcer = _enforcer_prompt(tmp_path)
        mem: ApprovalMemory = enforcer._approval_memory  # type: ignore[assignment]
        enforcer.record_approval("bash", {"command": ""})
        assert mem.list_entries() == []

    @pytest.mark.asyncio
    async def test_workspace_write_mode_unaffected(self, tmp_path: Path) -> None:
        """Approval memory check only activates in prompt mode."""
        cfg = PermissionConfig(mode="workspace_write")
        mem = _memory(tmp_path)
        mem.remember("make build")
        enforcer = PermissionEnforcer(cfg, workspace_root=tmp_path, approval_memory=mem)
        result = await enforcer.evaluate("bash", {"command": "make build"})
        assert isinstance(result, Allow)

    @pytest.mark.asyncio
    async def test_always_blocked_still_denied_even_if_approved(self, tmp_path: Path) -> None:
        """Approval memory must never bypass always-blocked patterns."""
        enforcer = _enforcer_prompt(tmp_path)
        enforcer.record_approval("bash", {"command": "rm -rf /"})
        result = await enforcer.evaluate("bash", {"command": "rm -rf /"})
        assert isinstance(result, Deny)

    @pytest.mark.asyncio
    async def test_approval_persists_across_enforcer_instances(self, tmp_path: Path) -> None:
        """Approval stored by one enforcer is visible to a new one on the same project."""
        enforcer1 = _enforcer_prompt(tmp_path)
        enforcer1.record_approval("bash", {"command": "make build"})

        enforcer2 = _enforcer_prompt(tmp_path)
        result = await enforcer2.evaluate("bash", {"command": "make build"})
        assert isinstance(result, Allow)


# ---------------------------------------------------------------------------
# CLI approvals commands (smoke tests)
# ---------------------------------------------------------------------------


class _FixedMemory(ApprovalMemory):
    """ApprovalMemory subclass that always uses a fixed tmp_path."""

    _root: Path

    def __init__(self) -> None:  # type: ignore[override]
        super().__init__(project_root=self.__class__._root)


def _make_fixed_memory_cls(tmp_path: Path) -> type:
    cls = type("_FixedMemory", (_FixedMemory,), {"_root": tmp_path})
    return cls


class TestApprovalsCliCommands:
    def test_list_empty(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        from typer.testing import CliRunner

        import ravn.cli.commands as cmd_mod
        from ravn.cli.commands import approvals_app

        monkeypatch.setattr(cmd_mod, "ApprovalMemory", _make_fixed_memory_cls(tmp_path))
        runner = CliRunner()
        result = runner.invoke(approvals_app, ["list"])
        assert result.exit_code == 0
        assert "No approval patterns stored" in result.output

    def test_list_with_entries(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        from typer.testing import CliRunner

        import ravn.cli.commands as cmd_mod
        from ravn.cli.commands import approvals_app

        mem = ApprovalMemory(project_root=tmp_path)
        mem.remember("make build")

        monkeypatch.setattr(cmd_mod, "ApprovalMemory", _make_fixed_memory_cls(tmp_path))
        runner = CliRunner()
        result = runner.invoke(approvals_app, ["list"])
        assert result.exit_code == 0
        assert "make build" in result.output

    def test_revoke_existing(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        from typer.testing import CliRunner

        import ravn.cli.commands as cmd_mod
        from ravn.cli.commands import approvals_app

        mem = ApprovalMemory(project_root=tmp_path)
        mem.remember("make build")

        monkeypatch.setattr(cmd_mod, "ApprovalMemory", _make_fixed_memory_cls(tmp_path))
        runner = CliRunner()
        result = runner.invoke(approvals_app, ["revoke", "make build"])
        assert result.exit_code == 0
        assert "Revoked" in result.output

    def test_revoke_nonexistent_exits_1(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from typer.testing import CliRunner

        import ravn.cli.commands as cmd_mod
        from ravn.cli.commands import approvals_app

        monkeypatch.setattr(cmd_mod, "ApprovalMemory", _make_fixed_memory_cls(tmp_path))
        runner = CliRunner()
        result = runner.invoke(approvals_app, ["revoke", "nonexistent"])
        assert result.exit_code != 0
