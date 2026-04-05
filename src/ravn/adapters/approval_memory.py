"""Approval memory — per-project persistent approval patterns for Ravn.

When the enforcer runs in ``prompt`` mode and the user explicitly approves a
command, that approval is persisted to ``.ravn/approvals.json`` at the git
root.  On subsequent evaluations the same command is auto-approved, and an
audit entry is written instead of asking again.

Pattern derivation
------------------
Conservative: the approved command is stored verbatim.  The ``pattern``
field is ``re.escape(command)`` anchored with ``re.fullmatch``, so
``rm -rf ./build`` matches *only* ``rm -rf ./build`` — never ``rm -rf ./other``.

Storage
-------
``.ravn/approvals.json`` at the git root.  Committing this file shares the
safe-list with the whole team.  New projects start with an empty file.
"""

from __future__ import annotations

import json
import logging
import re
import subprocess
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

logger = logging.getLogger(__name__)

_APPROVALS_RELATIVE = Path(".ravn") / "approvals.json"
_SCHEMA_VERSION = 1


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class ApprovalEntry:
    """One stored approval pattern."""

    command: str
    pattern: str
    approved_at: str
    auto_approved_count: int = 0


# ---------------------------------------------------------------------------
# Git root discovery
# ---------------------------------------------------------------------------


def _find_git_root(start: Path | None = None) -> Path | None:
    """Walk upward from *start* to locate the git repository root."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=True,
            cwd=str(start or Path.cwd()),
        )
        return Path(result.stdout.strip())
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


# ---------------------------------------------------------------------------
# ApprovalMemory
# ---------------------------------------------------------------------------


class ApprovalMemory:
    """Persistent, per-project approval memory backed by ``.ravn/approvals.json``.

    Each instance is scoped to a single project root — approvals never leak
    across projects.

    Thread-safety: not thread-safe; intended for single-agent sequential use.
    """

    def __init__(self, project_root: Path | None = None) -> None:
        root = project_root or _find_git_root() or Path.cwd()
        self._path: Path = root / _APPROVALS_RELATIVE
        self._entries: list[ApprovalEntry] = []
        self._load()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def storage_path(self) -> Path:
        """Absolute path to the backing JSON file."""
        return self._path

    def is_approved(self, command: str) -> bool:
        """Return True if *command* exactly matches any stored approval pattern."""
        for entry in self._entries:
            if re.fullmatch(entry.pattern, command):
                return True
        return False

    def remember(self, command: str) -> None:
        """Record an exact-match approval for *command*.

        Duplicate commands (already covered by a stored pattern) are silently
        ignored so the list stays deduplicated.
        """
        if self.is_approved(command):
            return
        entry = ApprovalEntry(
            command=command,
            pattern=re.escape(command),
            approved_at=datetime.now(UTC).isoformat(),
        )
        self._entries.append(entry)
        self._save()
        logger.debug("approval_memory: remembered %r", command)

    def record_auto_approval(self, command: str) -> None:
        """Increment the auto-approval counter for the entry matching *command*."""
        for entry in self._entries:
            if re.fullmatch(entry.pattern, command):
                entry.auto_approved_count += 1
                self._save()
                return

    def list_entries(self) -> list[ApprovalEntry]:
        """Return a shallow copy of all stored approval entries."""
        return list(self._entries)

    def revoke(self, pattern: str) -> bool:
        """Remove the entry whose ``pattern`` or ``command`` equals *pattern*.

        Returns True if an entry was found and removed, False otherwise.
        """
        before = len(self._entries)
        self._entries = [e for e in self._entries if e.pattern != pattern and e.command != pattern]
        removed = len(self._entries) < before
        if removed:
            self._save()
            logger.debug("approval_memory: revoked %r", pattern)
        return removed

    # ------------------------------------------------------------------
    # Persistence helpers
    # ------------------------------------------------------------------

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            for item in raw.get("patterns", []):
                self._entries.append(
                    ApprovalEntry(
                        command=item["command"],
                        pattern=item["pattern"],
                        approved_at=item.get("approved_at", ""),
                        auto_approved_count=item.get("auto_approved_count", 0),
                    )
                )
        except (json.JSONDecodeError, KeyError, OSError) as exc:
            logger.warning("approval_memory: failed to load %s: %s", self._path, exc)

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "version": _SCHEMA_VERSION,
            "patterns": [asdict(e) for e in self._entries],
        }
        self._path.write_text(json.dumps(data, indent=2), encoding="utf-8")
