# Mímir Wiki Schema

This document defines the rules and structure for maintaining the Mímir wiki.

## Directory Layout

- `wiki/patterns/`: High-level architectural and conceptual patterns.
- `wiki/implementations/`: Specific software or system implementations.
- `wiki/concepts/`: Fundamental definitions and ideas.
- `wiki/raw/`: (Managed by system) Immutable source documents.

## Page Format

All wiki pages must be in Markdown format and follow these rules:
1. **Title**: Start with a single `# Title` heading.
2. **Conciseness**: Write synthesised, concise content. Avoid raw transcription.
3. **Cross-linking**: Use `[[Page Title]]` or standard Markdown links to connect related concepts.
4. **Metadata**: (Optional) Include metadata blocks if required by specific implementations.

## Synthesis Rules

When ingesting a new source:
1. **Analyze**: Extract key claims and concepts.
2. **Check**: Search the existing wiki for related topics to avoid duplication.
3. **Update/Create**: 
   - If a topic exists, update the existing page to incorporate new information.
   - If a new topic is identified, create a new page in the appropriate category.
4. **Link**: Identify and add cross-links between the new/updated page and existing pages.
5. **Index**: Ensure the `index.md` (if present) is updated.

## Staleness and Linting

- **Staleness**: A page is considered stale if its underlying raw source has changed.
- **Linting**: The system periodically checks for:
  - **Orphans**: Pages not linked from the main index.
  - **Contradictions**: Flagged conflicting information.
  - **Gaps**: Frequent mentions of concepts without dedicated pages.
