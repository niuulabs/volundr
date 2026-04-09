# The LLM Wiki Pattern

The LLM Wiki Pattern is a personal knowledge management method where an LLM acts as the primary author of a structured wiki, rather than just a reasoning engine over raw text.

## Core Concept

Instead of performing Retrieval-Augmented Generation (RAG) on raw chunks at query time, the LLM performs reasoning and synthesis at **ingest time**. This results in a durable, cross-linked, and deduplicated knowledge base that is optimized for fast querying.

## Three-Layer Architecture

The pattern relies on a structured three-layer stack:

- **Raw Sources**: Immutable documents (URLs, PDFs, logs) used for staleness detection.
- **Wiki**: LLM-synthesized Markdown pages organized by category and cross-linked.
- **Schema Document**: A guide (e.g., ) defining directory structure, page formats, and synthesis rules.

## Comparison with RAG

| Feature | RAG | LLM Wiki Pattern |
|---------|-----|-------------------|
| **Reasoning Time** | Query time | Ingest time |
| **Knowledge State** | Raw chunks | Synthesized pages |
| **Complexity** | Lower | Higher (requires disciplined synthesis) |
| **Query Speed** | Moderate | Fast |

<!-- sources: src_2d7c0b059d2d9bd0 -->
