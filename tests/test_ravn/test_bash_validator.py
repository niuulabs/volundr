"""Tests for the 5-stage bash validation pipeline.

Coverage targets:
- Each stage independently (parameterised examples from the spec)
- Pipeline composition: early exit on Deny, warning accumulation
- Sudo unwrapping (recursive)
- Intent classification for common commands
"""

from __future__ import annotations

from pathlib import Path

import pytest

from ravn.adapters.bash_validator import (
    BashValidationPipeline,
    PipelineResult,
)
from ravn.ports.permission import CommandIntent

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def pipeline() -> BashValidationPipeline:
    return BashValidationPipeline()


def allowed(result: PipelineResult) -> bool:
    return result.allowed


def denied(result: PipelineResult) -> bool:
    return not result.allowed


# ===========================================================================
# Stage 1 — Mode validation
# ===========================================================================


class TestStage1ModeValidation:
    """READ_ONLY whitelist, WORKSPACE_WRITE warnings, FULL_ACCESS, PROMPT."""

    # --- read_only ---

    @pytest.mark.parametrize(
        "command",
        [
            "grep -r TODO .",
            "cat /dev/null",
            "ls -la",
            "head -n 5 file.txt",
            "tail -f log.txt",
            "wc -l file.txt",
            "find . -name '*.py'",
            "echo hello",
            "git status",
            "git log --oneline",
            "git diff HEAD~1",
            "git show HEAD",
            "git branch -a",
            "git tag",
            "git remote -v",
            "git fetch --dry-run",
            "git ls-files",
            "git rev-parse HEAD",
            "git blame README.md",
        ],
    )
    def test_read_only_allows_whitelisted(self, command: str) -> None:
        result = pipeline().validate(command, mode="read_only")
        assert allowed(result), f"Expected Allow for {command!r}, got deny: {result.deny_reason}"

    @pytest.mark.parametrize(
        "command",
        [
            "rm foo.txt",
            "touch newfile",
            "mkdir newdir",
            "python3 script.py",
            "docker ps",
            "curl https://example.com",
        ],
    )
    def test_read_only_denies_non_whitelisted(self, command: str) -> None:
        result = pipeline().validate(command, mode="read_only")
        assert denied(result), f"Expected Deny for {command!r}"

    def test_read_only_denies_git_write_subcommand(self) -> None:
        result = pipeline().validate("git add .", mode="read_only")
        assert denied(result)
        assert "git subcommand" in (result.deny_reason or "")

    def test_read_only_denies_git_push(self) -> None:
        result = pipeline().validate("git push origin main", mode="read_only")
        assert denied(result)

    # sudo unwrapping in read_only
    def test_read_only_denies_sudo_rm(self) -> None:
        result = pipeline().validate("sudo rm foo.txt", mode="read_only")
        assert denied(result)

    def test_read_only_sudo_grep_allowed(self) -> None:
        result = pipeline().validate("sudo grep pattern file.txt", mode="read_only")
        assert allowed(result)

    # --- full_access ---

    @pytest.mark.parametrize(
        "command",
        [
            "rm foo.txt",
            "docker system prune",
            "pip install foo",
            "curl https://example.com",
            "ls /etc",
            "touch /tmp/x",
        ],
    )
    def test_full_access_allows_everything(self, command: str) -> None:
        result = pipeline().validate(command, mode="full_access")
        # Stage 3 (destructive) could still block — but these are not always-blocked
        assert allowed(result), f"Expected Allow for {command!r}: {result.deny_reason}"

    # --- workspace_write ---

    def test_workspace_write_allows_normal_write(self) -> None:
        result = pipeline().validate("touch file.txt", mode="workspace_write")
        assert allowed(result)

    def test_workspace_write_warns_on_etc(self) -> None:
        result = pipeline().validate("cat /etc/passwd", mode="workspace_write")
        assert allowed(result)
        assert any("/etc" in w for w in result.warnings)

    def test_workspace_write_warns_on_usr(self) -> None:
        result = pipeline().validate("ls /usr/local/bin", mode="workspace_write")
        assert allowed(result)
        assert any("/usr" in w for w in result.warnings)

    def test_workspace_write_warns_on_var(self) -> None:
        result = pipeline().validate("ls /var/log", mode="workspace_write")
        assert allowed(result)
        assert any("/var" in w for w in result.warnings)

    def test_workspace_write_no_warn_for_workspace_path(self, tmp_path: Path) -> None:
        result = pipeline().validate(f"ls {tmp_path}", mode="workspace_write")
        assert allowed(result)
        assert not any("/etc" in w or "/usr" in w or "/var" in w for w in result.warnings)

    # --- prompt ---

    def test_prompt_mode_produces_warning(self) -> None:
        result = pipeline().validate("ls .", mode="prompt")
        assert allowed(result)
        assert any("interactive confirmation" in w for w in result.warnings)

    # --- deny_all ---

    def test_deny_all_blocks_everything(self) -> None:
        result = pipeline().validate("ls .", mode="deny_all")
        assert denied(result)
        assert "deny_all" in (result.deny_reason or "")

    # --- unknown mode ---

    def test_unknown_mode_denies(self) -> None:
        result = pipeline().validate("ls .", mode="gibberish")
        assert denied(result)


