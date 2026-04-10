"""Tests for SjonEnrichmentAdapter (NIU-555)."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from niuu.domain.mimir import MimirPage, MimirPageMeta
from ravn.adapters.thread.enrichment import SjonEnrichmentAdapter, _parse_json
from ravn.domain.models import LLMResponse, StopReason, TokenUsage
from ravn.domain.thread import RavnThread, ThreadStatus
from ravn.ports.thread import ThreadPort

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_page(
    path: str = "papers/attention.md",
    title: str = "Attention Is All You Need",
    summary: str = "Transformer architecture paper",
    content: str = "Introduces the transformer model...",
) -> MimirPage:
    return MimirPage(
        meta=MimirPageMeta(
            path=path,
            title=title,
            summary=summary,
            category="papers",
            updated_at=datetime.now(UTC),
        ),
        content=content,
    )


def _make_llm_response(payload: dict) -> LLMResponse:
    return LLMResponse(
        content=json.dumps(payload),
        stop_reason=StopReason.END_TURN,
        usage=TokenUsage(input_tokens=50, output_tokens=30),
        tool_calls=[],
    )


class FakeThreadStore(ThreadPort):
    def __init__(self) -> None:
        self.upserted: list[RavnThread] = []

    async def upsert(self, thread: RavnThread) -> None:
        self.upserted.append(thread)

    async def get(self, thread_id: str) -> RavnThread | None:
        return None

    async def get_by_path(self, page_path: str) -> RavnThread | None:
        return None

    async def peek_queue(self, *, limit: int = 10) -> list[RavnThread]:
        return []

    async def list_open(self, *, limit: int = 100) -> list[RavnThread]:
        return []

    async def close(self, thread_id: str) -> None:
        pass

    async def update_weight(self, thread_id: str, weight: float) -> None:
        pass


def _make_llm(response_payload: dict) -> MagicMock:
    llm = MagicMock()
    llm.generate = AsyncMock(return_value=_make_llm_response(response_payload))
    return llm


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestSjonEnrichmentAdapter:
    @pytest.mark.asyncio
    async def test_classifies_thread(self) -> None:
        store = FakeThreadStore()
        llm = _make_llm(
            {
                "is_thread": True,
                "importance": 0.8,
                "next_action": "read and summarise",
                "tags": ["paper", "ml"],
            }
        )
        adapter = SjonEnrichmentAdapter(llm, store)
        page = _make_page()

        result = await adapter.enrich(page)

        assert result is not None
        assert isinstance(result, RavnThread)
        assert result.page_path == "papers/attention.md"
        assert result.status == ThreadStatus.OPEN
        assert result.next_action == "read and summarise"
        assert "paper" in result.tags
        assert len(store.upserted) == 1

    @pytest.mark.asyncio
    async def test_classifies_fact_returns_none(self) -> None:
        store = FakeThreadStore()
        llm = _make_llm({"is_thread": False})
        adapter = SjonEnrichmentAdapter(llm, store)
        page = _make_page()

        result = await adapter.enrich(page)

        assert result is None
        assert len(store.upserted) == 0

    @pytest.mark.asyncio
    async def test_weight_computed(self) -> None:
        store = FakeThreadStore()
        llm = _make_llm({"is_thread": True, "importance": 1.0, "next_action": "act", "tags": []})
        adapter = SjonEnrichmentAdapter(llm, store, initial_weight=0.5)
        page = _make_page()

        result = await adapter.enrich(page)

        assert result is not None
        # Weight should be in range (0, 0.5] for a brand-new page (recency ≈ 1)
        assert 0.0 < result.weight <= 0.5 + 0.01

    @pytest.mark.asyncio
    async def test_importance_clamped(self) -> None:
        store = FakeThreadStore()
        llm = _make_llm(
            {
                "is_thread": True,
                "importance": 999.0,  # out of range
                "next_action": "act",
                "tags": [],
            }
        )
        adapter = SjonEnrichmentAdapter(llm, store, initial_weight=0.5)
        page = _make_page()

        result = await adapter.enrich(page)

        assert result is not None
        assert result.weight <= 0.5 + 0.01  # importance clamped to 1.0

    @pytest.mark.asyncio
    async def test_llm_failure_defaults_to_fact(self) -> None:
        store = FakeThreadStore()
        llm = MagicMock()
        llm.generate = AsyncMock(side_effect=RuntimeError("LLM exploded"))
        adapter = SjonEnrichmentAdapter(llm, store)
        page = _make_page()

        result = await adapter.enrich(page)

        assert result is None
        assert len(store.upserted) == 0

    @pytest.mark.asyncio
    async def test_llm_garbage_json_defaults_to_fact(self) -> None:
        store = FakeThreadStore()
        llm = MagicMock()
        llm.generate = AsyncMock(
            return_value=LLMResponse(
                content="this is not json at all",
                stop_reason=StopReason.END_TURN,
                usage=TokenUsage(input_tokens=10, output_tokens=10),
                tool_calls=[],
            )
        )
        adapter = SjonEnrichmentAdapter(llm, store)
        page = _make_page()

        result = await adapter.enrich(page)

        assert result is None

    @pytest.mark.asyncio
    async def test_llm_json_in_markdown_fence(self) -> None:
        store = FakeThreadStore()
        llm = MagicMock()
        fenced = (
            "```json\n"
            '{"is_thread": true, "importance": 0.7, "next_action": "act", "tags": ["ml"]}'
            "\n```"
        )
        llm.generate = AsyncMock(
            return_value=LLMResponse(
                content=fenced,
                stop_reason=StopReason.END_TURN,
                usage=TokenUsage(input_tokens=10, output_tokens=20),
                tool_calls=[],
            )
        )
        adapter = SjonEnrichmentAdapter(llm, store)
        page = _make_page()

        result = await adapter.enrich(page)

        assert result is not None
        assert result.tags == ["ml"]

    @pytest.mark.asyncio
    async def test_missing_next_action_defaults_empty(self) -> None:
        store = FakeThreadStore()
        llm = _make_llm({"is_thread": True, "importance": 0.5, "tags": []})
        adapter = SjonEnrichmentAdapter(llm, store)
        page = _make_page()

        result = await adapter.enrich(page)

        assert result is not None
        assert result.next_action == ""


class TestParseJson:
    def test_valid_json(self) -> None:
        result = _parse_json('{"is_thread": true, "importance": 0.5}')
        assert result["is_thread"] is True
        assert result["importance"] == 0.5

    def test_fenced_json(self) -> None:
        result = _parse_json('```json\n{"is_thread": false}\n```')
        assert result["is_thread"] is False

    def test_garbage_returns_default(self) -> None:
        result = _parse_json("not json")
        assert result == {"is_thread": False}

    def test_json_embedded_in_text(self) -> None:
        result = _parse_json('Some preamble {"is_thread": true} and more text')
        assert result["is_thread"] is True

    def test_empty_string_returns_default(self) -> None:
        result = _parse_json("")
        assert result == {"is_thread": False}
