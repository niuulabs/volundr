"""Búri knowledge memory tools (NIU-541).

Five tools for querying, writing, and managing the typed fact graph:
- buri_recall    — semantic fact retrieval (with optional type filter)
- buri_facts     — all current facts about a named entity
- buri_history   — temporal fact history including superseded facts
- buri_remember  — explicitly write a fact (type auto-classified if omitted)
- buri_forget    — invalidate a fact by natural language description
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from ravn.domain.models import FactType, KnowledgeFact, ToolResult
from ravn.ports.memory import BuriMemoryPort
from ravn.ports.tool import ToolPort

_VALID_TYPES = [t.value for t in FactType]


def _format_fact(fact: KnowledgeFact) -> str:
    ts = fact.valid_from.strftime("%Y-%m-%d")
    superseded = " [superseded]" if fact.valid_until is not None else ""
    entities = ", ".join(fact.entities) if fact.entities else "—"
    return (
        f"[{fact.fact_type.upper()}] {fact.content}{superseded}\n"
        f"  confidence={fact.confidence:.2f} | from={ts} | entities={entities}"
    )


class BuriRecallTool(ToolPort):
    """Query the Búri knowledge base for facts relevant to a query."""

    def __init__(self, memory: BuriMemoryPort) -> None:
        self._memory = memory

    @property
    def name(self) -> str:
        return "buri_recall"

    @property
    def description(self) -> str:
        return (
            "Search the Búri knowledge base for facts relevant to a query. "
            "Returns current typed facts ordered by type-weighted relevance. "
            "Use this when you need to recall preferences, decisions, goals, or directives "
            "before starting a task."
        )

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Natural language query to search facts.",
                },
                "fact_type": {
                    "type": "string",
                    "enum": _VALID_TYPES,
                    "description": "Optional: filter by fact type.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum facts to return (default 10, max 20).",
                    "minimum": 1,
                    "maximum": 20,
                },
            },
            "required": ["query"],
        }

    @property
    def required_permission(self) -> str:
        return "memory:read"

    async def execute(self, input: dict) -> ToolResult:
        query = input.get("query", "").strip()
        if not query:
            return ToolResult(
                tool_call_id="", content="Error: query must not be empty.", is_error=True
            )

        fact_type_str = input.get("fact_type")
        fact_type: FactType | None = None
        if fact_type_str:
            try:
                fact_type = FactType(fact_type_str)
            except ValueError:
                return ToolResult(
                    tool_call_id="",
                    content=f"Error: unknown fact_type {fact_type_str!r}. Valid: {_VALID_TYPES}",
                    is_error=True,
                )

        limit = min(int(input.get("limit", 10)), 20)
        facts = await self._memory.query_facts(query, fact_type=fact_type, limit=limit)

        if not facts:
            return ToolResult(tool_call_id="", content=f"No facts found matching: {query!r}")

        lines = [f"Found {len(facts)} fact(s) matching {query!r}:\n"]
        lines.extend(_format_fact(f) for f in facts)
        return ToolResult(tool_call_id="", content="\n\n".join(lines))


class BuriFactsTool(ToolPort):
    """Return all current facts about a named entity."""

    def __init__(self, memory: BuriMemoryPort) -> None:
        self._memory = memory

    @property
    def name(self) -> str:
        return "buri_facts"

    @property
    def description(self) -> str:
        return (
            "Return all current facts in the Búri knowledge base about a named entity. "
            "Use this to get a complete picture of what is known about a person, system, "
            "tool, or concept."
        )

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "entity": {
                    "type": "string",
                    "description": "The named entity to look up (e.g. 'RabbitMQ', 'Sleipnir').",
                },
                "fact_type": {
                    "type": "string",
                    "enum": _VALID_TYPES,
                    "description": "Optional: filter by fact type.",
                },
            },
            "required": ["entity"],
        }

    @property
    def required_permission(self) -> str:
        return "memory:read"

    async def execute(self, input: dict) -> ToolResult:
        entity = input.get("entity", "").strip()
        if not entity:
            return ToolResult(
                tool_call_id="", content="Error: entity must not be empty.", is_error=True
            )

        fact_type_str = input.get("fact_type")
        fact_type: FactType | None = None
        if fact_type_str:
            try:
                fact_type = FactType(fact_type_str)
            except ValueError:
                return ToolResult(
                    tool_call_id="",
                    content=f"Error: unknown fact_type {fact_type_str!r}.",
                    is_error=True,
                )

        facts = await self._memory.get_facts_for_entity(entity, fact_type=fact_type)

        if not facts:
            return ToolResult(tool_call_id="", content=f"No facts found for entity: {entity!r}")

        lines = [f"Facts about {entity!r} ({len(facts)} current):\n"]
        lines.extend(_format_fact(f) for f in facts)
        return ToolResult(tool_call_id="", content="\n\n".join(lines))


class BuriHistoryTool(ToolPort):
    """Return the temporal fact history for a named entity, including superseded facts."""

    def __init__(self, memory: BuriMemoryPort) -> None:
        self._memory = memory

    @property
    def name(self) -> str:
        return "buri_history"

    @property
    def description(self) -> str:
        return (
            "Return the full temporal history of facts about a named entity, "
            "including facts that have been superseded (updated or overridden). "
            "Useful for understanding how decisions or preferences evolved over time."
        )

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "entity": {
                    "type": "string",
                    "description": "The named entity to look up.",
                },
                "fact_type": {
                    "type": "string",
                    "enum": _VALID_TYPES,
                    "description": "Optional: filter by fact type.",
                },
            },
            "required": ["entity"],
        }

    @property
    def required_permission(self) -> str:
        return "memory:read"

    async def execute(self, input: dict) -> ToolResult:
        entity = input.get("entity", "").strip()
        if not entity:
            return ToolResult(
                tool_call_id="", content="Error: entity must not be empty.", is_error=True
            )

        fact_type_str = input.get("fact_type")
        fact_type: FactType | None = None
        if fact_type_str:
            try:
                fact_type = FactType(fact_type_str)
            except ValueError:
                return ToolResult(
                    tool_call_id="",
                    content=f"Error: unknown fact_type {fact_type_str!r}.",
                    is_error=True,
                )

        facts = await self._memory.get_facts_for_entity(
            entity, fact_type=fact_type, include_superseded=True
        )

        if not facts:
            return ToolResult(tool_call_id="", content=f"No history found for entity: {entity!r}")

        # Sort by valid_from descending
        facts_sorted = sorted(facts, key=lambda f: f.valid_from, reverse=True)
        count = len(facts_sorted)
        lines = [f"Fact history for {entity!r} ({count} total, including superseded):\n"]
        lines.extend(_format_fact(f) for f in facts_sorted)
        return ToolResult(tool_call_id="", content="\n\n".join(lines))


class BuriRememberTool(ToolPort):
    """Explicitly write a fact to the Búri knowledge base."""

    def __init__(self, memory: BuriMemoryPort, *, session_id: str = "") -> None:
        self._memory = memory
        self._session_id = session_id

    @property
    def name(self) -> str:
        return "buri_remember"

    @property
    def description(self) -> str:
        return (
            "Explicitly store a fact in the Búri knowledge base. "
            "The fact type is inferred from the content if not specified. "
            "Use this to persist preferences, decisions, goals, directives, or observations "
            "that should be remembered across sessions."
        )

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "The fact to remember, as a clear statement.",
                },
                "fact_type": {
                    "type": "string",
                    "enum": _VALID_TYPES,
                    "description": "Optional: fact type. Auto-classified from content if omitted.",
                },
                "entities": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional: named entities this fact refers to.",
                },
            },
            "required": ["content"],
        }

    @property
    def required_permission(self) -> str:
        return "memory:write"

    async def execute(self, input: dict) -> ToolResult:
        content = input.get("content", "").strip()
        if not content:
            return ToolResult(
                tool_call_id="", content="Error: content must not be empty.", is_error=True
            )

        fact_type_str = input.get("fact_type")
        if fact_type_str:
            try:
                fact_type = FactType(fact_type_str)
            except ValueError:
                return ToolResult(
                    tool_call_id="",
                    content=f"Error: unknown fact_type {fact_type_str!r}.",
                    is_error=True,
                )
        else:
            # Auto-classify from content using simple heuristics
            from ravn.adapters.memory.buri import _detect_inline_fact_type
            detected = _detect_inline_fact_type(content)
            fact_type = detected if detected is not None else FactType.OBSERVATION

        entities_raw = input.get("entities", [])
        if not entities_raw:
            from ravn.adapters.memory.buri import _extract_entities_from_content
            entities_raw = _extract_entities_from_content(content)

        fact = KnowledgeFact(
            fact_id=str(uuid.uuid4()),
            fact_type=fact_type,
            content=content,
            entities=list(entities_raw),
            confidence=1.0,
            source=f"session:{self._session_id}" if self._session_id else "manual",
            valid_from=datetime.now(UTC),
            source_context="explicit buri_remember call",
        )

        try:
            await self._memory.ingest_fact(fact)
        except Exception as exc:
            return ToolResult(
                tool_call_id="",
                content=f"Error storing fact: {exc}",
                is_error=True,
            )

        return ToolResult(
            tool_call_id="",
            content=f"Stored [{fact_type.upper()}]: {content}",
        )


class BuriForgetTool(ToolPort):
    """Invalidate a fact in the Búri knowledge base by natural language description."""

    def __init__(self, memory: BuriMemoryPort) -> None:
        self._memory = memory

    @property
    def name(self) -> str:
        return "buri_forget"

    @property
    def description(self) -> str:
        return (
            "Invalidate a fact in the Búri knowledge base. "
            "Provide a natural language description of the fact to forget — "
            "the best matching current fact is found by semantic search and invalidated. "
            "The fact history is preserved; only the current validity is ended."
        )

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Natural language description of the fact to forget.",
                },
            },
            "required": ["query"],
        }

    @property
    def required_permission(self) -> str:
        return "memory:write"

    async def execute(self, input: dict) -> ToolResult:
        query = input.get("query", "").strip()
        if not query:
            return ToolResult(
                tool_call_id="", content="Error: query must not be empty.", is_error=True
            )

        forgotten = await self._memory.forget_fact(query)
        if forgotten is None:
            return ToolResult(
                tool_call_id="",
                content=f"No current fact found matching: {query!r}",
            )

        return ToolResult(
            tool_call_id="",
            content=f"Invalidated [{forgotten.fact_type.upper()}]: {forgotten.content}",
        )
