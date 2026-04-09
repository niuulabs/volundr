# Mímir (ODIN Implementation)

**Mímir** is the implementation of the LLM Wiki Pattern within the ODIN framework. It uses a \`MarkdownMimirAdapter\` to manage the filesystem.

## Core Components
- **MarkdownMimirAdapter**: Manages raw sources, wiki pages, the index, and logs.
- **Ravn Tools**:
  - \`mimir_ingest\`: Performs the synthesis.
  - \`mimir_query\`: Retrieves and synthesizes answers.
  - \`mimir_read\`: Reads wiki pages.
  - \`mimir_write\`: Writes wiki pages.
  - \`mimir_search\`: Searches the index.
  - \`mimir_lint\`: Performs health checks.
- **MimirSourceTrigger**: Automatically detects new raw sources and enqueues synthesis tasks for the \`mimir-curator\` persona.

## Advanced Features
1. **Research Flow**: For time-sensitive sources, Ravn performs targeted web searches to ensure recency before synthesis.
2. **Staleness Scheduling**: Uses \`MimirUsagePort\` to track page popularity and prioritize refreshing pages when their underlying sources change.

[[LLM Wiki Pattern]]