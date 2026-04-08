"""MimirRouter — FastAPI router exposing all nine Mímir HTTP endpoints.

Mountable on any FastAPI application::

    from mimir.router import MimirRouter
    from mimir.adapters.markdown import MarkdownMimirAdapter

    adapter = MarkdownMimirAdapter(root="~/.ravn/mimir")
    router = MimirRouter(adapter)

    app.include_router(router.router, prefix="/mimir")

Endpoints
---------
GET  /mimir/stats          — page count, categories, last activity
GET  /mimir/pages          — list all pages with metadata
GET  /mimir/page           — read a specific page (?path=...)
GET  /mimir/search         — full-text search (?q=...)
GET  /mimir/log            — last N log entries (?n=50)
GET  /mimir/lint           — current lint report
GET  /mimir/graph          — nodes + edges for MimirExplorer visualiser
PUT  /mimir/page           — upsert a page (requires write auth)
POST /mimir/ingest         — ingest URL or text (requires write auth)
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel

from niuu.domain.mimir import (
    MimirLintReport,
    MimirPageMeta,
    MimirSource,
    compute_content_hash,
)
from niuu.ports.mimir import MimirPort

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class StatsResponse(BaseModel):
    page_count: int
    categories: list[str]
    healthy: bool


class PageMetaResponse(BaseModel):
    path: str
    title: str
    summary: str
    category: str
    updated_at: str
    source_ids: list[str]


class PageResponse(BaseModel):
    path: str
    title: str
    summary: str
    category: str
    updated_at: str
    source_ids: list[str]
    content: str


class SearchResult(BaseModel):
    path: str
    title: str
    summary: str
    category: str


class LintResponse(BaseModel):
    orphans: list[str]
    contradictions: list[str]
    stale: list[str]
    gaps: list[str]
    pages_checked: int
    issues_found: bool


class GraphNode(BaseModel):
    id: str
    title: str
    category: str


class GraphEdge(BaseModel):
    source: str
    target: str


class GraphResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class UpsertPageRequest(BaseModel):
    path: str
    content: str


class IngestRequest(BaseModel):
    title: str
    content: str
    source_type: str = "document"
    origin_url: str | None = None


class IngestResponse(BaseModel):
    source_id: str
    pages_updated: list[str]


# ---------------------------------------------------------------------------
# Auth dependency (bearer token or SPIFFE — pass-through for now)
# ---------------------------------------------------------------------------


def _require_write_auth(authorization: Annotated[str | None, Header()] = None) -> None:
    """Minimal write-auth guard.  Override in production with mTLS or JWT validation."""


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------


class MimirRouter:
    """Wraps a ``MimirPort`` and exposes it as a FastAPI ``APIRouter``.

    Args:
        adapter: The MimirPort implementation to delegate to.
        name:    Instance name (used in announce events).
        role:    Instance role: ``shared``, ``local``, or ``domain``.
    """

    def __init__(
        self,
        adapter: MimirPort,
        name: str = "local",
        role: str = "local",
    ) -> None:
        self._adapter = adapter
        self._name = name
        self._role = role
        self.router = APIRouter()
        self._register_routes()

    def _register_routes(self) -> None:
        router = self.router
        adapter = self._adapter

        @router.get("/stats", response_model=StatsResponse)
        async def stats() -> StatsResponse:
            pages = await adapter.list_pages()
            categories = sorted({p.category for p in pages})
            return StatsResponse(
                page_count=len(pages),
                categories=categories,
                healthy=True,
            )

        @router.get("/pages", response_model=list[PageMetaResponse])
        async def list_pages(
            category: str | None = Query(default=None),
        ) -> list[PageMetaResponse]:
            pages = await adapter.list_pages(category=category)
            return [_meta_to_response(m) for m in pages]

        @router.get("/page", response_model=PageResponse)
        async def read_page(path: str = Query()) -> PageResponse:
            try:
                page = await adapter.get_page(path)
            except FileNotFoundError:
                raise HTTPException(status_code=404, detail=f"Page not found: {path}")
            return PageResponse(
                path=page.meta.path,
                title=page.meta.title,
                summary=page.meta.summary,
                category=page.meta.category,
                updated_at=page.meta.updated_at.isoformat(),
                source_ids=page.meta.source_ids,
                content=page.content,
            )

        @router.get("/search", response_model=list[SearchResult])
        async def search(q: str = Query()) -> list[SearchResult]:
            pages = await adapter.search(q)
            return [
                SearchResult(
                    path=p.meta.path,
                    title=p.meta.title,
                    summary=p.meta.summary,
                    category=p.meta.category,
                )
                for p in pages
            ]

        @router.get("/log")
        async def log_entries(n: int = Query(default=50)) -> dict:
            """Return last *n* log entries as raw text (delegated to filesystem adapter)."""
            try:
                content = await adapter.read_page("log.md")
            except FileNotFoundError:
                return {"entries": [], "raw": ""}
            lines = content.splitlines()
            # Each entry starts with "## "
            entries = [ln for ln in lines if ln.startswith("## ")]
            return {"entries": entries[-n:], "raw": content}

        @router.get("/lint", response_model=LintResponse)
        async def lint() -> LintResponse:
            report = await adapter.lint()
            return _lint_to_response(report)

        @router.get("/graph", response_model=GraphResponse)
        async def graph() -> GraphResponse:
            pages = await adapter.list_pages()
            nodes = [GraphNode(id=p.path, title=p.title, category=p.category) for p in pages]
            # Build edges from source_ids overlap (pages sharing a source are related)
            source_to_pages: dict[str, list[str]] = {}
            for p in pages:
                for sid in p.source_ids:
                    source_to_pages.setdefault(sid, []).append(p.path)

            edges: list[GraphEdge] = []
            seen: set[tuple[str, str]] = set()
            for page_paths in source_to_pages.values():
                for i, src in enumerate(page_paths):
                    for tgt in page_paths[i + 1 :]:
                        key = (min(src, tgt), max(src, tgt))
                        if key not in seen:
                            seen.add(key)
                            edges.append(GraphEdge(source=src, target=tgt))

            return GraphResponse(nodes=nodes, edges=edges)

        @router.put("/page", status_code=204)
        async def upsert_page(
            request: UpsertPageRequest,
            _auth: None = Depends(_require_write_auth),
        ) -> None:
            await adapter.upsert_page(request.path, request.content)

        @router.post("/ingest", response_model=IngestResponse)
        async def ingest_source(
            request: IngestRequest,
            _auth: None = Depends(_require_write_auth),
        ) -> IngestResponse:
            content_hash = compute_content_hash(request.content)
            source_id = "src_" + content_hash[:16]
            source = MimirSource(
                source_id=source_id,
                title=request.title,
                content=request.content,
                source_type=request.source_type,  # type: ignore[arg-type]
                origin_url=request.origin_url,
                content_hash=content_hash,
                ingested_at=datetime.now(UTC),
            )
            page_paths = await adapter.ingest(source)
            return IngestResponse(source_id=source_id, pages_updated=page_paths)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _meta_to_response(meta: MimirPageMeta) -> PageMetaResponse:
    return PageMetaResponse(
        path=meta.path,
        title=meta.title,
        summary=meta.summary,
        category=meta.category,
        updated_at=meta.updated_at.isoformat(),
        source_ids=meta.source_ids,
    )


def _lint_to_response(report: MimirLintReport) -> LintResponse:
    return LintResponse(
        orphans=report.orphans,
        contradictions=report.contradictions,
        stale=report.stale,
        gaps=report.gaps,
        pages_checked=report.pages_checked,
        issues_found=report.issues_found,
    )
