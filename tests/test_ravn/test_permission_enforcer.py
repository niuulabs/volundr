"""Comprehensive unit tests for the PermissionEnforcer (NIU-455).

Coverage targets:
- All four permission modes × every tool type (bash, file write, file read, other)
- Explicit allow / deny / ask config lists
- Ordered rules (first match wins)
- File write boundary enforcement (workspace, system paths)
- Audit trail recording
- check_bash() and check_file_write() public API
- record_approval() integration with ApprovalMemory
- PermissionPort.check() backward-compatible API
- BashValidator via PermissionEnforcer.check_bash()
- BashValidator system-path denial
- BashValidator sed workspace_write → NeedsApproval
- _redact_args helper (sensitive key redaction)
"""

from __future__ import annotations

from pathlib import Path

import pytest

from ravn.adapters.approval_memory import ApprovalMemory
from ravn.adapters.permission_enforcer import (
    BashValidator,
    PermissionEnforcer,
    _redact_args,
)
from ravn.config import PermissionConfig, PermissionRuleConfig
from ravn.ports.permission import Allow, Deny, NeedsApproval

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _cfg(mode: str = "workspace_write", **kwargs) -> PermissionConfig:
    return PermissionConfig(mode=mode, **kwargs)


def _enforcer(
    mode: str = "workspace_write",
    workspace_root: Path | None = None,
    approval_memory: ApprovalMemory | None = None,
    **kwargs,
) -> PermissionEnforcer:
    cfg = _cfg(mode=mode, **kwargs)
    return PermissionEnforcer(
        cfg,
        workspace_root=workspace_root or Path("/workspace"),
        approval_memory=approval_memory,
    )


# ===========================================================================
# _redact_args helper
# ===========================================================================


class TestRedactArgs:
    def test_redacts_api_key(self) -> None:
        result = _redact_args({"api_key": "secret-value", "other": "visible"})
        assert result["api_key"] == "[REDACTED]"
        assert result["other"] == "visible"

    def test_redacts_password(self) -> None:
        result = _redact_args({"password": "hunter2"})
        assert result["password"] == "[REDACTED]"

    def test_redacts_nested_token(self) -> None:
        result = _redact_args({"config": {"token": "abc123", "host": "localhost"}})
        assert result["config"]["token"] == "[REDACTED]"
        assert result["config"]["host"] == "localhost"

    def test_non_sensitive_key_preserved(self) -> None:
        result = _redact_args({"command": "ls -la", "path": "/workspace"})
        assert result["command"] == "ls -la"
        assert result["path"] == "/workspace"

    def test_empty_args(self) -> None:
        assert _redact_args({}) == {}

    def test_redacts_secret_key(self) -> None:
        result = _redact_args({"secret": "topsecret"})
        assert result["secret"] == "[REDACTED]"

    def test_redacts_credential_key(self) -> None:
        result = _redact_args({"credential": "xyz"})
        assert result["credential"] == "[REDACTED]"


# ===========================================================================
# BashValidator (used via PermissionEnforcer.check_bash)
# ===========================================================================


class TestBashValidatorViaEnforcer:
    """Test BashValidator behaviour through the PermissionEnforcer API."""

    def test_check_bash_allows_read_command_in_workspace_write(self) -> None:
        enforcer = _enforcer(mode="workspace_write")
        decision = enforcer.check_bash("ls .")
        assert isinstance(decision, Allow)

    def test_check_bash_allows_write_command_in_workspace_write(self) -> None:
        enforcer = _enforcer(mode="workspace_write")
        decision = enforcer.check_bash("touch file.txt")
        assert isinstance(decision, Allow)

    def test_check_bash_denies_destructive_always(self) -> None:
        enforcer = _enforcer(mode="full_access")
        decision = enforcer.check_bash("rm -rf /")
        assert isinstance(decision, Deny)

    def test_check_bash_denies_path_traversal(self) -> None:
        enforcer = _enforcer(mode="workspace_write")
        decision = enforcer.check_bash("cat ../../etc/passwd")
        assert isinstance(decision, Deny)

    def test_check_bash_denies_system_path(self) -> None:
        enforcer = _enforcer(mode="workspace_write")
        decision = enforcer.check_bash("cat /etc/passwd")
        assert isinstance(decision, Deny)

    def test_check_bash_denies_system_path_bin(self) -> None:
        enforcer = _enforcer(mode="workspace_write")
        decision = enforcer.check_bash("ls /bin")
        assert isinstance(decision, Deny)

    def test_check_bash_sed_inplace_workspace_write_needs_approval(self) -> None:
        enforcer = _enforcer(mode="workspace_write")
        decision = enforcer.check_bash("sed -i 's/foo/bar/' file.txt")
        assert isinstance(decision, NeedsApproval)

    def test_check_bash_sed_inplace_read_only_denies(self) -> None:
        enforcer = _enforcer(mode="read_only")
        decision = enforcer.check_bash("sed -i 's/foo/bar/' file.txt")
        assert isinstance(decision, Deny)

    def test_check_bash_network_command_workspace_write_needs_approval(self) -> None:
        enforcer = _enforcer(mode="workspace_write")
        decision = enforcer.check_bash("curl https://example.com")
        assert isinstance(decision, NeedsApproval)


