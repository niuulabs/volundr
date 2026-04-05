"""Bash command validation pipeline — 5-stage security analysis.

Each stage returns a :class:`StageAllow`, :class:`StageDeny`, or
:class:`StageWarn`.  The pipeline runs stages in order:

1. Mode validation   — READ_ONLY whitelist; WORKSPACE_WRITE / PROMPT guards.
2. Sed validation    — block ``sed -i`` (in-place) in READ_ONLY mode.
3. Destructive check — always-blocked patterns (rm -rf /, mkfs, fork bombs …).
4. Path validation   — warn on ``../``, ``~``, ``$HOME``, absolute paths
                        outside the workspace.
5. Intent class.     — tag the command with a :class:`CommandIntent`.

Stages run in order; the first :class:`StageDeny` causes early exit.
:class:`StageWarn` results are accumulated and surfaced in the
:class:`PipelineResult`; they do NOT stop execution.

Usage::

    validator = BashValidationPipeline()
    result = validator.validate("ls /tmp", mode="read_only")
    if not result.allowed:
        raise PermissionError(result.deny_reason)
    for w in result.warnings:
        log.warning(w)
"""

from __future__ import annotations

import re
import shlex
from dataclasses import dataclass
from pathlib import Path

from ravn.ports.permission import CommandIntent

# ---------------------------------------------------------------------------
# Stage result types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class StageAllow:
    """Stage result: proceed normally."""


@dataclass(frozen=True)
class StageDeny:
    """Stage result: command is blocked."""

    reason: str


@dataclass(frozen=True)
class StageWarn:
    """Stage result: proceed but surface a warning to the caller."""

    message: str


StageResult = StageAllow | StageDeny | StageWarn


# ---------------------------------------------------------------------------
# Pipeline result
# ---------------------------------------------------------------------------


@dataclass
class PipelineResult:
    """Outcome of running the full validation pipeline."""

    allowed: bool
    deny_reason: str | None
    warnings: list[str]
    intent: CommandIntent


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Commands allowed in READ_ONLY mode (first token after sudo-unwrapping).
_READ_ONLY_WHITELIST: frozenset[str] = frozenset(
    {
        "grep",
        "egrep",
        "fgrep",
        "rg",
        "cat",
        "ls",
        "ll",
        "la",
        "head",
        "tail",
        "wc",
        "find",
        "stat",
        "file",
        "which",
        "type",
        "pwd",
        "echo",
        "printf",
        "diff",
        "sort",
        "uniq",
        "comm",
        "locate",
        "dir",
        "date",
        "whoami",
        "id",
        "env",
        "printenv",
        "uname",
        "hostname",
        # git — subcommand checked separately
        "git",
    }
)

# Git subcommands safe in READ_ONLY mode.
_GIT_READ_SUBCOMMANDS: frozenset[str] = frozenset(
    {
        "status",
        "log",
        "diff",
        "show",
        "branch",
        "tag",
        "stash",
        "remote",
        "fetch",
        "ls-files",
        "ls-tree",
        "cat-file",
        "rev-parse",
        "rev-list",
        "blame",
        "describe",
        "shortlog",
        "help",
        "version",
    }
)

# System paths that trigger warnings in WORKSPACE_WRITE mode.
_SYSTEM_PATH_WARN_PREFIXES: tuple[str, ...] = (
    "/etc",
    "/usr",
    "/var",
    "/boot",
    "/sys",
    "/proc",
)

# Patterns that are ALWAYS blocked regardless of mode.
_ALWAYS_BLOCKED: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\brm\s+.*-[a-zA-Z]*r[a-zA-Z]*\s+/\s*$"), "rm -rf / (root wipe)"),
    (re.compile(r"\brm\s+.*-[a-zA-Z]*r[a-zA-Z]*\s+/\b"), "rm -rf on critical path"),
    (re.compile(r"\bmkfs\b"), "mkfs (filesystem format)"),
    (re.compile(r"\bdd\s+if="), "dd if= (disk copy/wipe)"),
    (re.compile(r"\bdd\b.*\bof=/dev/(sd|hd|nvme|vd)"), "dd to block device"),
    (re.compile(r"\bchmod\s+-R\s+777\b"), "chmod -R 777 (world-writable)"),
    (re.compile(r":\s*\(\s*\)\s*\{"), "fork bomb"),
    (re.compile(r"\bshred\b"), "shred (secure wipe)"),
    (re.compile(r"\bwipefs\b"), "wipefs (wipe filesystem signatures)"),
    (re.compile(r"\bfdisk\b"), "fdisk (partition editor)"),
    (re.compile(r"\bparted\b"), "parted (partition editor)"),
    (re.compile(r"\binsmod\b"), "insmod (kernel module load)"),
    (re.compile(r"\brmmod\b"), "rmmod (kernel module remove)"),
    (re.compile(r"\bmodprobe\b"), "modprobe (kernel module management)"),
    (re.compile(r"\bcrontab\s+-r\b"), "crontab -r (crontab wipe)"),
    (re.compile(r">\s*/dev/(sd|hd|nvme|vd|mem|kmem)"), "redirect to block device"),
    (re.compile(r"\bhistory\s+-[cw]\b"), "history clear/write"),
]