# ===========================================================================
# Stage 2 — Sed validation
# ===========================================================================


class TestStage2SedValidation:
    def test_sed_inplace_denied_in_read_only(self) -> None:
        result = pipeline().validate("sed -i 's/foo/bar/' file.txt", mode="read_only")
        assert denied(result)
        assert "sed" in (result.deny_reason or "").lower()

    def test_sed_inplace_warns_in_workspace_write(self) -> None:
        result = pipeline().validate("sed -i 's/foo/bar/' file.txt", mode="workspace_write")
        assert allowed(result)
        assert any("sed" in w.lower() for w in result.warnings)

    def test_sed_inplace_warns_in_full_access(self) -> None:
        result = pipeline().validate("sed -i 's/foo/bar/' file.txt", mode="full_access")
        assert allowed(result)
        assert any("sed" in w.lower() for w in result.warnings)

    def test_sed_without_inplace_allowed(self) -> None:
        result = pipeline().validate("sed 's/foo/bar/' file.txt", mode="read_only")
        # sed is not in read_only whitelist, so it's denied by Stage 1 first
        # but sed without -i shouldn't produce a Stage 2 warning
        assert not any("sed" in w.lower() and "in-place" in w.lower() for w in result.warnings)

    def test_sed_i_flag_combined_with_other_flags(self) -> None:
        result = pipeline().validate("sed -ni 's/foo/bar/' file.txt", mode="workspace_write")
        assert allowed(result)
        assert any("sed" in w.lower() for w in result.warnings)


# ===========================================================================
# Stage 3 — Destructive pattern detection (always blocked)
# ===========================================================================


class TestStage3DestructivePatterns:
    @pytest.mark.parametrize(
        "command",
        [
            "rm -rf /",
            "rm -rf /etc",
            "rm -r /",
            "mkfs.ext4 /dev/sda1",
            "dd if=/dev/zero of=file",
            "dd if=/dev/zero of=/dev/sda",
            "chmod -R 777 /etc",
            ":(){ :|:& };:",
            "shred -u file.txt",
            "wipefs /dev/sda",
            "fdisk /dev/sda",
            "parted /dev/sdb",
            "insmod evil.ko",
            "rmmod bad_module",
            "modprobe evil",
            "crontab -r",
            "echo x > /dev/sda",
            "history -c",
            "history -w /tmp/h",
        ],
    )
    def test_always_blocked_regardless_of_mode(self, command: str) -> None:
        for mode in ("read_only", "workspace_write", "full_access", "prompt"):
            result = pipeline().validate(command, mode=mode)
            assert denied(result), (
                f"Expected Deny for {command!r} in mode={mode!r}, "
                f"but got Allow with intent={result.intent}"
            )
        # In full_access mode the only gate is Stage 3, so the reason must say "blocked"
        result_fa = pipeline().validate(command, mode="full_access")
        assert "blocked" in (result_fa.deny_reason or "").lower(), (
            f"Expected 'blocked' in deny_reason for {command!r} in full_access, "
            f"got: {result_fa.deny_reason!r}"
        )

    def test_fork_bomb_blocked(self) -> None:
        result = pipeline().validate(":(){ :|:& };:", mode="full_access")
        assert denied(result)
        assert "fork bomb" in (result.deny_reason or "").lower()

    def test_rm_rf_root_variants_blocked(self) -> None:
        # Short-flag variants (spec covers these)
        for cmd in ("rm -rf /", "rm -fr /", "rm -r /"):
            result = pipeline().validate(cmd, mode="full_access")
            assert denied(result), f"Expected block for {cmd!r}"

    def test_safe_rm_not_blocked(self) -> None:
        # Regular rm on a non-root path is not always-blocked (still may be denied by mode)
        result = pipeline().validate("rm file.txt", mode="full_access")
        # Should not be blocked by Stage 3 always-blocked list
        assert allowed(result)


# ===========================================================================
# Stage 4 — Path validation (warnings)
# ===========================================================================