# ===========================================================================
# BashValidator standalone
# ===========================================================================


class TestBashValidatorStandalone:
    def test_rm_classified_as_destructive(self) -> None:
        validator = BashValidator()
        from ravn.ports.permission import CommandIntent

        intent = validator.classify("rm file.txt")
        assert intent == CommandIntent.DESTRUCTIVE

    def test_classify_pipeline_takes_highest_risk(self) -> None:
        validator = BashValidator()
        from ravn.ports.permission import CommandIntent

        # grep | rm — destructive wins
        intent = validator.classify("grep foo bar | rm file.txt")
        assert intent == CommandIntent.DESTRUCTIVE

    def test_validate_fork_bomb_denied(self) -> None:
        validator = BashValidator()
        decision = validator.validate(":(){ :|:& };:", mode="full_access")
        assert isinstance(decision, Deny)

    def test_validate_mkfs_denied_full_access(self) -> None:
        validator = BashValidator()
        decision = validator.validate("mkfs.ext4 /dev/sda", mode="full_access")
        assert isinstance(decision, Deny)

    def test_validate_empty_command_read_only(self) -> None:
        validator = BashValidator()
        decision = validator.validate("", mode="read_only")
        # Empty command has no first token — should not deny on whitelist
        assert isinstance(decision, Allow)

    def test_validate_unknown_cmd_workspace_write_allows(self) -> None:
        validator = BashValidator()
        decision = validator.validate("mycustomtool --flag", mode="workspace_write")
        assert isinstance(decision, Allow)

    def test_validate_prompt_mode_allows_with_needs_approval(self) -> None:
        validator = BashValidator()
        decision = validator.validate("ls .", mode="prompt")
        assert isinstance(decision, NeedsApproval)

    def test_validate_deny_all_blocks(self) -> None:
        validator = BashValidator()
        decision = validator.validate("ls .", mode="deny_all")
        assert isinstance(decision, Deny)

    def test_validate_system_admin_full_access_needs_approval(self) -> None:
        validator = BashValidator()
        decision = validator.validate("systemctl restart nginx", mode="full_access")
        assert isinstance(decision, NeedsApproval)


# ===========================================================================
# PermissionEnforcer.check_file_write
# ===========================================================================


class TestCheckFileWrite:
    def test_allows_path_inside_workspace(self, tmp_path: Path) -> None:
        enforcer = _enforcer(workspace_root=tmp_path)
        decision = enforcer.check_file_write(str(tmp_path / "file.txt"), tmp_path)
        assert isinstance(decision, Allow)

    def test_denies_path_outside_workspace(self, tmp_path: Path) -> None:
        enforcer = _enforcer(workspace_root=tmp_path)
        outside = tmp_path.parent / "other_workspace" / "file.txt"
        decision = enforcer.check_file_write(str(outside), tmp_path)
        assert isinstance(decision, Deny)

    def test_denies_path_traversal(self, tmp_path: Path) -> None:
        enforcer = _enforcer(workspace_root=tmp_path)
        # A resolved path like /tmp -> will resolve out of tmp_path
        decision = enforcer.check_file_write(str(tmp_path / ".." / "evil.txt"), tmp_path)
        assert isinstance(decision, Deny)

    def test_denies_binary_existing_file(self, tmp_path: Path) -> None:
        binary_file = tmp_path / "binary.bin"
        binary_file.write_bytes(b"\x00\x01\x02\x03" * 1024)
        enforcer = _enforcer(workspace_root=tmp_path)
        decision = enforcer.check_file_write(str(binary_file), tmp_path)
        assert isinstance(decision, Deny)
        assert "binary" in decision.reason.lower()

    def test_allows_text_existing_file(self, tmp_path: Path) -> None:
        text_file = tmp_path / "text.txt"
        text_file.write_text("hello world")
        enforcer = _enforcer(workspace_root=tmp_path)
        decision = enforcer.check_file_write(str(text_file), tmp_path)
        assert isinstance(decision, Allow)

    def test_allows_nonexistent_file_inside_workspace(self, tmp_path: Path) -> None:
        enforcer = _enforcer(workspace_root=tmp_path)
        decision = enforcer.check_file_write(str(tmp_path / "new_file.txt"), tmp_path)
        assert isinstance(decision, Allow)


