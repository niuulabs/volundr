"""MarkdownMimirAdapter — filesystem-backed Mímir knowledge base.

Directory layout (all paths relative to the configured ``root``):

    wiki/
      index.md          — content catalog, updated on every ingest/lint
      log.md            — append-only chronological record
      <category>/       — subdirectories per top-level category
        <page>.md       — individual wiki pages
    raw/
      <source_id>.json  — immutable source metadata + content
    MIMIR.md            — schema and conventions (seeded on first run)

The adapter is intentionally LLM-free: it manages the *filesystem layer* only.
All synthesis (writing page content, answering queries) is performed by the
Ravn agent using the six mimir_* tool wrappers.

Staleness detection note
------------------------
Lint-level staleness detection (checking whether a wiki page's source has
changed) cannot re-fetch remote URLs, so the lint pass never populates the
``stale`` field of ``MimirLintReport``.  Real staleness detection is triggered
during re-ingest: call ``is_source_stale(source_id, current_content)`` *before*
calling ``ingest()`` — if it returns True, the source has changed and the
derived wiki pages should be reviewed and updated.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime
from pathlib import Path

from niuu.domain.mimir import (
    MimirLintReport,
    MimirPage,
    MimirPageMeta,
    MimirQueryResult,
    MimirSource,
    MimirSourceMeta,
    compute_content_hash,
)
from niuu.ports.mimir import MimirPort

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_MIMIR_MD_SEED = """\
# Mímir — wiki schema and conventions

## Directory structure

```
wiki/
  index.md          — content catalog, one line per page
  log.md            — append-only chronological record
  technical/        — infrastructure, codebase, how things work
    volundr/        — platform architecture, session management, auth
    ravn/           — agent architecture, tool configs, known quirks
    valaskjalf/     — cluster layout, node specs, workload placement
    k8s/            — kubernetes patterns, Kyverno policies
  projects/         — KVM models, ODIN platform, active Linear sagas
  research/         — topic deep-dives (one-time or ongoing)
  household/        — Burlington home, Netherlands property, finances
  self/             — patterns, preferences, rhythms (earned through observation)
raw/                — immutable source documents (JSON metadata + content)
MIMIR.md            — this file
```

## Page format

- Filename: lowercase, hyphen-separated, `.md` extension
- Title: first `# Heading` in the file
- Summary: second line of the file (after the heading), one sentence
- Links use relative paths: `[auth](../volundr/auth.md)`

## Operations

- **Ingest**: read source → identify takeaways → write or update wiki pages →
  update `index.md` → append to `log.md`
- **Query**: read `index.md` → read relevant pages → synthesise answer →
  optionally write answer as new page → append to `log.md`
- **Lint**: scan for orphans, contradictions, gaps →
  fix or flag → update `index.md` and `log.md`

## Staleness detection

Lint cannot re-fetch remote URLs so it does not populate the `stale` report
field.  Call `is_source_stale(source_id, current_content)` before re-ingesting
a source to detect whether the original content has changed.

## Log entry format

```
## [YYYY-MM-DD] ingest | <title>
## [YYYY-MM-DD] query  | <question>
## [YYYY-MM-DD] lint   | <pages> pages checked, <issues> issues found
```

## Categories

