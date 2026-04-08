# Karpathy LLM Wiki

This page summarizes the source material regarding Andrej Karpathy's proposal for the **[[patterns/llm_wiki_pattern|LLM Wiki Pattern]]**.

## Overview

In April 2025, Andrej Karpathy proposed a new pattern for personal knowledge management (PKM) that utilizes LLMs as active authors of a structured wiki rather than passive retrieval tools.

## Core Principles

The pattern revolves around a three-layer architecture:

1.  **Raw Sources**: Immutable ingested documents (URLs, PDFs, logs) used for staleness detection.
2.  **Wiki**: LLM-owned Markdown pages that are organized, cross-linked, and continuously updated as understanding improves.
3.  **Schema Document**: A governing file (e.g., `WIKI.md` or `MIMIR.md`) that defines the rules for maintenance, directory layout, and synthesis.

## Key Differences from RAG

Unlike standard Retrieval-Augmented Generation (RAG), which performs reasoning at query-time on raw chunks, the LLM Wiki pattern performs reasoning **upfront during ingestion**. This results in:
- Faster query times.
- Higher quality, deduplicated, and pre-synthesized knowledge.
- A graph-like knowledge structure through cross-linking.

## ODIN Implementation: Mímir

ODIN implements this as **[[implementations/odin/mimir/mimir|Mímir]]**, utilizing tools like `mimir_ingest` and `mimir_lint` to automate the lifecycle of knowledge.

### Mímir Extensions

Mímir expands on the original concept with:
- **Research Flow**: Targeted web searches during ingestion to maintain recency.
- **Staleness Scheduling**: Prioritizing updates for frequently accessed pages when sources change.

## Metadata

- **Source ID**: `src_2d7c0b059d2d9bd0`
- **Ingested**: 2026-04-08
- **Type**: research