# ===========================================================================
# Mode × tool type matrix
# ===========================================================================


class TestModeToolTypeMatrix:
    """All four modes × all tool categories: bash, file write, file read, other."""

    # ------------------------------------------------------------------
    # read_only
    # ------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_read_only_bash_read_command_allowed(self) -> None:
        enforcer = _enforcer(mode="read_only")
        decision = await enforcer.evaluate("bash", {"command": "ls ."})
        assert isinstance(decision, Allow)

    @pytest.mark.asyncio
    async def test_read_only_bash_write_command_denied(self) -> None:
        enforcer = _enforcer(mode="read_only")
        decision = await enforcer.evaluate("bash", {"command": "rm file.txt"})
        assert isinstance(decision, Deny)

    @pytest.mark.asyncio
    async def test_read_only_bash_no_command_denied(self) -> None:
        enforcer = _enforcer(mode="read_only")
        decision = await enforcer.evaluate("bash", {"command": ""})
        assert isinstance(decision, Deny)

    @pytest.mark.asyncio
    async def test_read_only_file_write_denied(self, tmp_path: Path) -> None:
        enforcer = _enforcer(mode="read_only", workspace_root=tmp_path)
        decision = await enforcer.evaluate("write_file", {"path": str(tmp_path / "out.txt")})
        assert isinstance(decision, Deny)

    @pytest.mark.asyncio
    async def test_read_only_file_read_allowed(self, tmp_path: Path) -> None:
        enforcer = _enforcer(mode="read_only", workspace_root=tmp_path)
        decision = await enforcer.evaluate("read_file", {"path": str(tmp_path / "in.txt")})
        assert isinstance(decision, Allow)

    @pytest.mark.asyncio
    async def test_read_only_other_tool_denied(self) -> None:
        enforcer = _enforcer(mode="read_only")
        decision = await enforcer.evaluate("custom_tool", {})
        assert isinstance(decision, Deny)

    # ------------------------------------------------------------------
    # workspace_write
    # ------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_workspace_write_bash_read_allowed(self) -> None:
        enforcer = _enforcer(mode="workspace_write")
        decision = await enforcer.evaluate("bash", {"command": "grep foo bar.txt"})
        assert isinstance(decision, Allow)

    @pytest.mark.asyncio
    async def test_workspace_write_bash_write_allowed(self) -> None:
        enforcer = _enforcer(mode="workspace_write")
        decision = await enforcer.evaluate("bash", {"command": "touch file.txt"})
        assert isinstance(decision, Allow)

    @pytest.mark.asyncio
    async def test_workspace_write_bash_network_needs_approval(self) -> None:
        enforcer = _enforcer(mode="workspace_write")
        decision = await enforcer.evaluate("bash", {"command": "curl https://example.com"})
        assert isinstance(decision, NeedsApproval)

    @pytest.mark.asyncio
    async def test_workspace_write_bash_pkg_mgmt_needs_approval(self) -> None:
        enforcer = _enforcer(mode="workspace_write")
        decision = await enforcer.evaluate("bash", {"command": "pip install requests"})
        assert isinstance(decision, NeedsApproval)

    @pytest.mark.asyncio
    async def test_workspace_write_bash_sysadmin_denied(self) -> None:
        enforcer = _enforcer(mode="workspace_write")
        decision = await enforcer.evaluate("bash", {"command": "systemctl restart nginx"})
        assert isinstance(decision, Deny)

    @pytest.mark.asyncio
    async def test_workspace_write_file_write_inside_workspace_allowed(
        self, tmp_path: Path
    ) -> None:
        enforcer = _enforcer(mode="workspace_write", workspace_root=tmp_path)
        decision = await enforcer.evaluate("write_file", {"path": str(tmp_path / "out.txt")})
        assert isinstance(decision, Allow)

    @pytest.mark.asyncio
    async def test_workspace_write_file_write_outside_workspace_denied(
        self, tmp_path: Path
    ) -> None:
        enforcer = _enforcer(mode="workspace_write", workspace_root=tmp_path)
        outside = tmp_path.parent / "other" / "out.txt"
        decision = await enforcer.evaluate("write_file", {"path": str(outside)})
        assert isinstance(decision, Deny)

    @pytest.mark.asyncio
    async def test_workspace_write_file_write_no_path_falls_through(self) -> None:
        enforcer = _enforcer(mode="workspace_write")
        decision = await enforcer.evaluate("write_file", {})
        assert isinstance(decision, Allow)

    @pytest.mark.asyncio
    async def test_workspace_write_file_read_allowed(self) -> None:
        enforcer = _enforcer(mode="workspace_write")
        decision = await enforcer.evaluate("read_file", {"path": "/workspace/file.txt"})
        assert isinstance(decision, Allow)

    @pytest.mark.asyncio
    async def test_workspace_write_other_tool_allowed(self) -> None:
        enforcer = _enforcer(mode="workspace_write")
        decision = await enforcer.evaluate("custom_tool", {})
        assert isinstance(decision, Allow)

    # ------------------------------------------------------------------
    # full_access
    # ------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_full_access_bash_read_allowed(self) -> None:
        enforcer = _enforcer(mode="full_access")
        decision = await enforcer.evaluate("bash", {"command": "ls ."})
        assert isinstance(decision, Allow)

    @pytest.mark.asyncio
    async def test_full_access_bash_write_allowed(self) -> None:
        enforcer = _enforcer(mode="full_access")
        decision = await enforcer.evaluate("bash", {"command": "touch file.txt"})
        assert isinstance(decision, Allow)

    @pytest.mark.asyncio
    async def test_full_access_bash_sysadmin_needs_approval(self) -> None:
        enforcer = _enforcer(mode="full_access")
        decision = await enforcer.evaluate("bash", {"command": "systemctl restart nginx"})
        assert isinstance(decision, NeedsApproval)

    @pytest.mark.asyncio
    async def test_full_access_bash_always_blocked_denied(self) -> None:
        enforcer = _enforcer(mode="full_access")
        decision = await enforcer.evaluate("bash", {"command": "rm -rf /"})
        assert isinstance(decision, Deny)

    @pytest.mark.asyncio
    async def test_full_access_file_write_allowed(self) -> None:
        enforcer = _enforcer(mode="full_access")
        decision = await enforcer.evaluate("write_file", {"path": "/workspace/file.txt"})
        assert isinstance(decision, Allow)

    @pytest.mark.asyncio
    async def test_full_access_other_tool_allowed(self) -> None:
        enforcer = _enforcer(mode="full_access")
        decision = await enforcer.evaluate("custom_tool", {})
        assert isinstance(decision, Allow)

    @pytest.mark.asyncio
    async def test_allow_all_alias_allowed(self) -> None:
        enforcer = _enforcer(mode="allow_all")
        decision = await enforcer.evaluate("custom_tool", {})
        assert isinstance(decision, Allow)

    # ------------------------------------------------------------------
    # prompt
    # ------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_prompt_bash_needs_approval(self) -> None:
        enforcer = _enforcer(mode="prompt")
        decision = await enforcer.evaluate("bash", {"command": "ls ."})
        assert isinstance(decision, NeedsApproval)

    @pytest.mark.asyncio
    async def test_prompt_bash_always_blocked_denied(self) -> None:
        enforcer = _enforcer(mode="prompt")
        decision = await enforcer.evaluate("bash", {"command": "rm -rf /"})
        assert isinstance(decision, Deny)

    @pytest.mark.asyncio
    async def test_prompt_file_write_needs_approval(self) -> None:
        enforcer = _enforcer(mode="prompt")
        decision = await enforcer.evaluate("write_file", {"path": "/workspace/file.txt"})
        assert isinstance(decision, NeedsApproval)

    @pytest.mark.asyncio
    async def test_prompt_other_tool_needs_approval(self) -> None:
        enforcer = _enforcer(mode="prompt")
        decision = await enforcer.evaluate("custom_tool", {})
        assert isinstance(decision, NeedsApproval)

    # ------------------------------------------------------------------
    # deny_all
    # ------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_deny_all_bash_denied(self) -> None:
        enforcer = _enforcer(mode="deny_all")
        decision = await enforcer.evaluate("bash", {"command": "ls ."})
        assert isinstance(decision, Deny)

    @pytest.mark.asyncio
    async def test_deny_all_file_write_denied(self) -> None:
        enforcer = _enforcer(mode="deny_all")
        decision = await enforcer.evaluate("write_file", {"path": "/workspace/file.txt"})
        assert isinstance(decision, Deny)

    @pytest.mark.asyncio
    async def test_deny_all_file_read_denied(self) -> None:
        enforcer = _enforcer(mode="deny_all")
        decision = await enforcer.evaluate("read_file", {})
        assert isinstance(decision, Deny)

    @pytest.mark.asyncio
    async def test_deny_all_other_tool_denied(self) -> None:
        enforcer = _enforcer(mode="deny_all")
        decision = await enforcer.evaluate("custom_tool", {})
        assert isinstance(decision, Deny)


