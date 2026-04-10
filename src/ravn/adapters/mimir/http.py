"""HttpMimirAdapter — MimirPort implementation that calls a standalone Mímir service.

Used when Ravn connects to a remote Mímir instance (shared, domain, or another
local service) rather than accessing the filesystem directly.

Auth
----
Bearer token (development)::

    adapter = HttpMimirAdapter(base_url="http://localhost:7477", token="dev-token")

SPIFFE mTLS (production)::

    auth = MimirAuth(type="spiffe", trust_domain="niuu.world")
    adapter = HttpMimirAdapter(base_url="https://mimir.odin.niuu.world", auth=auth)
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

import httpx

from niuu.domain.mimir import (
    MimirLintReport,
    MimirPage,
    MimirPageMeta,
    MimirQueryResult,
    MimirSource,
    MimirSourceMeta,
    ThreadState,
)
from niuu.ports.mimir import MimirPort
from ravn.domain.mimir import MimirAuth

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT = 30.0  # seconds


class HttpMimirAdapter(MimirPort):
    """MimirPort adapter that calls a standalone Mímir service over HTTP.

    Args:
        base_url: Base URL of the Mímir service, e.g. ``http://localhost:7477``.
        auth:     Optional auth config (bearer token or SPIFFE mTLS).
        timeout:  HTTP request timeout in seconds.
    """

    def __init__(
        self,
        base_url: str,
        auth: MimirAuth | None = None,
        timeout: float = _DEFAULT_TIMEOUT,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._auth = auth
        self._timeout = timeout
        self._client: httpx.AsyncClient | None = None

    # ------------------------------------------------------------------
    # Client lifecycle
    # ------------------------------------------------------------------

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            headers = self._build_headers()
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                headers=headers,
                timeout=self._timeout,
            )
        return self._client

    def _build_headers(self) -> dict[str, str]:
        if self._auth is None:
            return {}
        if self._auth.type == "bearer" and self._auth.token:
            return {"Authorization": f"Bearer {self._auth.token}"}
        return {}

    async def aclose(self) -> None:
        """Close the underlying HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    # ------------------------------------------------------------------
    # MimirPort implementation
    # ------------------------------------------------------------------

    async def ingest(self, source: MimirSource) -> list[str]:
        """POST /mimir/ingest — persist a raw source."""
        client = self._get_client()
        payload = {
            "title": source.title,
            "content": source.content,
            "source_type": source.source_type,
            "origin_url": source.origin_url,
        }
        response = await client.post("/mimir/ingest", json=payload)
        response.raise_for_status()
        data = response.json()
        return data.get("pages_updated", [])

    async def query(self, question: str) -> MimirQueryResult:
        """GET /mimir/search — find relevant pages for *question*."""
        client = self._get_client()
        response = await client.get("/mimir/search", params={"q": question})
        response.raise_for_status()
        results = response.json()
        pages = [_parse_search_result(r) for r in results]
        return MimirQueryResult(question=question, answer="", sources=pages)

    async def search(self, query: str) -> list[MimirPage]:
        """GET /mimir/search — full-text search."""
        client = self._get_client()
        response = await client.get("/mimir/search", params={"q": query})
        response.raise_for_status()
        return [_parse_search_result(r) for r in response.json()]

    async def upsert_page(
        self,
        path: str,
        content: str,
        mimir: str | None = None,
    ) -> None:
        """PUT /mimir/page — create or replace a wiki page."""
        client = self._get_client()
        response = await client.put("/mimir/page", json={"path": path, "content": content})
        response.raise_for_status()

    async def get_page(self, path: str) -> MimirPage:
        """GET /mimir/page?path=... — return full page with metadata."""
        client = self._get_client()
        response = await client.get("/mimir/page", params={"path": path})
        if response.status_code == 404:
            raise FileNotFoundError(f"Mímir page not found: {path}")
        response.raise_for_status()
        data = response.json()
        meta = _parse_page_meta(data)
        return MimirPage(meta=meta, content=data["content"])

    async def read_page(self, path: str) -> str:
        """GET /mimir/page?path=... — return raw Markdown content."""
        client = self._get_client()
        response = await client.get("/mimir/page", params={"path": path})
        if response.status_code == 404:
            raise FileNotFoundError(f"Mímir page not found: {path}")
        response.raise_for_status()
        return response.json()["content"]

    async def list_pages(self, category: str | None = None) -> list[MimirPageMeta]:
        """GET /mimir/pages — list pages, optionally filtered by category."""
        client = self._get_client()
        params: dict[str, Any] = {}
        if category is not None:
            params["category"] = category
        response = await client.get("/mimir/pages", params=params)
        response.raise_for_status()
        return [_parse_page_meta(m) for m in response.json()]

    async def lint(self) -> MimirLintReport:
        """GET /mimir/lint — return health-check report."""
        client = self._get_client()
        response = await client.get("/mimir/lint")
        response.raise_for_status()
        data = response.json()
        return MimirLintReport(
            orphans=data.get("orphans", []),
            contradictions=data.get("contradictions", []),
            stale=data.get("stale", []),
            gaps=data.get("gaps", []),
            pages_checked=data.get("pages_checked", 0),
        )

    async def read_source(self, source_id: str) -> MimirSource | None:
        """GET /mimir/source?source_id=... — return full raw source."""
        client = self._get_client()
        response = await client.get("/mimir/source", params={"source_id": source_id})
        if response.status_code == 404:
            return None
        response.raise_for_status()
        data = response.json()
        return MimirSource(
            source_id=data["source_id"],
            title=data["title"],
            content=data["content"],
            source_type=data["source_type"],
            origin_url=data.get("origin_url"),
            content_hash=data["content_hash"],
            ingested_at=datetime.fromisoformat(data["ingested_at"]),
        )

    async def list_threads(
        self,
        state: ThreadState | None = None,
        limit: int = 100,
    ) -> list[MimirPage]:
        """GET /mimir/threads — list threads, optionally filtered by state.

        Not yet implemented in HttpMimirAdapter.
        """
        raise NotImplementedError("Thread listing not yet implemented in HttpMimirAdapter")

    async def update_thread_weight(
        self,
        path: str,
        weight: float,
        signals: dict | None = None,
    ) -> None:
        """Update thread weight.  Not yet implemented in HttpMimirAdapter."""
        raise NotImplementedError("Thread weight update not yet implemented in HttpMimirAdapter")

    async def list_sources(self, *, unprocessed_only: bool = False) -> list[MimirSourceMeta]:
        """GET /mimir/sources — list raw sources, optionally unprocessed only."""
        client = self._get_client()
        params: dict[str, Any] = {}
        if unprocessed_only:
            params["unprocessed"] = "true"
        response = await client.get("/mimir/sources", params=params)
        if response.status_code == 404:
            # Endpoint not yet available on older Mímir deployments — treat as empty.
            logger.debug(
                "HttpMimirAdapter: /mimir/sources returned 404 — "
                "remote may be running an older image without this endpoint"
            )
            return []
        response.raise_for_status()
        return [
            MimirSourceMeta(
                source_id=item["source_id"],
                title=item["title"],
                ingested_at=datetime.fromisoformat(item["ingested_at"]),
                source_type=item["source_type"],
            )
            for item in response.json()
        ]


# ---------------------------------------------------------------------------
# Parse helpers
# ---------------------------------------------------------------------------


def _parse_page_meta(data: dict) -> MimirPageMeta:
    return MimirPageMeta(
        path=data["path"],
        title=data["title"],
        summary=data.get("summary", ""),
        category=data.get("category", "uncategorised"),
        updated_at=datetime.fromisoformat(data["updated_at"]),
        source_ids=data.get("source_ids", []),
    )


def _parse_search_result(data: dict) -> MimirPage:
    """Parse a search result into a MimirPage with minimal metadata."""
    meta = MimirPageMeta(
        path=data["path"],
        title=data["title"],
        summary=data.get("summary", ""),
        category=data.get("category", "uncategorised"),
        updated_at=datetime.now(UTC),
        source_ids=[],
    )
    return MimirPage(meta=meta, content="")
