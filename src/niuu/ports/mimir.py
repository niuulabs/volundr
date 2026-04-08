"""MimirPort — abstract interface for the Mímir knowledge base.

Both the Mímir service (``src/mimir/``) and Ravn adapters (``src/ravn/``)
depend on this interface.  Neither module depends on the other.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from niuu.domain.mimir import (
    MimirLintReport,
    MimirPage,
    MimirPageMeta,
    MimirQueryResult,
    MimirSource,
)


class MimirPort(ABC):
    """Abstract interface for the Mímir wiki knowledge base.

    Mímir maintains a persistent, LLM-written wiki that accumulates synthesised
    knowledge between agent sessions.  Raw sources flow in via ``ingest()``;
    the wiki layer is queried via ``query()`` and ``search()``; idle-time
    maintenance is driven by ``lint()``.
    """

    @abstractmethod
    async def ingest(self, source: MimirSource) -> list[str]:
        """Ingest a raw source and update relevant wiki pages.

        Returns a list of wiki page paths (relative to wiki root) that were
        created or updated.  Appends an entry to ``wiki/log.md``.
        """
        ...

    @abstractmethod
    async def query(self, question: str) -> MimirQueryResult:
        """Answer *question* from wiki knowledge.

        The adapter performs ranking; full synthesis is performed by the caller.
        """
        ...

    @abstractmethod
    async def lint(self) -> MimirLintReport:
        """Health-check the wiki.

        Scans for orphan pages, contradictions, stale sources, and concept
        gaps.  Appends a lint entry to ``wiki/log.md``.
        """
        ...

    @abstractmethod
    async def search(self, query: str) -> list[MimirPage]:
        """Full-text search over wiki pages, ranked by relevance."""
        ...

    @abstractmethod
    async def upsert_page(
        self,
        path: str,
        content: str,
        mimir: str | None = None,
    ) -> None:
        """Create or replace a wiki page at *path*.

        *path* is relative to the wiki root (e.g. ``"technical/ravn/tools.md"``).
        Updates ``wiki/index.md`` if the page is new.

        The optional *mimir* parameter is used by ``CompositeMimirAdapter`` to
        route writes to a specific named Mímir instance, bypassing the default
        category-based routing.
        """
        ...

    @abstractmethod
    async def read_page(self, path: str) -> str:
        """Return the raw Markdown content of the wiki page at *path*.

        Raises ``FileNotFoundError`` if the page does not exist.
        """
        ...

    @abstractmethod
    async def get_page(self, path: str) -> MimirPage:
        """Return content and metadata for the wiki page at *path* in one call.

        More efficient than calling ``read_page`` and ``list_pages`` separately.
        Raises ``FileNotFoundError`` if the page does not exist.
        """
        ...

    @abstractmethod
    async def list_pages(
        self,
        category: str | None = None,
    ) -> list[MimirPageMeta]:
        """List all wiki pages, optionally filtered to *category*.

        Returns lightweight metadata records — does not read full page content.
        """
        ...
