# LLM Wiki Pattern

The **LLM Wiki Pattern** is a personal knowledge management (PKM) methodology where an LLM acts as an active, autonomous author rather than a passive retrieval engine. 

Proposed by Andrej Karpathy in April 2025, this pattern moves the "reasoning" step from query-time (as seen in standard RAG) to ingest-time.

## Core Architecture

The pattern relies on a three-layer architecture to maintain a high-fidelity, evolving knowledge base:

1.  **Raw Sources (Immutable)**: Ingested documents (URLs, PDFs, logs) that are never modified. They serve as the immutable ground truth used for staleness detection.
2.  **Wiki (Synthesized)**: A collection of structured, LLM-authored Markdown pages. These pages are mutable, deduplicated, and cross-linked to represent a synthesized "state of understanding."
3.  **Schema Document (Governing)**: A directive file (e.g., `WIKI.md` or `MIMIR.md`) that instructs the LLM on directory layout, page formats, synthesis rules, and maintenance criteria.

## Key Operations

*   **Ingest**: The LLM reads raw sources, identifies key claims, checks for existing overlaps, creates/updates wiki pages, and establishes cross-links.
*   **Query**: The LLM uses a wiki index to pull relevant, pre-synthesized pages to generate high-quality answers quickly.
*   **Lint**: A periodic autonomous health check to identify orphan pages, contradictions, concept gaps, or stale sources.

## LLM Wiki Pattern vs. RAG

| Feature | RAG (Retrieval-Augmented Generation) | LLM Wiki Pattern |
| :--- | :--- | :--- |
| **Reasoning Timing** | At query-time | At ingest-time |
| **Knowledge State** | Raw, fragmented chunks | Synthesized, structured pages |
| **Contextual Depth** | Flat retrieval | Graph-based (cross-linked) |
| **Complexity** | Lower (passive) | Higher (requires disciplined synthesis) |
| **Query Speed** | Dependent on retrieval/reasoning | Very fast (reasoning is pre-done) |

## Implementation in ODIN

In the ODIN framework, this pattern is implemented as **[[implementations/odin/mimir|Mímir]]**. 

Mímir uses the `MarkdownMimirAdapter` to manage the filesystem and provides tools like `mimir_ingest`, `mimir_query`, and `mimir_lint`. The `MimirSourceTrigger` automates the loop by enqueuing synthesis tasks whenever new raw sources are detected.

## Related Concepts
* [[concepts/llm_wiki_architecture|LLM Wiki Architecture]]
* [[implementations/odin/mimir|Mímir (ODIN Implementation)]]