# ===========================================================================
# Explicit config lists (deny / allow / ask)
# ===========================================================================


class TestExplicitConfigLists:
    @pytest.mark.asyncio
    async def test_deny_list_blocks_tool(self) -> None:
        enforcer = _enforcer(mode="full_access", deny=["dangerous_tool"])
        decision = await enforcer.evaluate("dangerous_tool", {})
        assert isinstance(decision, Deny)
        assert "deny list" in decision.reason

    @pytest.mark.asyncio
    async def test_allow_list_permits_tool_despite_restrictive_mode(self) -> None:
        enforcer = _enforcer(mode="read_only", allow=["special_read_write"])
        decision = await enforcer.evaluate("special_read_write", {})
        assert isinstance(decision, Allow)

    @pytest.mark.asyncio
    async def test_ask_list_prompts_for_tool(self) -> None:
        enforcer = _enforcer(mode="full_access", ask=["risky_tool"])
        decision = await enforcer.evaluate("risky_tool", {})
        assert isinstance(decision, NeedsApproval)


# ===========================================================================
# Ordered rules
# ===========================================================================


class TestOrderedRules:
    @pytest.mark.asyncio
    async def test_first_rule_wins(self) -> None:
        rules = [
            PermissionRuleConfig(pattern="my_tool", action="deny"),
            PermissionRuleConfig(pattern="my_tool", action="allow"),
        ]
        enforcer = _enforcer(mode="full_access", rules=rules)
        decision = await enforcer.evaluate("my_tool", {})
        assert isinstance(decision, Deny)

    @pytest.mark.asyncio
    async def test_allow_rule_overrides_restrictive_mode(self) -> None:
        rules = [PermissionRuleConfig(pattern="read_only_exception", action="allow")]
        enforcer = _enforcer(mode="read_only", rules=rules)
        decision = await enforcer.evaluate("read_only_exception", {})
        assert isinstance(decision, Allow)

    @pytest.mark.asyncio
    async def test_ask_rule(self) -> None:
        rules = [PermissionRuleConfig(pattern="needs_confirmation", action="ask")]
        enforcer = _enforcer(mode="full_access", rules=rules)
        decision = await enforcer.evaluate("needs_confirmation", {})
        assert isinstance(decision, NeedsApproval)

    @pytest.mark.asyncio
    async def test_rule_glob_pattern(self) -> None:
        rules = [PermissionRuleConfig(pattern="net_*", action="deny")]
        enforcer = _enforcer(mode="full_access", rules=rules)
        decision = await enforcer.evaluate("net_fetch", {})
        assert isinstance(decision, Deny)

    @pytest.mark.asyncio
    async def test_non_matching_rule_falls_through_to_mode(self) -> None:
        rules = [PermissionRuleConfig(pattern="other_tool", action="deny")]
        enforcer = _enforcer(mode="full_access", rules=rules)
        decision = await enforcer.evaluate("custom_tool", {})
        assert isinstance(decision, Allow)


