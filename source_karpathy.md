# The LLM Wiki Pattern — Andrej Karpathy, April 2025

Andrej Karpathy published a gist proposing a new pattern for personal knowledge management using LLMs. The core idea: instead of storing notes as raw text and asking an LLM to reason over them at query time, you maintain a structured wiki where the LLM is the author. The LLM reads raw sources and synthesises them into durable, cross-linked wiki pages. The wiki accumulates and compounds over time.

## Three-layer architecture

The pattern has three layers:

- **Raw sources** — immutable ingested documents (URLs, PDFs, conversation logs). Never modified after ingest. Used for staleness detection.
- **Wiki** — LLM-owned Markdown pages, organised by category, cross-linked. This is the knowledge base. The LLM rewrites pages as understanding improves.
- **Schema document** — a `WIKI.md` (or `MIMIR.md` in ODIN) that tells the LLM how to maintain the wiki: directory layout, page format, synthesis rules, staleness criteria.

## Key operations

**Ingest**: the LLM reads a raw source, identifies key claims, checks existing pages for overlap, creates or updates pages, cross-links, updates the index.

**Query**: the LLM reads the index, pulls relevant pages, synthesises an answer. Optionally writes the answer as a new page if the question recurs.

**Lint**: periodic health check — find orphan pages, contradictions, concept gaps, stale sources. Fix or flag.

## What makes it different from RAG

RAG retrieves raw chunks at query time and reasons over them. The wiki pattern does the reasoning upfront, at ingest time. Query time is fast and the knowledge is already synthesised, cross-linked, and deduplicated. The tradeoff: you need a disciplined synthesis step and a good schema document.

## ODIN implementation — Mímir

ODIN implements this pattern as Mímir. The `MarkdownMimirAdapter` manages the filesystem layer (raw sources, wiki pages, index, log). Six Ravn tools wrap it: `mimir_ingest`, `mimir_query`, `mimir_read`, `mimir_write`, `mimir_search`, `mimir_lint`. Ravn acts as the LLM author — it reads sources and writes pages.

The `MimirSourceTrigger` closes the loop: it polls for raw sources that have no corresponding wiki pages and enqueues synthesis tasks for the `mimir-curator` persona to process autonomously in daemon mode.

Two extensions beyond Karpathy's original:
1. **Research flow** — after ingesting a time-sensitive source, Ravn optionally runs 1-2 targeted web searches before synthesising, to catch recent updates.
2. **Staleness scheduling** — `MimirStalenessTrigger` uses `MimirUsagePort` to surface frequently-read pages and prioritise refresh work when sources change.
