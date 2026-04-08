# LLM Wiki Architecture

The architecture of an LLM-driven wiki is designed to facilitate autonomous knowledge synthesis, long-term durability, and efficient retrieval. Unlike traditional databases, this architecture prioritizes the *process* of reasoning as a core part of the storage lifecycle.

## Component Layers

A robust LLM wiki architecture is typically divided into three functional layers:

### 1. Ingestion & Ground Truth Layer (Raw Sources)
This layer acts as the "memory" of the system.
- **Immutability**: Raw data (PDFs, URLs, logs) must be stored in an immutable format to ensure the integrity of the synthesis process.
- **Staleness Tracking**: By maintaining a link between raw sources and the synthesized pages they informed, the system can detect when new information contradicts or updates existing knowledge.

### 2. Synthesis & Knowledge Layer (The Wiki)
This is the "intelligence" layer where raw data is transformed into structured knowledge.
- **Markdown-Centric**: Using human-readable, LLM-friendly Markdown allows for easy version control, cross-linking, and structural manipulation.
- **Synthesis-at-Ingest**: Knowledge is not just retrieved; it is processed. The LLM identifies claims, resolves contradictions, and deduplicates information *before* a query is ever made.
- **Graph-Based Linking**: Pages are not isolated documents but nodes in a knowledge graph, connected via semantic cross-links.

### 3. Governance Layer (The Schema)
This layer provides the "instructions" for the autonomous agent.
- **The Schema Document**: A central directive (e.g., `MIMIR.md`) that defines:
    - Directory structures.
    - Metadata standards (tags, timestamps, source references).
    - Synthesis rules (how to handle conflicting information).
    - Maintenance protocols (when and how to lint or refresh pages).

## Data Flow

1. **Detection**: A trigger detects a new raw source.
2. **Ingest**: An agent reads the source, compares it against the existing wiki index, and performs reasoning.
3. **Synthesis**: The agent writes or updates Markdown pages and updates the cross-link graph.
4. **Maintenance**: Periodic linting processes identify gaps or stale content, feeding back into the Ingest layer.

## Architectural Trade-offs

| Factor | LLM Wiki Architecture | Traditional RAG/Vector DB |
| :--- | :--- | :--- |
| **Storage Cost** | Higher (requires synthesized pages) | Lower (stores raw chunks) |
| **Compute Cost** | High at Ingest | High at Query |
| **Reasoning Quality**| High (pre-reasoned/structured) | Variable (context-dependent) |
| **Maintenance** | Active (requires linting/refreshing) | Passive (mostly append-only) |

## Related Concepts
- [[patterns/llm_wiki_pattern|LLM Wiki Pattern]]
- [[implementations/odin/mimir|Mímir (ODIN Implementation)]]