# ===========================================================================
# Audit trail
# ===========================================================================


class TestAuditTrail:
    @pytest.mark.asyncio
    async def test_audit_log_accumulates_multiple_entries(self) -> None:
        enforcer = _enforcer(mode="full_access")
        for i in range(5):
            await enforcer.evaluate(f"tool_{i}", {})
        assert len(enforcer.audit_log) == 5

    @pytest.mark.asyncio
    async def test_audit_log_has_timestamp(self) -> None:
        enforcer = _enforcer(mode="full_access")
        await enforcer.evaluate("custom_tool", {})
        entry = enforcer.audit_log[0]
        assert entry.timestamp > 0


# ===========================================================================
# record_approval (ApprovalMemory integration)
# ===========================================================================


class TestRecordApproval:
    def test_record_approval_bash_tool(self, tmp_path: Path) -> None:
        memory = ApprovalMemory(project_root=tmp_path)
        enforcer = _enforcer(mode="prompt", approval_memory=memory)
        enforcer.record_approval("bash", {"command": "pip install requests"})
        assert memory.is_approved("pip install requests")

    def test_record_approval_non_bash_tool_ignored(self, tmp_path: Path) -> None:
        memory = ApprovalMemory(project_root=tmp_path)
        enforcer = _enforcer(mode="prompt", approval_memory=memory)
        enforcer.record_approval("write_file", {"path": "/workspace/file.txt"})
        # write_file is not a bash tool — nothing should be stored
        assert not memory.is_approved("/workspace/file.txt")

    def test_record_approval_no_memory_does_not_raise(self) -> None:
        enforcer = _enforcer(mode="prompt")  # no ApprovalMemory
        # Must not raise
        enforcer.record_approval("bash", {"command": "ls ."})

    @pytest.mark.asyncio
    async def test_auto_approve_previously_approved_command(self, tmp_path: Path) -> None:
        memory = ApprovalMemory(project_root=tmp_path)
        enforcer = _enforcer(mode="prompt", approval_memory=memory)

        # Record an approval
        enforcer.record_approval("bash", {"command": "pip install requests"})

        # Evaluating the same command should now auto-approve (Allow, not NeedsApproval)
        decision = await enforcer.evaluate("bash", {"command": "pip install requests"})
        assert isinstance(decision, Allow)

    @pytest.mark.asyncio
    async def test_unapproved_command_still_needs_approval(self, tmp_path: Path) -> None:
        memory = ApprovalMemory(project_root=tmp_path)
        enforcer = _enforcer(mode="prompt", approval_memory=memory)
        decision = await enforcer.evaluate("bash", {"command": "pip install requests"})
        assert isinstance(decision, NeedsApproval)


