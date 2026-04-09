# Mímir Architecture

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
