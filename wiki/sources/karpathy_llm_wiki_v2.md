# Karpathy LLM Wiki

This page documents the synthesis of the source material: **Karpathy Llm Wiki** (Source ID: `src_2d7c0b059d2d9bd0`).

The source describes the **[[patterns/llm_wiki_pattern|LLM Wiki Pattern]]** proposed by Andrej Karpathy in April 2025. This pattern transitions personal knowledge management (PKM) from a passive RAG-based approach to an active, LLM-driven synthesis approach.

## Summary of Key Concepts

- **The LLM Wiki Pattern**: A methodology where an LLM acts as an active author, synthesizing raw sources into a structured, cross-linked wiki.
- **Three-Layer Architecture**: 
    1. **Raw Sources**: Immutable, ingested documents used for staleness detection.
    2. **Wiki**: LLM-owned, structured Markdown pages that accumulate knowledge.
    3. **Schema Document**: Instructions (e.g., `MIMIR.md`) defining the wiki's maintenance rules.
- **Key Operations**: 
    - **Ingest**: Analysis, checking for overlaps, creation/update, cross-linking, and indexing.
    - **Query**: Fast retrieval of pre-synthesized knowledge.
    - **Lint**: Periodic maintenance to address orphans, contradictions, or gaps.
- **Comparison to RAG**: Unlike RAG, which performs reasoning at query time, the Wiki pattern performs reasoning upfront during ingestion, resulting in faster, more coherent retrieval.

## ODIN Extensions (Mímir)

Mímir implements this pattern with two specific enhancements:
1. **Research Flow**: Targeted web searches to ensure recency during synthesis.
2. **Staleness Scheduling**: Using usage data to prioritize refreshing frequently-read pages when sources change.

## References
- [[patterns/llm_wiki_pattern|LLM Wiki Pattern]]
- [[implementations/odin/mimir/mimir|Mímir (ODIN Implementation)]]
