"""PostgreSQL adapter for preset repository."""

from __future__ import annotations

import json
from uuid import UUID

import asyncpg

from volundr.domain.models import Preset
from volundr.domain.ports import PresetRepository


class PostgresPresetRepository(PresetRepository):
    """PostgreSQL implementation of PresetRepository using raw SQL."""

    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def create(self, preset: Preset) -> Preset:
        """Persist a new preset."""
        await self._pool.execute(
            """
            INSERT INTO volundr_presets
                (id, name, description, is_default, cli_tool, workload_type,
                 model, system_prompt, resource_config, mcp_servers,
                 terminal_sidecar, skills, rules, env_vars, env_secret_refs,
                 source, integration_ids, setup_scripts,
                 workload_config, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                    $13, $14, $15, $16, $17, $18, $19, $20, $21)
            """,
            preset.id,
            preset.name,
            preset.description,
            preset.is_default,
            preset.cli_tool,
            preset.workload_type,
            preset.model,
            preset.system_prompt,
            json.dumps(preset.resource_config),
            json.dumps(preset.mcp_servers),
            json.dumps(preset.terminal_sidecar),
            json.dumps(preset.skills),
            json.dumps(preset.rules),
            json.dumps(preset.env_vars),
            json.dumps(preset.env_secret_refs),
            json.dumps(preset.source.model_dump()) if preset.source else None,
            json.dumps(preset.integration_ids),
            json.dumps(preset.setup_scripts),
            json.dumps(preset.workload_config),
            preset.created_at,
            preset.updated_at,
        )
        return preset

    async def get(self, preset_id: UUID) -> Preset | None:
        """Retrieve a preset by ID."""
        row = await self._pool.fetchrow(
            "SELECT * FROM volundr_presets WHERE id = $1",
            preset_id,
        )
        if row is None:
            return None
        return self._row_to_preset(row)

    async def get_by_name(self, name: str) -> Preset | None:
        """Retrieve a preset by name."""
        row = await self._pool.fetchrow(
            "SELECT * FROM volundr_presets WHERE name = $1",
            name,
        )
        if row is None:
            return None
        return self._row_to_preset(row)

    async def list(
        self,
        cli_tool: str | None = None,
        is_default: bool | None = None,
    ) -> list[Preset]:
        """List presets with optional filters."""
        conditions: list[str] = []
        params: list = []
        idx = 1

        if cli_tool is not None:
            conditions.append(f"cli_tool = ${idx}")
            params.append(cli_tool)
            idx += 1

        if is_default is not None:
            conditions.append(f"is_default = ${idx}")
            params.append(is_default)
            idx += 1

        where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
        query = f"SELECT * FROM volundr_presets{where} ORDER BY updated_at DESC"

        rows = await self._pool.fetch(query, *params)
        return [self._row_to_preset(row) for row in rows]

    async def update(self, preset: Preset) -> Preset:
        """Update an existing preset."""
        await self._pool.execute(
            """
            UPDATE volundr_presets
            SET name = $2, description = $3, is_default = $4, cli_tool = $5,
                workload_type = $6, model = $7, system_prompt = $8,
                resource_config = $9, mcp_servers = $10, terminal_sidecar = $11,
                skills = $12, rules = $13, env_vars = $14, env_secret_refs = $15,
                source = $16, integration_ids = $17, setup_scripts = $18,
                workload_config = $19, updated_at = $20
            WHERE id = $1
            """,
            preset.id,
            preset.name,
            preset.description,
            preset.is_default,
            preset.cli_tool,
            preset.workload_type,
            preset.model,
            preset.system_prompt,
            json.dumps(preset.resource_config),
            json.dumps(preset.mcp_servers),
            json.dumps(preset.terminal_sidecar),
            json.dumps(preset.skills),
            json.dumps(preset.rules),
            json.dumps(preset.env_vars),
            json.dumps(preset.env_secret_refs),
            json.dumps(preset.source.model_dump()) if preset.source else None,
            json.dumps(preset.integration_ids),
            json.dumps(preset.setup_scripts),
            json.dumps(preset.workload_config),
            preset.updated_at,
        )
        return preset

    async def delete(self, preset_id: UUID) -> bool:
        """Delete a preset."""
        result = await self._pool.execute(
            "DELETE FROM volundr_presets WHERE id = $1",
            preset_id,
        )
        return result == "DELETE 1"

    async def clear_default(self, cli_tool: str) -> None:
        """Clear the is_default flag for all presets with the given cli_tool."""
        await self._pool.execute(
            """
            UPDATE volundr_presets
            SET is_default = FALSE
            WHERE cli_tool = $1 AND is_default = TRUE
            """,
            cli_tool,
        )

    @staticmethod
    def _row_to_preset(row: asyncpg.Record) -> Preset:
        """Convert a database row to a Preset domain model."""
        return Preset(
            id=row["id"],
            name=row["name"],
            description=row["description"],
            is_default=row["is_default"],
            cli_tool=row["cli_tool"],
            workload_type=row["workload_type"],
            model=row["model"],
            system_prompt=row["system_prompt"],
            resource_config=json.loads(row["resource_config"])
            if isinstance(row["resource_config"], str)
            else row["resource_config"],
            mcp_servers=json.loads(row["mcp_servers"])
            if isinstance(row["mcp_servers"], str)
            else row["mcp_servers"],
            terminal_sidecar=json.loads(row["terminal_sidecar"])
            if isinstance(row["terminal_sidecar"], str)
            else row["terminal_sidecar"],
            skills=json.loads(row["skills"]) if isinstance(row["skills"], str) else row["skills"],
            rules=json.loads(row["rules"]) if isinstance(row["rules"], str) else row["rules"],
            env_vars=json.loads(row["env_vars"])
            if isinstance(row["env_vars"], str)
            else row["env_vars"],
            env_secret_refs=json.loads(row["env_secret_refs"])
            if isinstance(row["env_secret_refs"], str)
            else row["env_secret_refs"],
            source=json.loads(row["source"])
            if isinstance(row.get("source"), str)
            else row.get("source"),
            integration_ids=json.loads(row["integration_ids"])
            if isinstance(row.get("integration_ids"), str)
            else (row.get("integration_ids") or []),
            setup_scripts=json.loads(row["setup_scripts"])
            if isinstance(row.get("setup_scripts"), str)
            else (row.get("setup_scripts") or []),
            workload_config=json.loads(row["workload_config"])
            if isinstance(row["workload_config"], str)
            else row["workload_config"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
