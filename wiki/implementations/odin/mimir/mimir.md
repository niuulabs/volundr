# Mímir (ODIN Implementation)

Mímir is the implementation of the **[[patterns/llm_wiki_pattern|LLM Wiki Pattern]]** within the ODIN framework. It manages the lifecycle of knowledge from raw ingestion to synthesized wiki pages.

## Architecture

Mímir uses the `MarkdownMimirAdapter` to interact with the filesystem, managing the following components:
- **Raw Sources**: The immutable ingestion layer.
- **Wiki Pages**: The structured Markdown knowledge base.
- **Index**: A searchable map of the wiki content.
- **Logs**: A history of synthesis and maintenance operations.

## Toolset

The Mímir implementation is exposed through six primary Ravn tools:

| Tool | Purpose |
| :--- | :--- |
| `mimir_ingest` | Performs the synthesis of raw sources into wiki pages. |
| `mimir_query` | Retrieves and synthesizes answers from the wiki. |
| `mimir_read` | Reads specific wiki pages. |
| `mimir_write` | Writes or updates wiki pages. |
| `mimir_search` | Searches the wiki index. |
| `mimir_lint` | Performs periodic health checks (finds orphans, contradictions, etc.). |

## Autonomous Loops

Mímir features two key autonomous triggers that allow Ravn to act as a curator:

1.  **MimirSourceTrigger**: Automatically detects new raw sources and enqueues synthesis tasks for the `mimir-curator` persona.
2.  **MimirStalenessTrigger**: Uses `MimirUsagePort` to monitor frequently-read pages and prioritize refresh work when underlying sources change.

## Extensions

Beyond the original Karpathy pattern, Mímir includes:
- **Research Flow**: Optionally runs targeted web searches during ingestion to ensure recency.
- **Staleness Scheduling**: Prioritizes maintenance based on usage patterns.

## Related Concepts
- [[patterns/llm_wiki_pattern|LLM Wiki Pattern]]
- [[concepts/llm_wiki_architecture|LLM Wiki Architecture]]
