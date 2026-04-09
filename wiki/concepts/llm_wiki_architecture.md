# LLM Wiki Architecture

The **[[patterns/llm_wiki_pattern|LLM Wiki Pattern]]** relies on a specific structural arrangement to transition from raw information to a curated knowledge base. This architecture is designed to optimize for high-quality, low-latency reasoning.

## Structural Layers

A robust LLM Wiki architecture consists of three distinct functional layers:

1.  **The Ingestion Layer (Raw Sources)**:
    - **Nature**: Immutable. Once a document (PDF, URL, log, etc.) is ingested, it is never modified.
    - **Role**: Acts as the ground truth for the entire system. It is used by the system to detect when information has become "stale" by comparing the current state of the source with the existing wiki content.
    - **Storage**: Typically stored in a dedicated directory (e.g., `wiki/raw/` or managed by a Mímir adapter).

2.  **The Knowledge Layer (The Wiki)**:
    - **Nature**: Mutable and Synthesized. This is the core "intelligence" of the system.
    - **Role**: Contains structured Markdown pages that represent the LLM's current understanding. Instead of raw text, these pages contain deduplicated, cross-linked, and high-level syntheses of information.
    - **Organization**: Pages are organized into categories (e.g., concepts, patterns, implementations) and are interconnected via a graph-like structure using cross-links (e.g., `[[Page Title]]`).

3.  **The Governance Layer (Schema Documents)**:
    - **Nature**: Directive.
    - **Role**: Provides the "rules of engagement" for the LLM author. These documents (like `MIMIR.md` or `WIKI.md`) define the directory structure, the required page format, the synthesis methodology, and the criteria for linting and staleness.

## Data Flow

1.  **Ingest**: Raw Source $\rightarrow$ LLM (Reasoning/Synthesis) $\rightarrow$ Wiki Page update/creation.
2.  **Query**: User Question $\rightarrow$ Wiki Index $\rightarrow$ Relevant Wiki Pages $\rightarrow$ LLM (Synthesized Answer).
3.  **Maintenance**: Monitor Raw Sources/Usage $\rightarrow$ Detect Staleness/Gaps $\rightarrow$ LLM (Linting/Refinement) $\rightarrow$ Wiki Update.

## Architectural Goals

- **Decoupling Reasoning from Querying**: Moving the heavy lifting (reasoning/deduplication) to the ingest phase ensures that query-time is exceptionally fast and context-rich.
- **Compound Interest of Knowledge**: As more sources are ingested, the wiki becomes more interconnected and valuable, growing in "intelligence" over time.
- **Autonomous Curation**: The architecture enables autonomous agents (like Ravn) to act as librarians, constantly cleaning, linking, and updating the knowledge base without human intervention.

## Related Pages
- [[patterns/llm_wiki_pattern|LLM Wiki Pattern]]
- [[implementations/odin/mimir/mimir|Mímir (ODIN Implementation)]]