# sed in-place flag pattern.
_SED_INPLACE: re.Pattern[str] = re.compile(r"\bsed\b.*\s-[a-zA-Z]*i[a-zA-Z]*\b")

# Path traversal / home-dir patterns — warn, not deny.
_PATH_WARN_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\.\./"), "path traversal: ../"),
    (re.compile(r"\$HOME\b"), "home-dir reference: $HOME"),
    (re.compile(r"\$\{?HOME\}?"), "home-dir reference: ${HOME}"),
    (re.compile(r"~(?:/|$)"), "home-dir reference: ~/"),
]

# Network commands.
_NETWORK_COMMANDS: frozenset[str] = frozenset(
    {
        "curl",
        "wget",
        "ssh",
        "scp",
        "sftp",
        "rsync",
        "nc",
        "netcat",
        "ncat",
        "ftp",
        "telnet",
        "ping",
        "traceroute",
        "dig",
        "nslookup",
        "host",
    }
)

# Process-management commands.
_PROCESS_MGMT_COMMANDS: frozenset[str] = frozenset(
    {
        "kill",
        "killall",
        "pkill",
        "pgrep",
        "ps",
        "top",
        "htop",
        "jobs",
        "bg",
        "fg",
        "wait",
        "nohup",
        "nice",
        "renice",
        "timeout",
        "watch",
        "strace",
        "ltrace",
        "gdb",
        "lsof",
    }
)

# Package-management commands.
_PACKAGE_MGMT_COMMANDS: frozenset[str] = frozenset(
    {
        "apt",
        "apt-get",
        "dpkg",
        "yum",
        "dnf",
        "rpm",
        "zypper",
        "pacman",
        "brew",
        "pip",
        "pip3",
        "pip3.12",
        "npm",
        "npx",
        "yarn",
        "pnpm",
        "gem",
        "cargo",
        "go",
        "conda",
        "mamba",
        "poetry",
        "uv",
    }
)

# System-admin commands.
_SYSTEM_ADMIN_COMMANDS: frozenset[str] = frozenset(
    {
        "systemctl",
        "service",
        "mount",
        "umount",
        "chown",
        "chmod",
        "chgrp",
        "useradd",
        "userdel",
        "usermod",
        "groupadd",
        "groupdel",
        "passwd",
        "visudo",
        "iptables",
        "ufw",
        "firewall-cmd",
        "setenforce",
        "sysctl",
        "ulimit",
        "swapoff",
        "swapon",
        "reboot",
        "shutdown",
        "halt",
        "poweroff",
        "init",
    }
)

# Write-intent commands that aren't destructive.
_WRITE_COMMANDS: frozenset[str] = frozenset(
    {
        "cp",
        "mv",
        "mkdir",
        "touch",
        "tee",
        "install",
        "ln",
        "truncate",
        "sed",
        "awk",
        "perl",
        "python",
        "python3",
        "python3.12",
        "ruby",
        "node",
        "bash",
        "sh",
        "zsh",
        "fish",
        "ksh",
        "make",
        "cmake",
    }
)

# Git subcommands that mutate state.
_GIT_WRITE_SUBCOMMANDS: frozenset[str] = frozenset(
    {
        "add",
        "commit",
        "push",
        "pull",
        "merge",
        "rebase",
        "reset",
        "restore",
        "checkout",
        "switch",
        "apply",
        "am",
        "cherry-pick",
        "revert",
        "clean",
        "init",
        "clone",
        "stash",
        "config",
        "submodule",
    }
)

# Destructive (but not always-blocked) commands.
_DESTRUCTIVE_COMMANDS: frozenset[str] = frozenset({"rm", "rmdir"})


# ---------------------------------------------------------------------------
# BashValidationPipeline
# ---------------------------------------------------------------------------


