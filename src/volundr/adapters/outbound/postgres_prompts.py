"""PostgreSQL adapter for saved prompt repository."""

from __future__ import annotations

from uuid import UUID

import asyncpg

from volundr.domain.models import PromptScope, SavedPrompt
from volundr.domain.ports import SavedPromptRepository


class PostgresPromptRepository(SavedPromptRepository):
    """PostgreSQL implementation of SavedPromptRepository using raw SQL."""

    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def create(self, prompt: SavedPrompt) -> SavedPrompt:
        """Persist a new saved prompt."""
        await self._pool.execute(
            """
            INSERT INTO saved_prompts
                (id, name, content, scope, project_repo, tags, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            prompt.id,
            prompt.name,
            prompt.content,
            prompt.scope.value,
            prompt.project_repo,
            prompt.tags,
            prompt.created_at,
            prompt.updated_at,
        )
        return prompt

    async def get(self, prompt_id: UUID) -> SavedPrompt | None:
        """Retrieve a saved prompt by ID."""
        row = await self._pool.fetchrow(
            "SELECT * FROM saved_prompts WHERE id = $1",
            prompt_id,
        )
        if row is None:
            return None
        return self._row_to_prompt(row)

    async def list(
        self,
        scope: PromptScope | None = None,
        repo: str | None = None,
    ) -> list[SavedPrompt]:
        """List saved prompts with optional filters."""
        conditions: list[str] = []
        params: list = []
        idx = 1

        if scope is not None:
            conditions.append(f"scope = ${idx}")
            params.append(scope.value)
            idx += 1

        if repo is not None:
            conditions.append(f"(scope = 'global' OR project_repo = ${idx})")
            params.append(repo)
            idx += 1

        where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
        query = f"SELECT * FROM saved_prompts{where} ORDER BY updated_at DESC"

        rows = await self._pool.fetch(query, *params)
        return [self._row_to_prompt(row) for row in rows]

    async def update(self, prompt: SavedPrompt) -> SavedPrompt:
        """Update an existing saved prompt."""
        await self._pool.execute(
            """
            UPDATE saved_prompts
            SET name = $2, content = $3, scope = $4, project_repo = $5,
                tags = $6, updated_at = $7
            WHERE id = $1
            """,
            prompt.id,
            prompt.name,
            prompt.content,
            prompt.scope.value,
            prompt.project_repo,
            prompt.tags,
            prompt.updated_at,
        )
        return prompt

    async def delete(self, prompt_id: UUID) -> bool:
        """Delete a saved prompt."""
        result = await self._pool.execute(
            "DELETE FROM saved_prompts WHERE id = $1",
            prompt_id,
        )
        return result == "DELETE 1"

    async def search(self, query: str) -> list[SavedPrompt]:
        """Search prompts by name and content (case-insensitive).

        Results are sorted by relevance: name matches first, then content matches.
        """
        pattern = f"%{query}%"
        rows = await self._pool.fetch(
            """
            SELECT *,
                CASE WHEN name ILIKE $1 THEN 0 ELSE 1 END AS relevance
            FROM saved_prompts
            WHERE name ILIKE $1 OR content ILIKE $1
            ORDER BY relevance, updated_at DESC
            """,
            pattern,
        )
        return [self._row_to_prompt(row) for row in rows]

    @staticmethod
    def _row_to_prompt(row: asyncpg.Record) -> SavedPrompt:
        """Convert a database row to a SavedPrompt domain model."""
        return SavedPrompt(
            id=row["id"],
            name=row["name"],
            content=row["content"],
            scope=PromptScope(row["scope"]),
            project_repo=row["project_repo"],
            tags=list(row["tags"]) if row["tags"] else [],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
