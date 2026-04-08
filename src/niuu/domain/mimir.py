"""Mímir domain models — shared between the Mímir service and Ravn adapters.

These types define the wire contract for all Mímir operations.  Both
``src/mimir/`` (the standalone service) and ``src/ravn/`` (adapters that call
the service) import from here so that neither module depends on the other.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime
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


@dataclass
class MimirPageMeta:
    """Lightweight metadata record for a Mímir wiki page."""

    path: str  # e.g. "technical/volundr/auth.md"
    title: str
    summary: str  # one-line summary used in index.md
    category: str  # top-level category: "technical", "projects", etc.
    updated_at: datetime
    source_ids: list[str] = field(default_factory=list)


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