class BashValidationPipeline:
    """Five-stage bash command validation pipeline.

    Instantiate once and call :meth:`validate` for each command::

        pipeline = BashValidationPipeline()
        result = pipeline.validate("ls .", mode="read_only")
    """

    def validate(
        self,
        command: str,
        mode: str,
        workspace_root: Path | None = None,
    ) -> PipelineResult:
        """Run all five validation stages and return a :class:`PipelineResult`.

        Args:
            command:        The shell command string to validate.
            mode:           Permission mode string (``"read_only"``,
                            ``"workspace_write"``, ``"full_access"``,
                            ``"prompt"``).
            workspace_root: Optional workspace root used for Stage 4 path
                            boundary checks.  Defaults to CWD when *None*.
        """
        warnings: list[str] = []

        # Stage 3 runs first because it is unconditional ("always blocked regardless
        # of mode").  The spec numbers it 3 but its semantics are higher priority.
        s3 = self._stage3_destructive(command)
        if isinstance(s3, StageDeny):
            return PipelineResult(
                allowed=False,
                deny_reason=s3.reason,
                warnings=warnings,
                intent=CommandIntent.DESTRUCTIVE,
            )

        # Stage 1 — mode validation (includes sudo unwrapping)
        s1 = self._stage1_mode(command, mode)
        if isinstance(s1, StageDeny):
            return PipelineResult(
                allowed=False,
                deny_reason=s1.reason,
                warnings=warnings,
                intent=CommandIntent.UNKNOWN,
            )
        if isinstance(s1, StageWarn):
            warnings.append(s1.message)

        # Stage 2 — sed in-place editing
        s2 = self._stage2_sed(command, mode)
        if isinstance(s2, StageDeny):
            return PipelineResult(
                allowed=False,
                deny_reason=s2.reason,
                warnings=warnings,
                intent=CommandIntent.UNKNOWN,
            )
        if isinstance(s2, StageWarn):
            warnings.append(s2.message)

        # Stage 4 — path validation (warns only)
        for w in self._stage4_paths(command, workspace_root):
            warnings.append(w)

        # Stage 5 — intent classification
        intent = self._stage5_classify(command)

        return PipelineResult(
            allowed=True,
            deny_reason=None,
            warnings=warnings,
            intent=intent,
        )

    # ------------------------------------------------------------------
    # Stage 1 — mode validation
    # ------------------------------------------------------------------

    def _stage1_mode(self, command: str, mode: str) -> StageResult:
        inner = self._unwrap_sudo(command)

        if mode in ("full_access", "allow_all"):
            return StageAllow()

        if mode == "deny_all":
            return StageDeny("mode=deny_all blocks all commands")

        if mode == "prompt":
            return StageWarn(f"command requires interactive confirmation: {inner!r}")

        if mode == "read_only":
            return self._check_read_only_whitelist(inner)

        if mode == "workspace_write":
            return self._check_workspace_write(command)

        return StageDeny(f"unknown permission mode: {mode!r}")

    def _check_read_only_whitelist(self, inner: str) -> StageResult:
        """Return Allow if *inner* is a read-only whitelisted command."""
        try:
            tokens = shlex.split(inner)
        except ValueError:
            return StageDeny(f"cannot parse command: {inner!r}")

        if not tokens:
            return StageAllow()

        cmd = tokens[0]
        if cmd not in _READ_ONLY_WHITELIST:
            return StageDeny(f"command {cmd!r} is not in the read_only whitelist")

        if cmd == "git":
            subcmd = tokens[1] if len(tokens) > 1 else ""
            if subcmd not in _GIT_READ_SUBCOMMANDS:
                return StageDeny(f"git subcommand {subcmd!r} is not allowed in read_only mode")

        return StageAllow()

    def _check_workspace_write(self, command: str) -> StageResult:
        """Warn if command references known system paths."""
        for prefix in _SYSTEM_PATH_WARN_PREFIXES:
            if re.search(rf"(?:^|\s|['\"]){re.escape(prefix)}(?:/|\s|['\"]|$)", command):
                return StageWarn(
                    f"command references system path {prefix!r} — "
                    "proceed with caution in workspace_write mode"
                )
        return StageAllow()

    # ------------------------------------------------------------------
    # Stage 2 — sed in-place validation
    # ------------------------------------------------------------------

    def _stage2_sed(self, command: str, mode: str) -> StageResult:
        if not _SED_INPLACE.search(command):
            return StageAllow()

        if mode == "read_only":
            return StageDeny("sed -i (in-place edit) is not permitted in read_only mode")

        return StageWarn(
            "sed -i modifies files in-place — ensure the target is within your workspace"
        )

    # ------------------------------------------------------------------
    # Stage 3 — always-blocked destructive patterns
    # ------------------------------------------------------------------

    def _stage3_destructive(self, command: str) -> StageResult:
        for pattern, label in _ALWAYS_BLOCKED:
            if pattern.search(command):
                return StageDeny(f"blocked destructive command ({label})")
        return StageAllow()

    # ------------------------------------------------------------------
    # Stage 4 — path validation (warnings only)
    # ------------------------------------------------------------------

    def _stage4_paths(self, command: str, workspace_root: Path | None) -> list[str]:
        """Return a list of warning strings for suspicious path references."""
        ws_warnings: list[str] = []

        for pattern, label in _PATH_WARN_PATTERNS:
            if pattern.search(command):
                ws_warnings.append(f"path warning: {label}")

        # Warn on absolute paths that are outside the workspace root.
        if workspace_root is not None:
            ws_root_str = str(workspace_root.resolve())
            for match in re.finditer(r"(?:^|\s|['\"])(/[^\s'\"]+)", command):
                abs_path = match.group(1).rstrip("/")
                if not abs_path.startswith(ws_root_str):
                    ws_warnings.append(
                        f"path warning: absolute path {abs_path!r} "
                        f"is outside workspace {ws_root_str!r}"
                    )
                    break  # one warning per command is sufficient

        return ws_warnings

    # ------------------------------------------------------------------
    # Stage 5 — intent classification
    # ------------------------------------------------------------------

    def _stage5_classify(self, command: str) -> CommandIntent:
        """Classify the primary intent of *command*.

        Splits on pipeline operators to find the highest-risk intent.
        """
        parts = re.split(r"\|{1,2}|&&|;", command)
        intents = [self._classify_single(p.strip()) for p in parts if p.strip()]
        return self._highest_intent(intents)

    def _classify_single(self, command: str) -> CommandIntent:
        inner = self._unwrap_sudo(command)
        try:
            tokens = shlex.split(inner)
        except ValueError:
            return CommandIntent.UNKNOWN

        if not tokens:
            return CommandIntent.READ_ONLY

        cmd = tokens[0]

        if cmd == "sudo":
            return CommandIntent.SYSTEM_ADMIN

        if cmd in _DESTRUCTIVE_COMMANDS:
            return CommandIntent.DESTRUCTIVE

        if cmd in _SYSTEM_ADMIN_COMMANDS:
            return CommandIntent.SYSTEM_ADMIN

        if cmd in _PACKAGE_MGMT_COMMANDS:
            return CommandIntent.PACKAGE_MANAGEMENT

        if cmd in _NETWORK_COMMANDS:
            return CommandIntent.NETWORK

        if cmd in _PROCESS_MGMT_COMMANDS:
            return CommandIntent.PROCESS_MANAGEMENT

        if cmd == "git":
            subcmd = tokens[1] if len(tokens) > 1 else ""
            if subcmd in _GIT_WRITE_SUBCOMMANDS:
                return CommandIntent.WRITE
            return CommandIntent.READ_ONLY

        if cmd in _WRITE_COMMANDS:
            return CommandIntent.WRITE

        if cmd in _READ_ONLY_WHITELIST:
            return CommandIntent.READ_ONLY

        return CommandIntent.UNKNOWN

    def _highest_intent(self, intents: list[CommandIntent]) -> CommandIntent:
        """Return the highest-risk intent from *intents*."""
        priority = [
            CommandIntent.DESTRUCTIVE,
            CommandIntent.SYSTEM_ADMIN,
            CommandIntent.PACKAGE_MANAGEMENT,
            CommandIntent.NETWORK,
            CommandIntent.PROCESS_MANAGEMENT,
            CommandIntent.WRITE,
            CommandIntent.UNKNOWN,
            CommandIntent.READ_ONLY,
        ]
        for intent in priority:
            if intent in intents:
                return intent
        return CommandIntent.READ_ONLY

    # ------------------------------------------------------------------
    # Shared helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _unwrap_sudo(command: str) -> str:
        """Strip leading ``sudo [flags]`` tokens recursively."""
        try:
            tokens = shlex.split(command)
        except ValueError:
            return command

        while tokens and tokens[0] == "sudo":
            tokens = tokens[1:]
            while tokens and tokens[0].startswith("-"):
                if tokens[0] in ("-u", "-g", "-H", "-R", "-T"):
                    tokens = tokens[2:] if len(tokens) > 1 else []
                else:
                    tokens = tokens[1:]

        return shlex.join(tokens) if tokens else command
