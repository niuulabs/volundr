"""Mímir domain models — shared between the Mímir service and Ravn adapters.

These types define the wire contract for all Mímir operations.  Both
``src/mimir/`` (the standalone service) and ``src/ravn/`` (adapters that call
the service) import from here so that neither module depends on the other.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Literal

import yaml

# ---------------------------------------------------------------------------
# Compiled-truth page taxonomy enums
# ---------------------------------------------------------------------------


class PageType(StrEnum):
    """Controlled vocabulary for the ``type`` frontmatter field."""

    directive = "directive"
    decision = "decision"
    goal = "goal"
    preference = "preference"
    observation = "observation"
    entity = "entity"
    topic = "topic"


class PageConfidence(StrEnum):
    """Epistemic confidence level for a Mímir page."""

    high = "high"
    medium = "medium"
    low = "low"


class EntityType(StrEnum):
    """Sub-type for pages whose ``type`` is ``entity``."""

    person = "person"
    project = "project"
    concept = "concept"
    technology = "technology"
    organization = "organization"
    strategy = "strategy"


def compute_content_hash(content: str) -> str:
    """Return the SHA-256 hex digest of *content*."""
    return hashlib.sha256(content.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Thread domain types
# ---------------------------------------------------------------------------


class ThreadState(StrEnum):
    """Lifecycle states for a Mímir thread."""

    open = "open"
    assigned = "assigned"
    pulling = "pulling"  # actively being worked by a Ravn instance
    closed = "closed"
    dissolved = "dissolved"


@dataclass
class ThreadContextRef:
    """A reference to an external context item (e.g. a conversation session)."""

    type: str  # e.g. "conversation", "wiki_page", "issue"
    id: str
    summary: str


class ThreadSchemaError(ValueError):
    """Raised when a thread YAML file fails validation."""


class ThreadOwnershipError(RuntimeError):
    """Raised when assign_thread_owner detects a conflicting owner."""

    def __init__(self, path: str, current_owner: str) -> None:
        super().__init__(f"Thread '{path}' already owned by '{current_owner}'")
        self.path = path
        self.current_owner = current_owner


# ---------------------------------------------------------------------------
# ThreadYamlSchema
# ---------------------------------------------------------------------------

_REQUIRED_FIELDS = (
    "title",
    "state",
    "weight",
    "created_at",
    "updated_at",
)


@dataclass
class ThreadYamlSchema:
    """Validated structure of a thread's ``{slug}.yaml`` file.

    Serialised to/from YAML for the hot-path queue and state transitions.
    """

    title: str
    state: ThreadState
    weight: float
    created_at: datetime
    updated_at: datetime
    owner_id: str | None = None
    next_action_hint: str | None = None
    resolved_artifact_path: str | None = None
    context_refs: list[ThreadContextRef] = field(default_factory=list)
    weight_signals: dict = field(default_factory=dict)

    # ------------------------------------------------------------------
    # Serialisation
    # ------------------------------------------------------------------

    @classmethod
    def from_yaml(cls, path: Path) -> ThreadYamlSchema:
        """Parse and validate a thread YAML file.

        Raises ``ThreadSchemaError`` on missing required fields, invalid
        ``state`` values, or malformed ISO-8601 dates.
        """
        try:
            raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except Exception as exc:
            raise ThreadSchemaError(f"Cannot read '{path}': {exc}") from exc

        for required in _REQUIRED_FIELDS:
            if required not in raw:
                raise ThreadSchemaError(f"Thread YAML '{path}' missing required field '{required}'")

        try:
            state = ThreadState(raw["state"])
        except ValueError:
            valid = ", ".join(s.value for s in ThreadState)
            raise ThreadSchemaError(
                f"Thread YAML '{path}' has invalid state '{raw['state']}' (valid: {valid})"
            )

        try:
            created_at = datetime.fromisoformat(str(raw["created_at"]))
        except (ValueError, TypeError) as exc:
            raise ThreadSchemaError(f"Thread YAML '{path}' has invalid created_at: {exc}") from exc

        try:
            updated_at = datetime.fromisoformat(str(raw["updated_at"]))
        except (ValueError, TypeError) as exc:
            raise ThreadSchemaError(f"Thread YAML '{path}' has invalid updated_at: {exc}") from exc

        context_refs = [
            ThreadContextRef(
                type=ref.get("type", ""),
                id=ref.get("id", ""),
                summary=ref.get("summary", ""),
            )
            for ref in raw.get("context_refs", [])
            if isinstance(ref, dict)
        ]

        return cls(
            title=str(raw["title"]),
            state=state,
            weight=float(raw["weight"]),
            created_at=created_at,
            updated_at=updated_at,
            owner_id=raw.get("owner_id"),
            next_action_hint=raw.get("next_action_hint"),
            resolved_artifact_path=raw.get("resolved_artifact_path"),
            context_refs=context_refs,
            weight_signals=raw.get("weight_signals") or {},
        )

    def to_yaml(self, path: Path) -> None:
        """Serialise this schema to a YAML file at *path*."""
        data: dict = {
            "title": self.title,
            "state": self.state.value,
            "weight": self.weight,
            "owner_id": self.owner_id,
            "next_action_hint": self.next_action_hint,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "resolved_artifact_path": self.resolved_artifact_path,
            "context_refs": [
                {"type": ref.type, "id": ref.id, "summary": ref.summary}
                for ref in self.context_refs
            ],
            "weight_signals": self.weight_signals,
        }
        path.write_text(yaml.dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")


# ---------------------------------------------------------------------------
# Slug utility
# ---------------------------------------------------------------------------


def slugify(title: str) -> str:
    """Convert *title* to a URL/filename-safe slug.

    Lowercased, ASCII-safe, hyphens instead of spaces/punctuation.
    """
    # Normalise unicode to ASCII-compatible form
    normalised = unicodedata.normalize("NFKD", title)
    ascii_text = normalised.encode("ascii", "ignore").decode("ascii")
    # Replace non-alphanumeric characters with hyphens
    slug = re.sub(r"[^\w\s-]", "", ascii_text).strip()
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug.lower()


# ---------------------------------------------------------------------------
# Core domain models
# ---------------------------------------------------------------------------


@dataclass
class MimirSource:
    """An immutable raw source ingested into the Mímir knowledge base.

    Raw sources are never modified after ingestion.  ``content_hash`` (SHA-256)
    is stored so staleness can be detected when the same URL is re-fetched and
    its content has changed.
    """

    source_id: str
    title: str
    content: str
    source_type: Literal["web", "document", "conversation", "tool_output", "research"]
    ingested_at: datetime
    content_hash: str  # SHA-256 hex — used for staleness detection
    origin_url: str | None = None


@dataclass
class MimirPageMeta:
    """Lightweight metadata record for a Mímir wiki page or thread."""

    path: str  # e.g. "technical/volundr/auth.md" or "threads/retrieval-architecture"
    title: str
    summary: str  # one-line summary used in index.md
    category: str  # top-level category: "technical", "projects", "threads", etc.
    updated_at: datetime
    source_ids: list[str] = field(default_factory=list)
    # Compiled-truth frontmatter fields (additive — all optional for backwards compat)
    page_type: PageType | None = None
    confidence: PageConfidence | None = None
    entity_type: EntityType | None = None
    related_entities: list[str] = field(default_factory=list)
    # Thread-specific fields (None for wiki pages)
    thread_state: ThreadState | None = None
    thread_weight: float | None = None
    is_thread: bool = False
    # Set by the thread enricher after LLM classification
    thread_weight_signals: dict = field(default_factory=dict)
    thread_next_action_hint: str | None = None
    thread_context_refs: list[ThreadContextRef] = field(default_factory=list)
    # Set by action shapes when they write artifacts derived from a thread.
    # The enricher skips pages with this flag to prevent feedback loops.
    produced_by_thread: bool = False


@dataclass
class MimirPage:
    """A single Mímir wiki page or thread with full content and metadata."""

    meta: MimirPageMeta
    content: str  # full Markdown content


@dataclass
class MimirQueryResult:
    """Result returned by MimirPort.query()."""

    question: str
    answer: str  # LLM-synthesised answer from relevant pages
    sources: list[MimirPage] = field(default_factory=list)


@dataclass
class MimirSourceMeta:
    """Lightweight metadata for a raw source — used by list_sources()."""

    source_id: str
    title: str
    ingested_at: datetime
    source_type: str
    mount_name: str | None = None  # set by CompositeMimirAdapter to identify origin mount


@dataclass
class LintIssue:
    """A single issue found during a Mímir wiki health check.

    Each issue has a machine-readable ``id`` (L01–L12), a ``severity``
    (``"error"``, ``"warning"``, or ``"info"``), a human-readable ``message``,
    the ``page_path`` of the affected page (relative to the wiki root), and an
    ``auto_fixable`` flag indicating whether the adapter can correct the issue
    automatically when ``lint(fix=True)`` is called.
    """

    id: str  # L01–L12
    severity: str  # "error", "warning", "info"
    message: str
    page_path: str
    auto_fixable: bool = False


@dataclass
class MimirLintReport:
    """Health-check report produced by MimirPort.lint().

    ``issues`` contains all findings across the 12 check types.
    ``summary`` provides per-severity counts for quick filtering.
    ``issues_found`` is True when any issue is present.
    """

    issues: list[LintIssue]
    pages_checked: int

    @property
    def issues_found(self) -> bool:
        return bool(self.issues)

    @property
    def summary(self) -> dict[str, int]:
        """Count of issues per severity: error, warning, info."""
        counts: dict[str, int] = {"error": 0, "warning": 0, "info": 0}
        for issue in self.issues:
            counts[issue.severity] = counts.get(issue.severity, 0) + 1
        return counts