- **technical/**: infrastructure, codebase, how things work
- **projects/**: KVM models, ODIN platform, active Linear sagas
- **research/**: topic deep-dives
- **household/**: Burlington, Netherlands, finances
- **self/**: earned through observation — patterns, preferences, rhythms

## self/ conventions

- Written in third person ("Jozef typically...", "Prefers...")
- Only concrete observations, not inferences
- Updated when a pattern is observed at least twice

## Synthesis workflow

When processing a raw source, follow these steps in order:

1. Call `mimir_query` with the source's main topic — check for existing pages that overlap.
2. Call `mimir_ingest` to persist the raw source (assigns a `source_id`).
3. Read the source content and identify 3-7 distinct key claims worth preserving.
4. For each claim, decide: does it belong on an existing page, or does it warrant a new one?
5. Optionally run 1-2 targeted `web_search` calls if recency matters (versioned tools,
   dated facts, ongoing events). Do not research for research's sake.
6. Write or update wiki pages with `mimir_write`. Each page: concise synthesis, not
   transcription. One claim per section. Relative cross-links. `<!-- sources: id -->` footer.
7. Call `mimir_search` to find related pages — add cross-links where relevant.
8. Append to `wiki/log.md` via `mimir_write`.

## Page quality criteria

A well-formed Mímir wiki page:
- Opens with a `# Title` heading and a one-sentence summary on the second line.
- Uses `##` sections for each distinct claim or concept.
- States facts concisely — never transcribes source text verbatim.
- Links to related pages with relative markdown paths: `[auth](../volundr/auth.md)`.
- Closes with a `<!-- sources: source_id1,source_id2 -->` HTML comment.
- Does NOT contain speculation, personal opinions, or unverified claims.

## Staleness criteria

A page is considered stale when:
- Its `<!-- sources: ... -->` source_ids reference a raw source whose `content_hash`
  has changed (re-ingest detected a difference).
- It references facts that are time-sensitive (software versions, statuses, dates)
  and has not been updated in more than 30 days.

When `mimir_lint` flags a page as stale, re-read the raw source and update the page
with any changed facts before removing the stale flag.
"""

_LOG_INGEST_PREFIX = "ingest"
_LOG_QUERY_PREFIX = "query"
_LOG_LINT_PREFIX = "lint"

_MIN_GAP_MENTION_COUNT = 3  # mentions before a concept is flagged as a gap


# ---------------------------------------------------------------------------
# Path security (local import to avoid circular deps)
# ---------------------------------------------------------------------------


class PathSecurityError(ValueError):
    """Raised when a path escapes the wiki directory."""


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class MarkdownMimirAdapter(MimirPort):
    """Filesystem-backed Mímir knowledge base adapter.

    Args:
        root: Root directory for the Mímir store (e.g. ``~/.ravn/mimir``).
    """

    def __init__(self, root: str | Path = "~/.ravn/mimir") -> None:
        self._root = Path(root).expanduser()
        self._wiki = self._root / "wiki"
        self._raw = self._root / "raw"
        self._schema = self._root / "MIMIR.md"
        self._index = self._wiki / "index.md"
        self._log = self._wiki / "log.md"
        self._ensure_layout()

    # ------------------------------------------------------------------
    # Layout bootstrap
    # ------------------------------------------------------------------

    def _ensure_layout(self) -> None:
        """Create the directory structure and seed MIMIR.md on first run."""
        self._wiki.mkdir(parents=True, exist_ok=True)
        self._raw.mkdir(parents=True, exist_ok=True)

        if not self._schema.exists():
            self._schema.write_text(_MIMIR_MD_SEED, encoding="utf-8")
            logger.info("mimir: seeded MIMIR.md at %s", self._schema)

        if not self._index.exists():
            self._index.write_text("# Mímir — content catalog\n\n", encoding="utf-8")

        if not self._log.exists():
            self._log.write_text("# Mímir — activity log\n\n", encoding="utf-8")

    # ------------------------------------------------------------------
    # Path security
    # ------------------------------------------------------------------

    def _safe_wiki_path(self, path: str) -> Path:
        """Resolve *path* to an absolute path that lies within the wiki root.

        Raises ``PathSecurityError`` if the resolved path escapes the wiki
        directory (e.g. due to ``../`` traversal components).
        """
        wiki_root = self._wiki.resolve()
        resolved = (self._wiki / path).resolve()
        try:
            resolved.relative_to(wiki_root)
        except ValueError:
            raise PathSecurityError(
                f"Path '{path}' resolves outside the wiki directory '{wiki_root}'"
            )
        return resolved

    # ------------------------------------------------------------------
    # MimirPort implementation
    # ------------------------------------------------------------------

    async def ingest(self, source: MimirSource) -> list[str]:
        """Persist a raw source and record the ingest in the log.

        Returns an empty list — page creation is delegated to the agent via
        ``upsert_page()``.  The raw source is stored for staleness tracking.
        """
        self._write_raw_source(source)
        self._append_log(
            _LOG_INGEST_PREFIX,
            source.title,
            f"source_id={source.source_id} type={source.source_type}",
        )
        logger.info("mimir: ingested source %r (%s)", source.title, source.source_id)
        return []

    async def query(self, question: str) -> MimirQueryResult:
        """Return index content + relevant pages for the agent to synthesise.

        The adapter performs keyword-based relevance ranking.  Full synthesis
        is done by the agent via the ``mimir_query`` tool.
        """
        pages = await self.search(question)
        self._append_log(_LOG_QUERY_PREFIX, question)
        return MimirQueryResult(
            question=question,
            answer="",  # filled in by the agent after reading pages
            sources=pages,
        )

    async def lint(self) -> MimirLintReport:
        """Scan the wiki and return a health-check report.

        The ``stale`` field of the returned report is always empty — staleness
        detection requires re-fetching source URLs, which the lint pass does
        not do.  Use ``is_source_stale()`` during re-ingest instead.
        """
        pages_with_content = self._list_pages_with_content()
        all_pages = [meta for meta, _ in pages_with_content]
        content_map = {meta.path: content for meta, content in pages_with_content}
        indexed = self._read_indexed_paths()

        orphans = self._find_orphans(all_pages, indexed)
        contradictions = self._find_contradictions(content_map)
        gaps = self._find_gaps(all_pages, content_map)

        report = MimirLintReport(
            orphans=orphans,
            contradictions=contradictions,
            stale=[],  # populated by re-ingest flow, not lint pass
            gaps=gaps,
            pages_checked=len(all_pages),
        )

        issues = len(orphans) + len(contradictions) + len(gaps)
        self._append_log(
            _LOG_LINT_PREFIX,
            f"{len(all_pages)} pages checked, {issues} issues found",
        )
        logger.info(
            "mimir: lint complete — %d pages checked, %d issues",
            len(all_pages),
            issues,
        )
        return report

    async def search(self, query: str) -> list[MimirPage]:
        """Full-text search over wiki pages, ranked by keyword hits."""
        if not query.strip():
            return []

        keywords = set(re.split(r"\W+", query.lower())) - {"", "the", "a", "an", "is", "in"}
        results: list[tuple[int, MimirPage]] = []

        for md_path in self._wiki.rglob("*.md"):
            if md_path.name in {"index.md", "log.md"}:
                continue
            content = md_path.read_text(encoding="utf-8")
            lower = content.lower()
            score = sum(lower.count(kw) for kw in keywords)
            if score == 0:
                continue
            meta = self._build_page_meta(md_path, content)
            results.append((score, MimirPage(meta=meta, content=content)))

        results.sort(key=lambda t: t[0], reverse=True)
        return [page for _, page in results]

    async def upsert_page(
        self,
        path: str,
        content: str,
        mimir: str | None = None,
    ) -> None:
        """Create or replace a wiki page and update index.md.

        The *mimir* parameter is accepted for interface compatibility with
        ``CompositeMimirAdapter`` but is ignored here — this adapter always
        writes to its own filesystem root.
        """
        page_path = self._safe_wiki_path(path)
        page_path.parent.mkdir(parents=True, exist_ok=True)

        is_new = not page_path.exists()
        page_path.write_text(content, encoding="utf-8")

        if is_new:
            self._add_to_index(path, content)
        else:
            self._update_index_entry(path, content)

        logger.info("mimir: upserted page %s (new=%s)", path, is_new)

    async def get_page(self, path: str) -> MimirPage:
        """Return content and metadata for the wiki page at *path* in one call."""
        page_path = self._safe_wiki_path(path)
        if not page_path.exists():
            raise FileNotFoundError(f"Mímir page not found: {path}")
        content = page_path.read_text(encoding="utf-8")
        meta = self._build_page_meta(page_path, content)
        return MimirPage(meta=meta, content=content)

    async def read_page(self, path: str) -> str:
        """Return the raw Markdown content of the page at *path*."""
        page_path = self._safe_wiki_path(path)
        if not page_path.exists():
            raise FileNotFoundError(f"Mímir page not found: {path}")
        return page_path.read_text(encoding="utf-8")

    async def list_pages(
        self,
        category: str | None = None,
    ) -> list[MimirPageMeta]:
        """List all wiki pages, optionally filtered by category."""
        return [meta for meta, _ in self._list_pages_with_content(category)]

    async def read_source(self, source_id: str) -> MimirSource | None:
        """Return the full raw source by ID, or None if not found."""
        return self.read_raw_source(source_id)

    async def list_sources(self, *, unprocessed_only: bool = False) -> list[MimirSourceMeta]:
        """List all ingested raw sources.

        When *unprocessed_only* is True, returns only sources not yet referenced
        by any wiki page (cross-referenced via ``<!-- sources: ... -->`` footers).
        """
        if not self._raw.exists():
            return []

        all_sources: list[MimirSourceMeta] = []
        for json_path in self._raw.glob("*.json"):
            try:
                data = json.loads(json_path.read_text(encoding="utf-8"))
                all_sources.append(
                    MimirSourceMeta(
                        source_id=data["source_id"],
                        title=data["title"],
                        ingested_at=datetime.fromisoformat(data["ingested_at"]),
                        source_type=data["source_type"],
                    )
                )
            except Exception as exc:
                logger.warning("Mímir: failed to read raw source %s: %s", json_path.name, exc)

        if not unprocessed_only:
            return all_sources

        # Collect all source_ids referenced across wiki pages
        referenced_ids: set[str] = set()
        for _, content in self._list_pages_with_content():
            referenced_ids.update(self._extract_source_ids(content))

        # Build a map of content_hash → source_id for all referenced sources so that
        # re-ingested sources with identical content (same hash, new id) are not
        # re-synthesised.
        referenced_hashes: set[str] = set()
        for src in all_sources:
            if src.source_id in referenced_ids:
                # Load the full source to get its hash
                full = self.read_raw_source(src.source_id)
                if full is not None:
                    referenced_hashes.add(full.content_hash)

        results: list[MimirSourceMeta] = []
        for src in all_sources:
            if src.source_id in referenced_ids:
                continue
            full = self.read_raw_source(src.source_id)
            if full is not None and full.content_hash in referenced_hashes:
                continue
            results.append(src)
        return results

    # ------------------------------------------------------------------
    # Raw source storage
    # ------------------------------------------------------------------

    def _write_raw_source(self, source: MimirSource) -> None:
        """Persist a raw source as JSON in the raw/ directory."""
        dest = self._raw / f"{source.source_id}.json"
        data = {
            "source_id": source.source_id,
            "title": source.title,
            "content": source.content,
            "source_type": source.source_type,
            "origin_url": source.origin_url,
            "content_hash": source.content_hash,
            "ingested_at": source.ingested_at.isoformat(),
        }
        dest.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def read_raw_source(self, source_id: str) -> MimirSource | None:
        """Read a persisted raw source by ID.  Returns None if not found."""
        dest = self._raw / f"{source_id}.json"
        if not dest.exists():
            return None
        data = json.loads(dest.read_text(encoding="utf-8"))
        return MimirSource(
            source_id=data["source_id"],
            title=data["title"],
            content=data["content"],
            source_type=data["source_type"],
            origin_url=data.get("origin_url"),
            content_hash=data["content_hash"],
            ingested_at=datetime.fromisoformat(data["ingested_at"]),
        )

    @staticmethod
    def compute_content_hash(content: str) -> str:
        """Return the SHA-256 hex digest of *content*.

        Delegates to ``niuu.domain.mimir.compute_content_hash``.
        Kept as a static method for backwards compatibility with callers that
        reference it via ``MarkdownMimirAdapter.compute_content_hash``.
        """
        return compute_content_hash(content)

    def is_source_stale(self, source_id: str, current_content: str) -> bool:
        """Return True if the stored hash differs from the hash of *current_content*.

        This is the correct staleness check: call it before re-ingesting a
        source to see whether the content has changed since the last ingest.
        """
        existing = self.read_raw_source(source_id)
        if existing is None:
            return False
        current_hash = compute_content_hash(current_content)
        return existing.content_hash != current_hash

    # ------------------------------------------------------------------
    # Index management
    # ------------------------------------------------------------------

    def _read_indexed_paths(self) -> set[str]:
        """Return the set of page paths currently listed in index.md."""
        if not self._index.exists():
            return set()
        content = self._index.read_text(encoding="utf-8")
        return set(re.findall(r"\[.*?\]\(([^)]+\.md)\)", content))

    def _add_to_index(self, path: str, content: str) -> None:
        """Append a new entry to index.md."""
        title = _extract_title(content)
        summary = _extract_summary(content)
        category = path.split("/")[0] if "/" in path else "uncategorised"
        date_str = datetime.now(UTC).strftime("%Y-%m-%d")
        entry = f"- [{title}]({path}) — {summary} *(added {date_str}, {category})*\n"
        with self._index.open("a", encoding="utf-8") as f:
            f.write(entry)

    def _update_index_entry(self, path: str, content: str) -> None:
        """Update the summary in an existing index.md entry for *path*."""
        if not self._index.exists():
            return
        index_content = self._index.read_text(encoding="utf-8")
        title = _extract_title(content)
        summary = _extract_summary(content)
        new_lines = []
        for line in index_content.splitlines(keepends=True):
            if f"]({path})" in line:
                meta_match = re.search(r"\*\(.*?\)\*", line)
                meta = meta_match.group(0) if meta_match else ""
                line = f"- [{title}]({path}) — {summary} {meta}\n".rstrip() + "\n"
            new_lines.append(line)
        self._index.write_text("".join(new_lines), encoding="utf-8")

    # ------------------------------------------------------------------
    # Log management
    # ------------------------------------------------------------------

    def _append_log(self, prefix: str, subject: str, detail: str = "") -> None:
        """Append a structured entry to log.md."""
        date_str = datetime.now(UTC).strftime("%Y-%m-%d")
        entry = f"\n## [{date_str}] {prefix} | {subject}\n"
        if detail:
            entry += f"{detail}\n"
        with self._log.open("a", encoding="utf-8") as f:
            f.write(entry)

    # ------------------------------------------------------------------
    # Lint helpers
    # ------------------------------------------------------------------

    def _find_orphans(self, pages: list[MimirPageMeta], indexed: set[str]) -> list[str]:
        """Return paths of pages not linked in index.md."""
        return [p.path for p in pages if p.path not in indexed]

    def _find_contradictions(self, content_map: dict[str, str]) -> list[str]:
        """Return paths of pages that contain a contradiction flag marker."""
        return [
            path
            for path, content in content_map.items()
            if "[CONTRADICTION]" in content or "⚠️ contradiction" in content.lower()
        ]

    def _find_gaps(self, pages: list[MimirPageMeta], content_map: dict[str, str]) -> list[str]:
        """Return concept names mentioned ≥ N times across wiki but without a page."""
        existing_titles = {p.title.lower() for p in pages}
        mention_counts: dict[str, int] = {}

        for content in content_map.values():
            for concept in re.findall(r"\[\[([^\]]+)\]\]", content):
                key = concept.lower().strip()
                if key not in existing_titles:
                    mention_counts[key] = mention_counts.get(key, 0) + 1

        return [
            concept for concept, count in mention_counts.items() if count >= _MIN_GAP_MENTION_COUNT
        ]

    # ------------------------------------------------------------------
    # Metadata helpers
    # ------------------------------------------------------------------

    def _list_pages_with_content(
        self,
        category: str | None = None,
    ) -> list[tuple[MimirPageMeta, str]]:
        """Return all wiki pages with their content, optionally filtered by category."""
        results: list[tuple[MimirPageMeta, str]] = []
        search_root = self._wiki / category if category else self._wiki

        if not search_root.exists():
            return results

        for md_path in search_root.rglob("*.md"):
            if md_path.name in {"index.md", "log.md"}:
                continue
            content = md_path.read_text(encoding="utf-8")
            meta = self._build_page_meta(md_path, content)
            results.append((meta, content))

        return results

    def _build_page_meta(self, md_path: Path, content: str) -> MimirPageMeta:
        """Build a MimirPageMeta from a path and its already-read content."""
        rel = md_path.relative_to(self._wiki)
        path_str = str(rel)
        parts = path_str.split("/")
        category = parts[0] if len(parts) > 1 else "uncategorised"
        stat = md_path.stat()
        updated_at = datetime.fromtimestamp(stat.st_mtime, tz=UTC)
        source_ids = self._extract_source_ids(content)
        return MimirPageMeta(
            path=path_str,
            title=_extract_title(content),
            summary=_extract_summary(content),
            category=category,
            updated_at=updated_at,
            source_ids=source_ids,
        )

    @staticmethod
    def _extract_source_ids(content: str) -> list[str]:
        """Extract source IDs from a page's footer comment.

        Pages may embed source references as: ``<!-- sources: id1,id2 -->``
        """
        match = re.search(r"<!--\s*sources:\s*([^-]+?)\s*-->", content)
        if not match:
            return []
        return [s.strip() for s in match.group(1).split(",") if s.strip()]


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------


def _extract_title(content: str) -> str:
    """Return the first H1 heading from *content*, or 'Untitled'."""
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip()
    return "Untitled"


def _extract_summary(content: str) -> str:
    """Return the first non-heading, non-empty line from *content*."""
    heading_seen = False
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            heading_seen = True
            continue
        if heading_seen:
            return stripped[:120]
    return ""