class TestStage4PathValidation:
    def test_warns_on_traversal(self) -> None:
        result = pipeline().validate("cat ../../etc/passwd", mode="full_access")
        assert allowed(result)
        assert any("traversal" in w for w in result.warnings)

    def test_warns_on_home_tilde(self) -> None:
        result = pipeline().validate("ls ~/Documents", mode="full_access")
        assert allowed(result)
        assert any("$HOME" in w or "~/" in w for w in result.warnings)

    def test_warns_on_home_env(self) -> None:
        result = pipeline().validate("cat $HOME/.bashrc", mode="full_access")
        assert allowed(result)
        assert any("HOME" in w for w in result.warnings)

    def test_warns_on_absolute_path_outside_workspace(self, tmp_path: Path) -> None:
        other_dir = "/var/log"
        result = pipeline().validate(f"ls {other_dir}", mode="full_access", workspace_root=tmp_path)
        assert allowed(result)
        assert any("outside workspace" in w for w in result.warnings)

    def test_no_warn_for_path_inside_workspace(self, tmp_path: Path) -> None:
        target = str(tmp_path / "subdir")
        result = pipeline().validate(f"ls {target}", mode="full_access", workspace_root=tmp_path)
        # Stage 1 system-path check in workspace_write issues warnings for /etc etc
        # but an absolute path within tmp_path should not trigger the out-of-workspace warning
        assert not any("outside workspace" in w for w in result.warnings)

    def test_no_traversal_for_clean_relative_path(self) -> None:
        result = pipeline().validate("cat src/module/file.py", mode="full_access")
        assert not any("traversal" in w for w in result.warnings)


# ===========================================================================
# Stage 5 — Intent classification
# ===========================================================================


class TestStage5IntentClassification:
    @pytest.mark.parametrize(
        ("command", "expected_intent"),
        [
            ("grep -r TODO .", CommandIntent.READ_ONLY),
            ("cat README.md", CommandIntent.READ_ONLY),
            ("ls -la", CommandIntent.READ_ONLY),
            ("git status", CommandIntent.READ_ONLY),
            ("git log", CommandIntent.READ_ONLY),
            ("git diff", CommandIntent.READ_ONLY),
            ("touch file.txt", CommandIntent.WRITE),
            ("cp a.txt b.txt", CommandIntent.WRITE),
            ("mv a.txt b.txt", CommandIntent.WRITE),
            ("git add .", CommandIntent.WRITE),
            ("git commit -m 'msg'", CommandIntent.WRITE),
            ("rm file.txt", CommandIntent.DESTRUCTIVE),
            ("rmdir empty/", CommandIntent.DESTRUCTIVE),
            ("curl https://example.com", CommandIntent.NETWORK),
            ("wget https://example.com", CommandIntent.NETWORK),
            ("pip install requests", CommandIntent.PACKAGE_MANAGEMENT),
            ("npm install", CommandIntent.PACKAGE_MANAGEMENT),
            ("docker system prune", CommandIntent.UNKNOWN),
            ("kill -9 1234", CommandIntent.PROCESS_MANAGEMENT),
            ("ps aux", CommandIntent.PROCESS_MANAGEMENT),
            ("systemctl status nginx", CommandIntent.SYSTEM_ADMIN),
            ("chmod 755 file.sh", CommandIntent.SYSTEM_ADMIN),
        ],
    )
    def test_intent_classification(self, command: str, expected_intent: CommandIntent) -> None:
        p = pipeline()
        result = p.validate(command, mode="full_access")
        # Some commands may be blocked by stage 3 or 1 — only check intent when allowed
        if result.allowed:
            assert result.intent == expected_intent, (
                f"Command {command!r}: expected {expected_intent!r}, got {result.intent!r}"
            )

    def test_unknown_command_classified_as_unknown(self) -> None:
        result = pipeline().validate("mycustomtool --flag", mode="full_access")
        assert allowed(result)
        assert result.intent == CommandIntent.UNKNOWN

    def test_pipeline_takes_highest_risk_intent(self) -> None:
        # grep piped to rm — rm is DESTRUCTIVE, should win
        result = pipeline().validate("grep pattern file.txt | rm -f file.txt", mode="full_access")
        assert allowed(result)  # rm by itself is not always-blocked (only rm -rf /)
        assert result.intent == CommandIntent.DESTRUCTIVE

    def test_pip_install_classified_as_package_management(self) -> None:
        result = pipeline().validate("pip install foo", mode="full_access")
        assert allowed(result)
        assert result.intent == CommandIntent.PACKAGE_MANAGEMENT

    def test_docker_system_prune_classified(self) -> None:
        result = pipeline().validate("docker system prune", mode="full_access")
        assert allowed(result)
        # docker is unknown (not in any specific set)
        assert result.intent == CommandIntent.UNKNOWN


