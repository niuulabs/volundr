import os
from pathlib import Path

root = Path('mimir_workspace')
wiki = root / 'wiki'
raw = root / 'raw'

(wiki / 'research').mkdir(parents=True, exist_ok=True)
(wiki / 'technical').mkdir(parents=True, exist_ok=True)
raw.mkdir(parents=True, exist_ok=True)

research_content = '# The LLM Wiki Pattern

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
'

technical_content = '# Mímir Architecture

Mímir is the implementation of the LLM Wiki Pattern within the ODIN platform. It manages the lifecycle of knowledge from ingestion to synthesis and maintenance.

## Components

The architecture consists of several key layers and tools:

- **MarkdownMimirAdapter**: Manages the filesystem (raw sources, wiki pages, index, and logs).
- **Ravn Agent**: Acts as the LLM author, performing synthesis, writing pages, and cross-linking.
- **Mimir Tools**: A suite of six tools (, , , , , ) that allow the agent to interact with the wiki.

## Key Mechanisms

- **Ingest Flow**: Reads raw sources $ightarrow$ identifies claims $ightarrow$ updates/creates wiki pages $ightarrow$ updates index and log.
- **MimirSourceTrigger**: A daemon-mode process that monitors raw sources and enqueues synthesis tasks for the  persona.
- **Staleness Detection**: Uses  and  to identify frequently read pages that require refresh when underlying sources change.
- **Research Flow**: Optional web searches are conducted during ingestion of time-sensitive sources to ensure accuracy.

<!-- sources: src_2d7c0b059d2d9bd0 -->
'

(wiki / 'research' / 'llm-wiki-pattern.md').write_text(research_content)
(wiki / 'technical' / 'mimir-architecture.md').write_text(technical_content)

index_content = '# Mímor — content catalog

- [The LLM Wiki Pattern](research/llm-wiki-pattern.md) — The LLM Wiki Pattern concept. *(added 2026-04-08, research)*
- [Mímir Architecture](technical/mimir-architecture.md) — Overview of Mímir architecture. *(added 2026-04-08, technical)*
'
(wiki / 'index.md').write_text(index_content)

log_content = '# Mímir — activity log

## [2026-04-08] ingest | Karpathy Llm Wiki
source_id=src_2d7c0b059d2d9bd0 type=research

## [2026-04-08] ingest | llm-wiki-pattern.md
Pages updated: research/llm-wiki-pattern.md, technical/mimir-architecture.md

## [2026-04-08] ingest | mimir-architecture.md
Pages updated: research/llm-wiki-pattern.md, technical/mimir-architecture.md
'
(wiki / 'log.md').write_text(log_content)

print('Synthesis complete.')
