"""CompositeMimirAdapter — fan-out across multiple MimirPort instances.

Reads from all mounted Mímirs in priority order (lower ``read_priority`` first)
and merges results.  Routes writes based on category-prefix config or explicit
agent override — exactly parallel to ``CompositeMeshAdapter``.

Example (two mounts — local filesystem + shared HTTP service)::

    from mimir.adapters.markdown import MarkdownMimirAdapter
    from ravn.adapters.mimir.http import HttpMimirAdapter
    from ravn.adapters.mimir.composite import CompositeMimirAdapter
    from ravn.domain.mimir import MimirAuth, MimirMount, WriteRouting

    local = MarkdownMimirAdapter(root="~/.ravn/mimir")
    shared = HttpMimirAdapter(
        base_url="https://mimir.odin.niuu.world",
        auth=MimirAuth(type="spiffe", trust_domain="niuu.world"),
    )

    routing = WriteRouting(
        rules=[
            ("self/", ["local"]),
            ("technical/", ["local", "shared"]),
            ("household/", ["shared"]),
        ],
        default=["local"],
    )

    adapter = CompositeMimirAdapter(
        mounts=[
            MimirMount(name="local", port=local, role="local", read_priority=0),
            MimirMount(name="shared", port=shared, role="shared", read_priority=1),
        ],
        write_routing=routing,
    )
"""

from __future__ import annotations

import logging

from niuu.domain.mimir import (
    MimirLintReport,
    MimirPage,
    MimirPageMeta,
    MimirQueryResult,
    MimirSource,
)
from niuu.ports.mimir import MimirPort
from ravn.domain.mimir import MimirMount, WriteRouting

logger = logging.getLogger(__name__)


class CompositeMimirAdapter(MimirPort):
    """Fan-out across multiple MimirPort instances with configurable routing.

    Read operations merge results from all mounts in ``read_priority`` order
    (de-duplicated by page path).  Write operations are routed by category
    prefix or explicit ``mimir=`` override.

    Args:
        mounts:        Ordered list of Mímir mounts.
        write_routing: Category-prefix write routing configuration.
    """

    def __init__(
        self,
        mounts: list[MimirMount],
        write_routing: WriteRouting | None = None,
    ) -> None:
        self._mounts = sorted(mounts, key=lambda m: m.read_priority)
        self._mount_map = {m.name: m for m in mounts}
        self._write_routing = write_routing or WriteRouting()

    # ------------------------------------------------------------------
    # MimirPort — read operations (fan-out, merge, de-dup by path)
    # ------------------------------------------------------------------

    async def ingest(self, source: MimirSource) -> list[str]:
        """Ingest into all mounts, merge returned page paths."""
        all_paths: list[str] = []
        for mount in self._mounts:
            try:
                paths = await mount.port.ingest(source)  # type: ignore[union-attr]
                all_paths.extend(paths)
            except Exception as exc:
                logger.warning("composite mimir: ingest failed on %r: %s", mount.name, exc)
        return list(dict.fromkeys(all_paths))

    async def query(self, question: str) -> MimirQueryResult:
        """Query all mounts in priority order, merge sources (de-dup by path)."""
        seen_paths: set[str] = set()
        merged_sources: list[MimirPage] = []

        for mount in self._mounts:
            try:
                result = await mount.port.query(question)  # type: ignore[union-attr]
                for page in result.sources:
                    if page.meta.path not in seen_paths:
                        seen_paths.add(page.meta.path)
                        merged_sources.append(page)
            except Exception as exc:
                logger.warning("composite mimir: query failed on %r: %s", mount.name, exc)

        return MimirQueryResult(question=question, answer="", sources=merged_sources)

    async def search(self, query: str) -> list[MimirPage]:
        """Search all mounts in priority order, de-dup by path."""
        seen_paths: set[str] = set()
        results: list[MimirPage] = []

        for mount in self._mounts:
            try:
                pages = await mount.port.search(query)  # type: ignore[union-attr]
                for page in pages:
                    if page.meta.path not in seen_paths:
                        seen_paths.add(page.meta.path)
                        results.append(page)
            except Exception as exc:
                logger.warning("composite mimir: search failed on %r: %s", mount.name, exc)

        return results

    async def read_page(self, path: str) -> str:
        """Read from the first mount (in priority order) that has the page."""
        for mount in self._mounts:
            try:
                return await mount.port.read_page(path)  # type: ignore[union-attr]
            except FileNotFoundError:
                continue
            except Exception as exc:
                logger.warning("composite mimir: read_page failed on %r: %s", mount.name, exc)
        raise FileNotFoundError(f"Mímir page not found in any mount: {path}")

    async def list_pages(self, category: str | None = None) -> list[MimirPageMeta]:
        """List pages from all mounts in priority order, de-dup by path."""
        seen_paths: set[str] = set()
        results: list[MimirPageMeta] = []

        for mount in self._mounts:
            try:
                pages = await mount.port.list_pages(category)  # type: ignore[union-attr]
                for meta in pages:
                    if meta.path not in seen_paths:
                        seen_paths.add(meta.path)
                        results.append(meta)
            except Exception as exc:
                logger.warning("composite mimir: list_pages failed on %r: %s", mount.name, exc)

        return results

    async def lint(self) -> MimirLintReport:
        """Run lint on all mounts, merge issue lists."""
        merged = MimirLintReport(
            orphans=[],
            contradictions=[],
            stale=[],
            gaps=[],
            pages_checked=0,
        )

        for mount in self._mounts:
            try:
                report = await mount.port.lint()  # type: ignore[union-attr]
                merged.orphans.extend(report.orphans)
                merged.contradictions.extend(report.contradictions)
                merged.stale.extend(report.stale)
                merged.gaps.extend(report.gaps)
                merged.pages_checked += report.pages_checked
            except Exception as exc:
                logger.warning("composite mimir: lint failed on %r: %s", mount.name, exc)

        return merged

    # ------------------------------------------------------------------
    # MimirPort — write operations (routed)
    # ------------------------------------------------------------------

    async def upsert_page(
        self,
        path: str,
        content: str,
        mimir: str | None = None,
    ) -> None:
        """Write *path* to the mounts selected by routing config or explicit *mimir*.

        Routing precedence:
        1. Explicit ``mimir=`` parameter (agent override — bypasses all rules).
        2. Category-prefix matching from ``write_routing.rules``.
        3. ``write_routing.default`` fallback.
        """
        target_names = self._write_routing.resolve(path, explicit=mimir)
        for name in target_names:
            mount = self._mount_map.get(name)
            if mount is None:
                logger.warning(
                    "composite mimir: write routing named unknown mount %r for path %r",
                    name,
                    path,
                )
                continue
            try:
                await mount.port.upsert_page(path, content)  # type: ignore[union-attr]
                logger.debug("composite mimir: wrote %r to mount %r", path, name)
            except Exception as exc:
                logger.warning("composite mimir: upsert_page failed on %r: %s", name, exc)
