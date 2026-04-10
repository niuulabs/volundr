"""Mímir domain models — shared between the Mímir service and Ravn adapters.

These types define the wire contract for all Mímir operations.  Both
``src/mimir/`` (the standalone service) and ``src/ravn/`` (adapters that call
the service) import from here so that neither module depends on the other.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Literal


def compute_content_hash(content: str) -> str:
    """Return the SHA-256 hex digest of *content*."""
    return hashlib.sha256(content.encode()).hexdigest()


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


# ---------------------------------------------------------------------------
# Thread types
# ---------------------------------------------------------------------------


class ThreadState(StrEnum):
    """Lifecycle state of a thread."""

    open = "open"
    pulling = "pulling"
    blocked = "blocked"
    waiting_for_peer = "waiting_for_peer"
    waiting_for_operator = "waiting_for_operator"
    closed = "closed"
    dissolved = "dissolved"


@dataclass
class ThreadContextRef:
    """A reference to an external artifact that provides context for a thread."""

    ref_type: Literal["conversation", "ingest", "observation", "search"]
    ref_id: str
    ref_summary: str


# ---------------------------------------------------------------------------
# Wiki page types
# ---------------------------------------------------------------------------


@dataclass
class MimirPageMeta:
    """Lightweight metadata record for a Mímir wiki page."""

    path: str  # e.g. "technical/volundr/auth.md"
    title: str
    summary: str  # one-line summary used in index.md
    category: str  # top-level category: "technical", "projects", etc.
    updated_at: datetime
    source_ids: list[str] = field(default_factory=list)

    # Thread fields — all None / empty for non-thread pages
    thread_state: ThreadState | None = None
    thread_weight: float | None = None
    thread_owner_id: str | None = None
    thread_context_refs: list[ThreadContextRef] = field(default_factory=list)
    thread_next_action_hint: str | None = None
    thread_resolved_artifact_path: str | None = None
    thread_weight_signals: dict | None = None


@dataclass
class MimirPage:
    """A single Mímir wiki page with full content and metadata."""

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
class MimirLintReport:
    """Health-check report produced by MimirPort.lint().

    Each list contains paths (relative to wiki root) of affected pages.
    ``issues_found`` is True when any list is non-empty.
    """

    orphans: list[str]  # pages not linked from index.md
    contradictions: list[str]  # pages with flagged contradictions
    stale: list[str]  # pages whose source content_hash has changed
    gaps: list[str]  # concepts mentioned often but without a dedicated page
    pages_checked: int

    @property
    def issues_found(self) -> bool:
        return bool(self.orphans or self.contradictions or self.stale or self.gaps)


# ---------------------------------------------------------------------------
# Thread YAML schema
# ---------------------------------------------------------------------------


class ThreadSchemaError(Exception):
    """Raised when a thread YAML file fails validation."""

    def __init__(self, path: str, reason: str) -> None:
        self.path = path
        self.reason = reason
        super().__init__(f"Invalid thread schema at {path!r}: {reason}")


@dataclass
class ThreadYamlSchema:
    """Canonical, validated representation of a thread's ``.yaml`` file.

    Shared by all adapters (``MarkdownMimirAdapter``, ``HttpMimirAdapter``)
    and the Mímir service so that parsing and serialisation logic lives in
    exactly one place.
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
    # Class-level helpers
    # ------------------------------------------------------------------

    @classmethod
    def from_yaml(cls, path: Path) -> ThreadYamlSchema:
        """Parse and validate a thread YAML file.

        Raises :class:`ThreadSchemaError` on missing required fields, invalid
        state, or malformed dates.
        """
        import yaml  # local import — PyYAML is an optional dep for non-file adapters

        try:
            text = Path(path).read_text(encoding="utf-8")
        except OSError as exc:
            raise ThreadSchemaError(str(path), f"cannot read file: {exc}") from exc

        try:
            data = yaml.safe_load(text)
        except yaml.YAMLError as exc:
            raise ThreadSchemaError(str(path), f"YAML parse error: {exc}") from exc

        if not isinstance(data, dict):
            raise ThreadSchemaError(str(path), "expected a YAML mapping at top level")

        return cls._validate(data, str(path))

    @classmethod
    def from_dict(cls, data: dict) -> ThreadYamlSchema:
        """Parse and validate from a dict (for HTTP response deserialisation)."""
        return cls._validate(data, "<dict>")

    # ------------------------------------------------------------------
    # Instance methods
    # ------------------------------------------------------------------

    def to_yaml(self, path: Path) -> None:
        """Serialise to a YAML file atomically (write to ``.tmp``, then rename).

        The atomic write prevents corrupt YAML on disk if the process crashes
        mid-write.
        """
        import yaml  # local import

        target = Path(path)
        tmp = Path(str(path) + ".tmp")

        tmp.write_text(
            yaml.safe_dump(self.to_dict(), allow_unicode=True, sort_keys=False),
            encoding="utf-8",
        )
        os.replace(tmp, target)

    def to_dict(self) -> dict:
        """Serialise to a dict (for HTTP request serialisation)."""
        return {
            "title": self.title,
            "state": self.state.value,
            "weight": self.weight,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "owner_id": self.owner_id,
            "next_action_hint": self.next_action_hint,
            "resolved_artifact_path": self.resolved_artifact_path,
            "context_refs": [
                {
                    "ref_type": ref.ref_type,
                    "ref_id": ref.ref_id,
                    "ref_summary": ref.ref_summary,
                }
                for ref in self.context_refs
            ],
            "weight_signals": self.weight_signals,
        }

    def to_page_meta(self, slug: str) -> MimirPageMeta:
        """Produce a :class:`MimirPageMeta` for use in :class:`MimirPage` responses."""
        return MimirPageMeta(
            path=f"threads/{slug}.yaml",
            title=self.title,
            summary=self.next_action_hint or "",
            category="threads",
            updated_at=self.updated_at,
            thread_state=self.state,
            thread_weight=self.weight,
            thread_owner_id=self.owner_id,
            thread_context_refs=list(self.context_refs),
            thread_next_action_hint=self.next_action_hint,
            thread_resolved_artifact_path=self.resolved_artifact_path,
            thread_weight_signals=self.weight_signals or None,
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @classmethod
    def _validate(cls, data: dict, path: str) -> ThreadYamlSchema:
        """Validate *data* and return a :class:`ThreadYamlSchema` instance."""
        title = data.get("title")
        if not title or not isinstance(title, str) or not title.strip():
            raise ThreadSchemaError(path, "'title' must be a non-empty string")

        raw_state = data.get("state")
        if raw_state is None:
            raise ThreadSchemaError(path, "'state' is required")
        try:
            state = ThreadState(raw_state)
        except ValueError:
            valid = ", ".join(s.value for s in ThreadState)
            raise ThreadSchemaError(
                path,
                f"'state' {raw_state!r} is not a valid ThreadState; valid: {valid}",
            )

        raw_weight = data.get("weight")
        if raw_weight is None:
            raise ThreadSchemaError(path, "'weight' is required")
        try:
            weight = float(raw_weight)
        except (TypeError, ValueError):
            raise ThreadSchemaError(path, f"'weight' must be a float, got {raw_weight!r}")
        if weight < 0.0:
            raise ThreadSchemaError(path, f"'weight' must be >= 0.0, got {weight!r}")

        created_at = cls._parse_datetime(data.get("created_at"), "created_at", path)
        updated_at = cls._parse_datetime(data.get("updated_at"), "updated_at", path)

        raw_refs = data.get("context_refs", [])
        if not isinstance(raw_refs, list):
            raise ThreadSchemaError(path, "'context_refs' must be a list")
        context_refs = [cls._parse_context_ref(item, path) for item in raw_refs]

        raw_signals = data.get("weight_signals", {})
        if not isinstance(raw_signals, dict):
            raise ThreadSchemaError(path, "'weight_signals' must be a mapping")

        return cls(
            title=title.strip(),
            state=state,
            weight=weight,
            created_at=created_at,
            updated_at=updated_at,
            owner_id=data.get("owner_id"),
            next_action_hint=data.get("next_action_hint"),
            resolved_artifact_path=data.get("resolved_artifact_path"),
            context_refs=context_refs,
            weight_signals=raw_signals,
        )

    @staticmethod
    def _parse_datetime(value: object, field_name: str, path: str) -> datetime:
        if value is None:
            raise ThreadSchemaError(path, f"'{field_name}' is required")
        if isinstance(value, datetime):
            return value
        if not isinstance(value, str):
            raise ThreadSchemaError(
                path,
                f"'{field_name}' must be an ISO-8601 string, got {value!r}",
            )
        try:
            return datetime.fromisoformat(value)
        except ValueError as exc:
            raise ThreadSchemaError(
                path, f"'{field_name}' is not a valid ISO-8601 datetime: {exc}"
            ) from exc

    @staticmethod
    def _parse_context_ref(item: object, path: str) -> ThreadContextRef:
        if not isinstance(item, dict):
            raise ThreadSchemaError(
                path,
                f"each 'context_refs' entry must be a mapping, got {item!r}",
            )
        for key in ("ref_type", "ref_id", "ref_summary"):
            if key not in item:
                raise ThreadSchemaError(path, f"context_refs entry missing required key {key!r}")
        return ThreadContextRef(
            ref_type=item["ref_type"],
            ref_id=item["ref_id"],
            ref_summary=item["ref_summary"],
        )
