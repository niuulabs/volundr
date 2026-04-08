# Karpathy LLM Wiki (Source Synthesis)

This page documents the synthesis of the source material: **Karpathy Llm Wiki** (Source ID: `src_26dea40bd79130a3`).

## Overview

The source describes the **[[patterns/llm_wiki_pattern|LLM Wiki Pattern]]** proposed by Andrej Karpathy in April 2025. This pattern transitions personal knowledge management (PKM) from a passive RAG-based approach to an active, LLM-driven synthesis approach.

## Key Details

### The Three-Layer Architecture
The pattern is built upon three distinct layers:
1.  **Raw Sources**: Immutable documents (URLs, PDFs, logs) used as the ground truth and for staleness detection.
2.  **Wiki**: The knowledge base consisting of structured, cross-linked Markdown pages authored and maintained by the LLM.
3.  **Schema Document**: The governing rules (e.g., `MIMIR.md`) defining layout, format, and synthesis criteria.

### Core Operations
- **Ingest**: The LLM reads raw sources, identifies claims, updates existing pages, and cross-links.
- **Query**: Fast retrieval of pre-synthesized knowledge.
- **Lint**: Periodic health checks to identify gaps, contradictions, or stale information.

### Comparison to RAG
Unlike standard RAG, which retrieves raw chunks at query-time, the Wiki pattern performs reasoning **upfront at ingest-time**. This results in faster queries and higher-quality, deduplicated knowledge, though it requires more disciplined synthesis.

### ODIN Implementation: Mímir
The **[[implementations/odin/mimir|Mímir]]** implementation in ODIN extends the original pattern with:
- **Research Flow**: Integrating web searches during ingestion for better recency.
- **Staleness Scheduling**: Using usage metrics to prioritize page refreshes.

## Source Metadata
- **Title**: Karpathy Llm Wiki
- **Type**: research
- **Ingested**: 2026-04-08T21:01:44.719575+00:00
- **Source ID**: `src_26dea40bd79130a3`

## Related Pages
- [[patterns/llm_wiki_pattern|LLM Wiki Pattern]]
- [[implementations/odin/mimir|Mímir]]
- [[concepts/llm_wiki_architecture|LLM Wiki Architecture]]