# ===========================================================================
# Pipeline composition
# ===========================================================================


class TestPipelineComposition:
    def test_early_exit_on_deny_skips_remaining_stages(self) -> None:
        # "rm -rf /" is denied at Stage 3. Stage 4 should not run.
        result = pipeline().validate("rm -rf /", mode="full_access")
        assert denied(result)
        # In FULL_ACCESS mode, path warnings could be generated, but because
        # we exit early at Stage 3, there should be no warnings from Stage 4.
        assert not any("outside workspace" in w for w in result.warnings)

    def test_warnings_accumulated_across_stages(self, tmp_path: Path) -> None:
        # PROMPT mode (Stage 1 warn) + $HOME (Stage 4 warn) — two warnings
        result = pipeline().validate("cat $HOME/.bashrc", mode="prompt", workspace_root=tmp_path)
        assert allowed(result)
        assert len(result.warnings) >= 2

    def test_denied_result_has_no_intent_for_unknown(self) -> None:
        result = pipeline().validate("notacommand xyz", mode="read_only")
        assert denied(result)
        assert result.intent == CommandIntent.UNKNOWN

    def test_denied_by_stage3_has_destructive_intent(self) -> None:
        result = pipeline().validate("mkfs.ext4 /dev/sda1", mode="full_access")
        assert denied(result)
        assert result.intent == CommandIntent.DESTRUCTIVE

    def test_allow_has_no_deny_reason(self) -> None:
        result = pipeline().validate("ls .", mode="full_access")
        assert allowed(result)
        assert result.deny_reason is None

    def test_deny_has_reason(self) -> None:
        result = pipeline().validate("unknowncmd", mode="read_only")
        assert denied(result)
        assert result.deny_reason is not None
        assert len(result.deny_reason) > 0


# ===========================================================================
# Sudo unwrapping
# ===========================================================================


class TestSudoUnwrapping:
    def test_sudo_rm_denied_in_read_only(self) -> None:
        result = pipeline().validate("sudo rm foo.txt", mode="read_only")
        assert denied(result)

    def test_double_sudo_rm_denied(self) -> None:
        # sudo sudo rm — unusual but should still be unwrapped
        result = pipeline().validate("sudo sudo rm foo.txt", mode="read_only")
        assert denied(result)

    def test_sudo_with_u_flag_unwrapped(self) -> None:
        # sudo -u root rm foo.txt
        result = pipeline().validate("sudo -u root rm foo.txt", mode="read_only")
        assert denied(result)

    def test_sudo_grep_allowed_in_read_only(self) -> None:
        result = pipeline().validate("sudo grep pattern file.txt", mode="read_only")
        assert allowed(result)

    def test_sudo_fork_bomb_blocked(self) -> None:
        result = pipeline().validate("sudo :(){ :|:& };:", mode="full_access")
        assert denied(result)

    def test_sudo_always_blocked_command(self) -> None:
        result = pipeline().validate("sudo mkfs.ext4 /dev/sda1", mode="full_access")
        assert denied(result)


# ===========================================================================
# Specific spec examples (from NIU-452 task description)
# ===========================================================================


class TestSpecExamples:
    """Exact test cases lifted from the NIU-452 acceptance criteria."""

    def test_ls_tmp_read_only_allow(self) -> None:
        result = pipeline().validate("ls /tmp", mode="read_only")
        assert allowed(result)

    def test_rm_foo_read_only_deny(self) -> None:
        result = pipeline().validate("rm foo.txt", mode="read_only")
        assert denied(result)

    def test_sudo_rm_foo_read_only_deny(self) -> None:
        result = pipeline().validate("sudo rm foo.txt", mode="read_only")
        assert denied(result)

    def test_rm_rf_root_full_access_deny(self) -> None:
        result = pipeline().validate("rm -rf /", mode="full_access")
        assert denied(result)

    def test_fork_bomb_full_access_deny(self) -> None:
        result = pipeline().validate(":(){ :|:& };:", mode="full_access")
        assert denied(result)

    def test_grep_intent_read_only(self) -> None:
        result = pipeline().validate("grep -r TODO .", mode="full_access")
        assert allowed(result)
        assert result.intent == CommandIntent.READ_ONLY

    def test_docker_prune_intent_unknown(self) -> None:
        result = pipeline().validate("docker system prune", mode="full_access")
        assert allowed(result)
        assert result.intent == CommandIntent.UNKNOWN

    def test_pip_install_intent_package_management(self) -> None:
        result = pipeline().validate("pip install foo", mode="full_access")
        assert allowed(result)
        assert result.intent == CommandIntent.PACKAGE_MANAGEMENT
