"""Project context discovery for Ravn.

Walks from CWD up to the git root (or filesystem root) looking for
project context files. Discovered content is truncated, deduplicated,
and scanned for prompt injection before being injected into the system
prompt.

Context file priority (first match wins per directory level):
  1. .ravn.yaml
  2. RAVN.md
  3. CLAUDE.md  (compatibility)

Budget limits:
  PER_FILE_LIMIT  — maximum characters read from a single file
  TOTAL_BUDGET    — maximum characters of context returned overall
"""

from __future__ import annotations

import hashlib
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants (no magic numbers in business logic)
# ---------------------------------------------------------------------------

PER_FILE_LIMIT: int = 4_096
TOTAL_BUDGET: int = 12_288

_CONTEXT_FILENAMES: list[str] = [".ravn.yaml", "RAVN.md", "CLAUDE.md"]

# Patterns that suggest prompt injection attempts.
# We look for common injection markers in potential project files.
_INJECTION_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"<\s*/?system\s*>", re.IGNORECASE),
    re.compile(r"\[INST\]", re.IGNORECASE),
    re.compile(r"<<SYS>>", re.IGNORECASE),
    re.compile(r"ignore\s+(all\s+)?(previous|prior|above)\s+instructions?", re.IGNORECASE),
    re.compile(r"you\s+are\s+now\s+(?:a\s+)?(?:DAN|jailbroken|unrestricted)", re.IGNORECASE),
    re.compile(r"disregard\s+(your\s+)?(previous\s+)?instructions?", re.IGNORECASE),
    re.compile(r"new\s+prompt\s*:", re.IGNORECASE),
    re.compile(r"system\s+prompt\s*:", re.IGNORECASE),
]


# ---------------------------------------------------------------------------
# Public data types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ContextFile:
    """A single discovered context file."""

    path: Path
    content: str
    truncated: bool


@dataclass
class ProjectContext:
    """Aggregated project context discovered from the working directory."""

    files: list[ContextFile] = field(default_factory=list)
    total_chars: int = 0
    budget_exceeded: bool = False

    def as_text(self) -> str:
        """Render all context files as a single string for injection."""
        if not self.files:
            return ""
        parts: list[str] = []
        for ctx in self.files:
            header = f"# Context: {ctx.path.name}"
            if ctx.truncated:
                header += " (truncated)"
            parts.append(f"{header}\n\n{ctx.content}")
        return "\n\n---\n\n".join(parts)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _git_root(start: Path) -> Path | None:
    """Return the git repository root above *start*, or None if not in a repo."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=start,
            capture_output=True,
            text=True,
            check=True,
            timeout=5,
        )
        return Path(result.stdout.strip())
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        return None


def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _contains_injection(text: str) -> bool:
    """Return True if *text* matches any known prompt-injection pattern."""
    return any(pattern.search(text) for pattern in _INJECTION_PATTERNS)


def _read_truncated(path: Path, limit: int) -> tuple[str, bool]:
    """Read *path* up to *limit* characters.  Returns (content, truncated)."""
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return "", False
    if len(raw) <= limit:
        return raw, False
    return raw[:limit], True


def _candidate_dirs(start: Path) -> list[Path]:
    """Return directories to search, from *start* up to the git root (inclusive).

    If not in a git repo, walks all the way to the filesystem root.
    """
    root = _git_root(start)
    dirs: list[Path] = []
    current = start.resolve()
    while True:
        dirs.append(current)
        if root is not None and current == root.resolve():
            break
        parent = current.parent
        if parent == current:
            # Reached filesystem root.
            break
        current = parent
    return dirs


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def discover(
    cwd: Path | None = None,
    *,
    per_file_limit: int = PER_FILE_LIMIT,
    total_budget: int = TOTAL_BUDGET,
) -> ProjectContext:
    """Discover project context files starting from *cwd*.

    Walks from *cwd* toward the git root, collecting context files.
    Files are:
    - Read up to *per_file_limit* characters each
    - Deduplicated by content hash (same file symlinked elsewhere is skipped)
    - Scanned for prompt injection and silently dropped if suspicious
    - Accumulated until *total_budget* characters are consumed
    """
    start = Path(cwd) if cwd is not None else Path.cwd()
    ctx = ProjectContext()
    seen_hashes: set[str] = set()
    remaining = total_budget

    for directory in _candidate_dirs(start):
        for filename in _CONTEXT_FILENAMES:
            candidate = directory / filename
            if not candidate.is_file():
                continue

            content, truncated = _read_truncated(candidate, per_file_limit)
            if not content:
                continue

            digest = _content_hash(content)
            if digest in seen_hashes:
                continue
            seen_hashes.add(digest)

            if _contains_injection(content):
                continue

            if remaining <= 0:
                ctx.budget_exceeded = True
                break

            # Honour the remaining budget
            if len(content) > remaining:
                content = content[:remaining]
                truncated = True
                ctx.budget_exceeded = True

            ctx.files.append(ContextFile(path=candidate, content=content, truncated=truncated))
            ctx.total_chars += len(content)
            remaining -= len(content)

            # Only take the first matching filename per directory.
            break

    return ctx
