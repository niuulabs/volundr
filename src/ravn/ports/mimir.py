"""Mímir port — interface for the persistent compounding knowledge base."""

from __future__ import annotations

from abc import ABC, abstractmethod

from ravn.domain.models import (
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

    The wiki lives at ``~/.ravn/mimir/wiki/`` and is backed by the filesystem.
    Implementations may layer additional search or embedding indices on top.
    """

    @abstractmethod
    async def ingest(self, source: MimirSource) -> list[str]:
        """Ingest a raw source and update relevant wiki pages.

        Returns a list of wiki page paths (relative to wiki root) that were
        created or updated as a result of the ingest.
        Appends an entry to ``wiki/log.md`` and updates ``wiki/index.md``.
        """
        ...

    @abstractmethod
    async def query(self, question: str) -> MimirQueryResult:
        """Answer *question* from wiki knowledge.

        Reads ``wiki/index.md`` to find relevant pages, reads those pages,
        and synthesises an answer.  Does not call any external LLM — synthesis
        is performed by the caller (the agent) using ``mimir_query`` tool output.
        """
        ...

    @abstractmethod
    async def lint(self) -> MimirLintReport:
        """Health-check the wiki.

        Scans for orphan pages (not linked in index.md), pages with
        contradictions, pages whose raw source hash has changed (stale), and
        concept gaps (frequently mentioned concepts without a dedicated page).
        Appends a lint entry to ``wiki/log.md``.
        """
        ...

    @abstractmethod
    async def search(self, query: str) -> list[MimirPage]:
        """Full-text search over wiki pages.

        Returns matching pages ordered by relevance.  Does not call an LLM;
        uses full-text search over the page content.
        """
        ...

    @abstractmethod
    async def upsert_page(self, path: str, content: str) -> None:
        """Create or replace a wiki page at *path*.

        *path* is relative to the wiki root (e.g. ``"technical/ravn/tools.md"``).
        Updates ``wiki/index.md`` if the page is new.
        """
        ...

    @abstractmethod
    async def read_page(self, path: str) -> str:
        """Return the raw Markdown content of the wiki page at *path*.

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
