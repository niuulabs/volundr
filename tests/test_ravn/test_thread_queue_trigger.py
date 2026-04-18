"""Unit tests for ThreadQueueTrigger (NIU-564).

Uses mocked MimirPort and enqueue callback — no real filesystem or network.

Covers:
- Empty queue → enqueue never called
- thread.enabled=False → enqueue never called
- Queue has item → ownership claimed, state → pulling, enqueue called with correct context
- ThreadOwnershipError → enqueue not called, no exception raised
- Priority derived correctly from thread weight
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from niuu.domain.mimir import MimirPage, MimirPageMeta, ThreadOwnershipError, ThreadState
from ravn.adapters.triggers.thread_queue import ThreadQueueTrigger, _select_persona
from ravn.config import ThreadConfig
from ravn.domain.models import AgentTask, OutputMode

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _config(
    enabled: bool = True,
    owner_id: str = "test-agent",
    poll_interval: int = 10,
) -> ThreadConfig:
    return ThreadConfig(
        enabled=enabled,
        enricher_poll_interval_seconds=poll_interval,
        owner_id=owner_id,
    )


def _make_trigger(
    mimir: object | None = None,
    enabled: bool = True,
    owner_id: str = "test-agent",
) -> ThreadQueueTrigger:
    if mimir is None:
        mimir = AsyncMock()
        mimir.get_thread_queue = AsyncMock(return_value=[])
    return ThreadQueueTrigger(
        mimir=mimir,  # type: ignore[arg-type]
        config=_config(enabled=enabled, owner_id=owner_id),
    )


def _thread_page(
    path: str = "threads/retrieval-architecture",
    title: str = "Retrieval Architecture",
    summary: str = "Compare HNSW vs flat index",
    weight: float = 5.0,
    state: ThreadState = ThreadState.open,
) -> MimirPage:
    return MimirPage(
        meta=MimirPageMeta(
            path=path,
            title=title,
            summary=summary,
            category="threads",
            updated_at=datetime(2024, 1, 1, tzinfo=UTC),
            is_thread=True,
            thread_state=state,
            thread_weight=weight,
        ),
        content="",
    )


async def _collect_enqueued(trigger: ThreadQueueTrigger) -> list[AgentTask]:
    enqueued: list[AgentTask] = []

    async def _enqueue(task: AgentTask) -> None:
        enqueued.append(task)

    await trigger._poll_once(_enqueue)
    return enqueued


# ---------------------------------------------------------------------------
# thread.enabled=False → no polling
# ---------------------------------------------------------------------------


class TestDisabledTrigger:
    @pytest.mark.asyncio
    async def test_disabled_never_queries_queue(self) -> None:
        mimir = AsyncMock()
        mimir.get_thread_queue = AsyncMock(return_value=[_thread_page()])
        trigger = _make_trigger(mimir=mimir, enabled=False)

        enqueued = await _collect_enqueued(trigger)

        assert enqueued == []
        mimir.get_thread_queue.assert_not_called()

    @pytest.mark.asyncio
    async def test_disabled_never_calls_assign_owner(self) -> None:
        mimir = AsyncMock()
        mimir.get_thread_queue = AsyncMock(return_value=[_thread_page()])
        mimir.assign_thread_owner = AsyncMock()
        trigger = _make_trigger(mimir=mimir, enabled=False)

        await _collect_enqueued(trigger)

        mimir.assign_thread_owner.assert_not_called()


# ---------------------------------------------------------------------------
# Empty queue → enqueue never called
# ---------------------------------------------------------------------------


class TestEmptyQueue:
    @pytest.mark.asyncio
    async def test_empty_queue_no_enqueue(self) -> None:
        mimir = AsyncMock()
        mimir.get_thread_queue = AsyncMock(return_value=[])
        trigger = _make_trigger(mimir=mimir)

        enqueued = await _collect_enqueued(trigger)

        assert enqueued == []

    @pytest.mark.asyncio
    async def test_empty_queue_no_ownership_claim(self) -> None:
        mimir = AsyncMock()
        mimir.get_thread_queue = AsyncMock(return_value=[])
        mimir.assign_thread_owner = AsyncMock()
        trigger = _make_trigger(mimir=mimir)

        await _collect_enqueued(trigger)

        mimir.assign_thread_owner.assert_not_called()


# ---------------------------------------------------------------------------
# Queue has item → full happy path
# ---------------------------------------------------------------------------


class TestQueueWithItem:
    @pytest.mark.asyncio
    async def test_ownership_claimed_for_thread(self) -> None:
        mimir = AsyncMock()
        page = _thread_page(path="threads/my-topic")
        mimir.get_thread_queue = AsyncMock(return_value=[page])
        mimir.assign_thread_owner = AsyncMock()
        mimir.update_thread_state = AsyncMock()
        trigger = _make_trigger(mimir=mimir, owner_id="agent-1")

        await _collect_enqueued(trigger)

        mimir.assign_thread_owner.assert_called_once_with("threads/my-topic", "agent-1")

    @pytest.mark.asyncio
    async def test_state_transitions_to_pulling(self) -> None:
        mimir = AsyncMock()
        page = _thread_page()
        mimir.get_thread_queue = AsyncMock(return_value=[page])
        mimir.assign_thread_owner = AsyncMock()
        mimir.update_thread_state = AsyncMock()
        trigger = _make_trigger(mimir=mimir)

        await _collect_enqueued(trigger)

        mimir.update_thread_state.assert_called_once_with(
            "threads/retrieval-architecture", ThreadState.pulling
        )

    @pytest.mark.asyncio
    async def test_enqueue_called_once(self) -> None:
        mimir = AsyncMock()
        page = _thread_page()
        mimir.get_thread_queue = AsyncMock(return_value=[page])
        mimir.assign_thread_owner = AsyncMock()
        mimir.update_thread_state = AsyncMock()
        trigger = _make_trigger(mimir=mimir)

        enqueued = await _collect_enqueued(trigger)

        assert len(enqueued) == 1

    @pytest.mark.asyncio
    async def test_enqueued_task_output_mode_ambient(self) -> None:
        mimir = AsyncMock()
        page = _thread_page()
        mimir.get_thread_queue = AsyncMock(return_value=[page])
        mimir.assign_thread_owner = AsyncMock()
        mimir.update_thread_state = AsyncMock()
        trigger = _make_trigger(mimir=mimir)

        enqueued = await _collect_enqueued(trigger)

        assert enqueued[0].output_mode == OutputMode.AMBIENT

    @pytest.mark.asyncio
    async def test_enqueued_task_triggered_by_contains_path(self) -> None:
        mimir = AsyncMock()
        page = _thread_page(path="threads/retrieval-architecture")
        mimir.get_thread_queue = AsyncMock(return_value=[page])
        mimir.assign_thread_owner = AsyncMock()
        mimir.update_thread_state = AsyncMock()
        trigger = _make_trigger(mimir=mimir)

        enqueued = await _collect_enqueued(trigger)

        assert enqueued[0].triggered_by == "thread:threads/retrieval-architecture"

    @pytest.mark.asyncio
    async def test_enqueued_task_title_from_summary(self) -> None:
        mimir = AsyncMock()
        page = _thread_page(summary="Compare HNSW vs flat")
        mimir.get_thread_queue = AsyncMock(return_value=[page])
        mimir.assign_thread_owner = AsyncMock()
        mimir.update_thread_state = AsyncMock()
        trigger = _make_trigger(mimir=mimir)

        enqueued = await _collect_enqueued(trigger)

        assert enqueued[0].title == "Compare HNSW vs flat"

    @pytest.mark.asyncio
    async def test_enqueued_task_title_derived_from_path_when_no_summary(self) -> None:
        mimir = AsyncMock()
        page = _thread_page(path="threads/retrieval-architecture", summary="")
        mimir.get_thread_queue = AsyncMock(return_value=[page])
        mimir.assign_thread_owner = AsyncMock()
        mimir.update_thread_state = AsyncMock()
        trigger = _make_trigger(mimir=mimir)

        enqueued = await _collect_enqueued(trigger)

        assert enqueued[0].title == "Retrieval Architecture"

    @pytest.mark.asyncio
    async def test_initiative_context_contains_path_and_weight(self) -> None:
        mimir = AsyncMock()
        page = _thread_page(path="threads/my-topic", weight=7.5)
        mimir.get_thread_queue = AsyncMock(return_value=[page])
        mimir.assign_thread_owner = AsyncMock()
        mimir.update_thread_state = AsyncMock()
        trigger = _make_trigger(mimir=mimir)

        enqueued = await _collect_enqueued(trigger)

        ctx = enqueued[0].initiative_context
        assert "threads/my-topic" in ctx
        assert "7.50" in ctx

    @pytest.mark.asyncio
    async def test_get_thread_queue_called_with_owner_id_and_limit_1(self) -> None:
        mimir = AsyncMock()
        mimir.get_thread_queue = AsyncMock(return_value=[])
        trigger = _make_trigger(mimir=mimir, owner_id="specific-agent")

        await _collect_enqueued(trigger)

        mimir.get_thread_queue.assert_called_once_with(owner_id="specific-agent", limit=1)


# ---------------------------------------------------------------------------
# ThreadOwnershipError → no enqueue, no exception
# ---------------------------------------------------------------------------


class TestOwnershipError:
    @pytest.mark.asyncio
    async def test_ownership_error_no_enqueue(self) -> None:
        mimir = AsyncMock()
        mimir.get_thread_queue = AsyncMock(return_value=[_thread_page()])
        mimir.assign_thread_owner = AsyncMock(
            side_effect=ThreadOwnershipError("threads/retrieval-architecture", "other-agent")
        )
        mimir.update_thread_state = AsyncMock()
        trigger = _make_trigger(mimir=mimir)

        enqueued = await _collect_enqueued(trigger)

        assert enqueued == []

    @pytest.mark.asyncio
    async def test_ownership_error_no_state_transition(self) -> None:
        mimir = AsyncMock()
        mimir.get_thread_queue = AsyncMock(return_value=[_thread_page()])
        mimir.assign_thread_owner = AsyncMock(
            side_effect=ThreadOwnershipError("threads/retrieval-architecture", "other-agent")
        )
        mimir.update_thread_state = AsyncMock()
        trigger = _make_trigger(mimir=mimir)

        await _collect_enqueued(trigger)

        mimir.update_thread_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_ownership_error_does_not_raise(self) -> None:
        mimir = AsyncMock()
        mimir.get_thread_queue = AsyncMock(return_value=[_thread_page()])
        mimir.assign_thread_owner = AsyncMock(
            side_effect=ThreadOwnershipError("threads/retrieval-architecture", "other-agent")
        )
        trigger = _make_trigger(mimir=mimir)

        # Must not raise
        await _collect_enqueued(trigger)


# ---------------------------------------------------------------------------
# Priority derived correctly from thread weight
# ---------------------------------------------------------------------------


class TestPriorityMapping:
    @pytest.mark.asyncio
    async def test_priority_within_valid_range(self) -> None:
        for weight in (0.0, 0.5, 1.0, 5.0, 9.5, 10.0, 15.0):
            mimir = AsyncMock()
            mimir.get_thread_queue = AsyncMock(return_value=[_thread_page(weight=weight)])
            mimir.assign_thread_owner = AsyncMock()
            mimir.update_thread_state = AsyncMock()
            trigger = _make_trigger(mimir=mimir)

            enqueued = await _collect_enqueued(trigger)

            p = enqueued[0].priority
            assert 1 <= p <= 10, f"weight={weight} → priority={p} out of range"

    @pytest.mark.asyncio
    async def test_high_weight_gives_lower_priority_number(self) -> None:
        """Higher thread weight → lower priority number (more urgent in DriveLoop)."""
        mimir_lo = AsyncMock()
        mimir_lo.get_thread_queue = AsyncMock(return_value=[_thread_page(weight=2.0)])
        mimir_lo.assign_thread_owner = AsyncMock()
        mimir_lo.update_thread_state = AsyncMock()

        mimir_hi = AsyncMock()
        mimir_hi.get_thread_queue = AsyncMock(return_value=[_thread_page(weight=8.0)])
        mimir_hi.assign_thread_owner = AsyncMock()
        mimir_hi.update_thread_state = AsyncMock()

        enqueued_lo = await _collect_enqueued(_make_trigger(mimir=mimir_lo))
        enqueued_hi = await _collect_enqueued(_make_trigger(mimir=mimir_hi))

        assert enqueued_hi[0].priority < enqueued_lo[0].priority


# ---------------------------------------------------------------------------
# _select_persona — keyword routing
# ---------------------------------------------------------------------------


class TestSelectPersona:
    def test_draft_keyword_routes_to_draft_a_note(self) -> None:
        assert _select_persona("draft a summary of the meeting") == "draft-a-note"

    def test_note_keyword_routes_to_draft_a_note(self) -> None:
        assert _select_persona("write a note about the architecture decision") == "draft-a-note"

    def test_capture_keyword_routes_to_draft_a_note(self) -> None:
        assert _select_persona("capture this observation before it is lost") == "draft-a-note"

    def test_observe_keyword_routes_to_draft_a_note(self) -> None:
        assert _select_persona("observe patterns in recent retrieval latency") == "draft-a-note"

    def test_case_insensitive_matching(self) -> None:
        assert _select_persona("Draft a quick NOTE") == "draft-a-note"

    def test_unrecognised_hint_returns_default(self) -> None:
        assert _select_persona("process the backlog items") == "research-and-distill"

    def test_empty_hint_returns_default(self) -> None:
        assert _select_persona("") == "research-and-distill"


# ---------------------------------------------------------------------------
# ThreadQueueTrigger sets persona on enqueued tasks
# ---------------------------------------------------------------------------


class TestPersonaSelection:
    @pytest.mark.asyncio
    async def test_note_hint_sets_draft_a_note_persona(self) -> None:
        mimir = AsyncMock()
        page = _thread_page(summary="draft a note on the retrieval approach")
        mimir.get_thread_queue = AsyncMock(return_value=[page])
        mimir.assign_thread_owner = AsyncMock()
        mimir.update_thread_state = AsyncMock()
        trigger = _make_trigger(mimir=mimir)

        enqueued = await _collect_enqueued(trigger)

        assert enqueued[0].persona == "draft-a-note"

    @pytest.mark.asyncio
    async def test_unrecognised_hint_uses_default_persona(self) -> None:
        mimir = AsyncMock()
        page = _thread_page(summary="process the next batch of items")
        mimir.get_thread_queue = AsyncMock(return_value=[page])
        mimir.assign_thread_owner = AsyncMock()
        mimir.update_thread_state = AsyncMock()
        trigger = _make_trigger(mimir=mimir)

        enqueued = await _collect_enqueued(trigger)

        assert enqueued[0].persona == "research-and-distill"

    @pytest.mark.asyncio
    async def test_no_hint_uses_default_persona(self) -> None:
        mimir = AsyncMock()
        page = _thread_page(summary="")
        mimir.get_thread_queue = AsyncMock(return_value=[page])
        mimir.assign_thread_owner = AsyncMock()
        mimir.update_thread_state = AsyncMock()
        trigger = _make_trigger(mimir=mimir)

        enqueued = await _collect_enqueued(trigger)

        assert enqueued[0].persona == "research-and-distill"

    @pytest.mark.asyncio
    async def test_capture_hint_sets_draft_a_note_persona(self) -> None:
        mimir = AsyncMock()
        page = _thread_page(summary="capture observations from today's review")
        mimir.get_thread_queue = AsyncMock(return_value=[page])
        mimir.assign_thread_owner = AsyncMock()
        mimir.update_thread_state = AsyncMock()
        trigger = _make_trigger(mimir=mimir)

        enqueued = await _collect_enqueued(trigger)

        assert enqueued[0].persona == "draft-a-note"


# ---------------------------------------------------------------------------
# run() exits on CancelledError
# ---------------------------------------------------------------------------


class TestRunCancellation:
    @pytest.mark.asyncio
    async def test_run_exits_on_cancellation(self) -> None:
        mimir = AsyncMock()
        mimir.get_thread_queue = AsyncMock(side_effect=asyncio.CancelledError())
        trigger = _make_trigger(mimir=mimir, enabled=True)

        with pytest.raises(asyncio.CancelledError):
            await trigger.run(AsyncMock())