# ===========================================================================
# PermissionPort.check() backward-compatible API
# ===========================================================================


class TestPermissionPortCheck:
    @pytest.mark.asyncio
    async def test_check_allowed_permission_full_access(self) -> None:
        enforcer = _enforcer(mode="full_access")
        result = await enforcer.check("file:read")
        assert result is True

    @pytest.mark.asyncio
    async def test_check_denied_write_permission_read_only(self) -> None:
        enforcer = _enforcer(mode="read_only")
        result = await enforcer.check("file:write")
        assert result is False

    @pytest.mark.asyncio
    async def test_check_denied_bash_permission_read_only(self) -> None:
        enforcer = _enforcer(mode="read_only")
        result = await enforcer.check("bash:execute")
        assert result is False

    @pytest.mark.asyncio
    async def test_check_read_permission_allowed_in_read_only(self) -> None:
        enforcer = _enforcer(mode="read_only")
        result = await enforcer.check("file:read")
        assert result is True

    @pytest.mark.asyncio
    async def test_check_deny_all_returns_false(self) -> None:
        enforcer = _enforcer(mode="deny_all")
        result = await enforcer.check("file:read")
        assert result is False

    @pytest.mark.asyncio
    async def test_check_permission_in_explicit_deny_list(self) -> None:
        enforcer = _enforcer(mode="full_access", deny=["file:write"])
        result = await enforcer.check("file:write")
        assert result is False

    @pytest.mark.asyncio
    async def test_check_permission_in_explicit_allow_list(self) -> None:
        enforcer = _enforcer(mode="read_only", allow=["special:write"])
        result = await enforcer.check("special:write")
        assert result is True

    @pytest.mark.asyncio
    async def test_check_workspace_write_allows_most_permissions(self) -> None:
        enforcer = _enforcer(mode="workspace_write")
        result = await enforcer.check("file:read")
        assert result is True
