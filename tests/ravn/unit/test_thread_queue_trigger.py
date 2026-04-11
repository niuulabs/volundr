"""Unit tests for ThreadQueueTrigger (NIU-563).

Covers:
- name property
- Disabled trigger never calls enqueue (thread.enabled=False)
- Empty queue → no enqueue
- Thread in queue → ownership claimed, state → pulling, enqueue called
- ThreadOwnershipError → caught, logged, no exception raised, no enqueue
- Priority mapping produces valid DriveLoop priority values (1–10)
- Title derived from next_action_hint (meta.summary) when present
- Title derived from path stem when meta.summary is empty
- triggered_by is f"thread:{path}"
- output_mode is AMBIENT
- run() re-raises CancelledError
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from niuu.domain.mimir import ThreadOwnershipError, ThreadState
from niuu.ports.mimir import MimirPage, MimirPageMeta
from ravn.adapters.triggers.thread_queue import (
    ThreadQueueTrigger,
    _select_persona,
    _title_from_path,
)
from ravn.config import ThreadConfig
from ravn.domain.models import AgentTask, OutputMode

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _thread_config(
    enabled: bool = True,
    poll_interval: int = 10,
    owner_id: str = "test-agent",
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
        config=_thread_config(enabled=enabled, owner_id=owner_id),
    )


def _thread_page(
    path: str = "threads/retrieval-architecture",
    title: str = "Retrieval Architecture",
    summary: str = "Compare HNSW vs flat",
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


# ---------------------------------------------------------------------------
# name
# ---------------------------------------------------------------------------


def test_name() -> None:
    assert _make_trigger().name == "thread_queue"


# ---------------------------------------------------------------------------
# disabled trigger
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_disabled_trigger_never_enqueues() -> None:
    """thread.enabled=False → _poll_once returns immediately, never enqueues."""
    mimir = AsyncMock()
    mimir.get_thread_queue = AsyncMock(return_value=[_thread_page()])
    trigger = _make_trigger(mimir=mimir, enabled=False)
    enqueued: list[AgentTask] = []

    async def _enqueue(task: AgentTask) -> None:
        enqueued.append(task)

    await trigger._poll_once(_enqueue)

    assert enqueued == []
    mimir.get_thread_queue.assert_not_called()


# ---------------------------------------------------------------------------
# empty queue
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_empty_queue_no_enqueue() -> None:
    mimir = AsyncMock()
    mimir.get_thread_queue = AsyncMock(return_value=[])
    trigger = _make_trigger(mimir=mimir)
    enqueued: list[AgentTask] = []

    await trigger._poll_once(lambda t: enqueued.append(t) or asyncio.sleep(0))  # type: ignore[arg-type]
    assert enqueued == []
    mimir.assign_thread_owner.assert_not_called()


# ---------------------------------------------------------------------------
# happy path: thread in queue → ownership + state + enqueue
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_thread_in_queue_claims_ownership() -> None:
    mimir = AsyncMock()
    page = _thread_page(path="threads/my-topic", weight=5.0)
    mimir.get_thread_queue = AsyncMock(return_value=[page])
    mimir.assign_thread_owner = AsyncMock()
    mimir.update_thread_state = AsyncMock()
    trigger = _make_trigger(mimir=mimir, owner_id="agent-1")
    enqueued: list[AgentTask] = []

    async def _enqueue(task: AgentTask) -> None:
        enqueued.append(task)

    await trigger._poll_once(_enqueue)

    mimir.assign_thread_owner.assert_called_once_with("threads/my-topic", "agent-1")


@pytest.mark.asyncio
async def test_thread_in_queue_transitions_to_pulling() -> None:
    mimir = AsyncMock()
    page = _thread_page()
    mimir.get_thread_queue = AsyncMock(return_value=[page])
    mimir.assign_thread_owner = AsyncMock()
    mimir.update_thread_state = AsyncMock()
    trigger = _make_trigger(mimir=mimir)
    enqueued: list[AgentTask] = []

    async def _enqueue(task: AgentTask) -> None:
        enqueued.append(task)

    await trigger._poll_once(_enqueue)

    mimir.update_thread_state.assert_called_once_with(
        "threads/retrieval-architecture", ThreadState.pulling
    )


@pytest.mark.asyncio
async def test_thread_in_queue_calls_enqueue() -> None:
    mimir = AsyncMock()
    page = _thread_page()
    mimir.get_thread_queue = AsyncMock(return_value=[page])
    mimir.assign_thread_owner = AsyncMock()
    mimir.update_thread_state = AsyncMock()
    trigger = _make_trigger(mimir=mimir)
    enqueued: list[AgentTask] = []

    async def _enqueue(task: AgentTask) -> None:
        enqueued.append(task)

    await trigger._poll_once(_enqueue)

    assert len(enqueued) == 1


@pytest.mark.asyncio
async def test_enqueued_task_triggered_by_thread_path() -> None:
    mimir = AsyncMock()
    page = _thread_page(path="threads/retrieval-architecture")
    mimir.get_thread_queue = AsyncMock(return_value=[page])
    mimir.assign_thread_owner = AsyncMock()
    mimir.update_thread_state = AsyncMock()
    trigger = _make_trigger(mimir=mimir)
    enqueued: list[AgentTask] = []

    async def _enqueue(task: AgentTask) -> None:
        enqueued.append(task)

    await trigger._poll_once(_enqueue)

    assert enqueued[0].triggered_by == "thread:threads/retrieval-architecture"


@pytest.mark.asyncio
async def test_enqueued_task_output_mode_ambient() -> None:
    mimir = AsyncMock()
    page = _thread_page()
    mimir.get_thread_queue = AsyncMock(return_value=[page])
    mimir.assign_thread_owner = AsyncMock()
    mimir.update_thread_state = AsyncMock()
    trigger = _make_trigger(mimir=mimir)
    enqueued: list[AgentTask] = []

    async def _enqueue(task: AgentTask) -> None:
        enqueued.append(task)

    await trigger._poll_once(_enqueue)

    assert enqueued[0].output_mode == OutputMode.AMBIENT


@pytest.mark.asyncio
async def test_enqueued_task_title_uses_next_action_hint() -> None:
    mimir = AsyncMock()
    page = _thread_page(summary="Compare HNSW vs flat")
    mimir.get_thread_queue = AsyncMock(return_value=[page])
    mimir.assign_thread_owner = AsyncMock()
    mimir.update_thread_state = AsyncMock()
    trigger = _make_trigger(mimir=mimir)
    enqueued: list[AgentTask] = []

    async def _enqueue(task: AgentTask) -> None:
        enqueued.append(task)

    await trigger._poll_once(_enqueue)

    assert enqueued[0].title == "Compare HNSW vs flat"


@pytest.mark.asyncio
async def test_enqueued_task_title_derived_from_path_when_no_summary() -> None:
    mimir = AsyncMock()
    page = _thread_page(path="threads/retrieval-architecture", summary="")
    mimir.get_thread_queue = AsyncMock(return_value=[page])
    mimir.assign_thread_owner = AsyncMock()
    mimir.update_thread_state = AsyncMock()
    trigger = _make_trigger(mimir=mimir)
    enqueued: list[AgentTask] = []

    async def _enqueue(task: AgentTask) -> None:
        enqueued.append(task)

    await trigger._poll_once(_enqueue)

    assert enqueued[0].title == "Retrieval Architecture"


@pytest.mark.asyncio
async def test_enqueued_task_initiative_context_contains_path_and_weight() -> None:
    mimir = AsyncMock()
    page = _thread_page(path="threads/my-topic", weight=7.5)
    mimir.get_thread_queue = AsyncMock(return_value=[page])
    mimir.assign_thread_owner = AsyncMock()
    mimir.update_thread_state = AsyncMock()
    trigger = _make_trigger(mimir=mimir)
    enqueued: list[AgentTask] = []

    async def _enqueue(task: AgentTask) -> None:
        enqueued.append(task)

    await trigger._poll_once(_enqueue)

    ctx = enqueued[0].initiative_context
    assert "threads/my-topic" in ctx
    assert "7.50" in ctx


# ---------------------------------------------------------------------------
# Priority mapping
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_priority_is_within_valid_range() -> None:
    """Priority must always be between 1 and 10 inclusive."""
    for weight in (0.0, 0.5, 1.0, 5.0, 9.5, 10.0, 15.0, 0.01):
        mimir = AsyncMock()
        page = _thread_page(weight=weight)
        mimir.get_thread_queue = AsyncMock(return_value=[page])
        mimir.assign_thread_owner = AsyncMock()
        mimir.update_thread_state = AsyncMock()
        trigger = _make_trigger(mimir=mimir)
        enqueued: list[AgentTask] = []

        async def _enqueue(task: AgentTask) -> None:
            enqueued.append(task)

        await trigger._poll_once(_enqueue)
        assert 1 <= enqueued[0].priority <= 10, (
            f"weight={weight} → priority={enqueued[0].priority} out of range"
        )


@pytest.mark.asyncio
async def test_high_weight_yields_lower_priority_number() -> None:
    """Higher thread weight → lower priority number (more urgent)."""
    mimir_lo = AsyncMock()
    mimir_lo.get_thread_queue = AsyncMock(return_value=[_thread_page(weight=2.0)])
    mimir_lo.assign_thread_owner = AsyncMock()
    mimir_lo.update_thread_state = AsyncMock()

    mimir_hi = AsyncMock()
    mimir_hi.get_thread_queue = AsyncMock(return_value=[_thread_page(weight=8.0)])
    mimir_hi.assign_thread_owner = AsyncMock()
    mimir_hi.update_thread_state = AsyncMock()

    enqueued_lo: list[AgentTask] = []
    enqueued_hi: list[AgentTask] = []

    async def _enqueue_lo(t: AgentTask) -> None:
        enqueued_lo.append(t)

    async def _enqueue_hi(t: AgentTask) -> None:
        enqueued_hi.append(t)

    await _make_trigger(mimir=mimir_lo)._poll_once(_enqueue_lo)
    await _make_trigger(mimir=mimir_hi)._poll_once(_enqueue_hi)

    assert enqueued_hi[0].priority < enqueued_lo[0].priority


# ---------------------------------------------------------------------------
# ThreadOwnershipError handling
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ownership_error_no_enqueue() -> None:
    mimir = AsyncMock()
    mimir.get_thread_queue = AsyncMock(return_value=[_thread_page()])
    mimir.assign_thread_owner = AsyncMock(
        side_effect=ThreadOwnershipError("threads/retrieval-architecture", "other-agent")
    )
    mimir.update_thread_state = AsyncMock()
    trigger = _make_trigger(mimir=mimir)
    enqueued: list[AgentTask] = []

    async def _enqueue(task: AgentTask) -> None:
        enqueued.append(task)

    await trigger._poll_once(_enqueue)

    assert enqueued == []


@pytest.mark.asyncio
async def test_ownership_error_no_state_transition() -> None:
    mimir = AsyncMock()
    mimir.get_thread_queue = AsyncMock(return_value=[_thread_page()])
    mimir.assign_thread_owner = AsyncMock(
        side_effect=ThreadOwnershipError("threads/retrieval-architecture", "other-agent")
    )
    mimir.update_thread_state = AsyncMock()
    trigger = _make_trigger(mimir=mimir)

    await trigger._poll_once(AsyncMock())

    mimir.update_thread_state.assert_not_called()


@pytest.mark.asyncio
async def test_ownership_error_does_not_raise() -> None:
    mimir = AsyncMock()
    mimir.get_thread_queue = AsyncMock(return_value=[_thread_page()])
    mimir.assign_thread_owner = AsyncMock(
        side_effect=ThreadOwnershipError("threads/retrieval-architecture", "other-agent")
    )
    trigger = _make_trigger(mimir=mimir)

    # Must not raise
    await trigger._poll_once(AsyncMock())


# ---------------------------------------------------------------------------
# run() cancellation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_exits_on_cancellation() -> None:
    mimir = AsyncMock()
    mimir.get_thread_queue = AsyncMock(side_effect=asyncio.CancelledError())
    trigger = _make_trigger(mimir=mimir, enabled=True)
    with pytest.raises(asyncio.CancelledError):
        await trigger.run(AsyncMock())


# ---------------------------------------------------------------------------
# get_thread_queue called with owner_id
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_thread_queue_called_with_owner_id_and_limit_1() -> None:
    mimir = AsyncMock()
    mimir.get_thread_queue = AsyncMock(return_value=[])
    trigger = _make_trigger(mimir=mimir, owner_id="specific-agent")

    await trigger._poll_once(AsyncMock())

    mimir.get_thread_queue.assert_called_once_with(owner_id="specific-agent", limit=1)


# ---------------------------------------------------------------------------
# _title_from_path helper
# ---------------------------------------------------------------------------


def test_title_from_path_basic() -> None:
    assert _title_from_path("threads/retrieval-architecture") == "Retrieval Architecture"


def test_title_from_path_single_word() -> None:
    assert _title_from_path("threads/auth") == "Auth"


def test_title_from_path_no_slash() -> None:
    assert _title_from_path("plain-slug") == "Plain Slug"


# ---------------------------------------------------------------------------
# owner_id defaults
# ---------------------------------------------------------------------------


def test_owner_id_generated_when_not_configured() -> None:
    mimir = AsyncMock()
    config = ThreadConfig(enabled=True, owner_id=None)
    trigger = ThreadQueueTrigger(mimir=mimir, config=config)
    assert trigger._owner_id.startswith("ravn-")
    assert len(trigger._owner_id) > 5


def test_owner_id_uses_config_when_set() -> None:
    mimir = AsyncMock()
    config = ThreadConfig(enabled=True, owner_id="my-ravn")
    trigger = ThreadQueueTrigger(mimir=mimir, config=config)
    assert trigger._owner_id == "my-ravn"


# ---------------------------------------------------------------------------
# _select_persona helper
# ---------------------------------------------------------------------------


def test_select_persona_empty_hint_returns_research_and_distill() -> None:
    assert _select_persona("") == "research-and-distill"


def test_select_persona_generic_hint_returns_research_and_distill() -> None:
    assert _select_persona("Compare HNSW vs flat index") == "research-and-distill"


@pytest.mark.parametrize(
    "hint",
    [
        "draft a summary",
        "write a note about this",
        "capture the key points",
        "observe and record findings",
        "Draft the outline",
        "quick NOTE for later",
    ],
)
def test_select_persona_draft_keywords_return_draft_a_note(hint: str) -> None:
    assert _select_persona(hint) == "draft-a-note"


# ---------------------------------------------------------------------------
# persona field set on enqueued task
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_enqueued_task_has_persona_set() -> None:
    mimir = AsyncMock()
    page = _thread_page(summary="Compare HNSW vs flat")
    mimir.get_thread_queue = AsyncMock(return_value=[page])
    mimir.assign_thread_owner = AsyncMock()
    mimir.update_thread_state = AsyncMock()
    trigger = _make_trigger(mimir=mimir)
    enqueued: list[AgentTask] = []

    async def _enqueue(task: AgentTask) -> None:
        enqueued.append(task)

    await trigger._poll_once(_enqueue)

    assert enqueued[0].persona == "research-and-distill"


@pytest.mark.asyncio
async def test_enqueued_task_persona_draft_a_note_for_draft_hint() -> None:
    mimir = AsyncMock()
    page = _thread_page(summary="draft outline for the new auth flow")
    mimir.get_thread_queue = AsyncMock(return_value=[page])
    mimir.assign_thread_owner = AsyncMock()
    mimir.update_thread_state = AsyncMock()
    trigger = _make_trigger(mimir=mimir)
    enqueued: list[AgentTask] = []

    async def _enqueue(task: AgentTask) -> None:
        enqueued.append(task)

    await trigger._poll_once(_enqueue)

    assert enqueued[0].persona == "draft-a-note"


# ---------------------------------------------------------------------------
# initiative_context includes title
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_initiative_context_contains_title() -> None:
    mimir = AsyncMock()
    page = _thread_page(path="threads/retrieval-architecture", title="Retrieval Architecture")
    mimir.get_thread_queue = AsyncMock(return_value=[page])
    mimir.assign_thread_owner = AsyncMock()
    mimir.update_thread_state = AsyncMock()
    trigger = _make_trigger(mimir=mimir)
    enqueued: list[AgentTask] = []

    async def _enqueue(task: AgentTask) -> None:
        enqueued.append(task)

    await trigger._poll_once(_enqueue)

    assert "Retrieval Architecture" in enqueued[0].initiative_context


@pytest.mark.asyncio
async def test_initiative_context_contains_produced_by_thread_instruction() -> None:
    mimir = AsyncMock()
    page = _thread_page()
    mimir.get_thread_queue = AsyncMock(return_value=[page])
    mimir.assign_thread_owner = AsyncMock()
    mimir.update_thread_state = AsyncMock()
    trigger = _make_trigger(mimir=mimir)
    enqueued: list[AgentTask] = []

    async def _enqueue(task: AgentTask) -> None:
        enqueued.append(task)

    await trigger._poll_once(_enqueue)

    assert "produced_by_thread" in enqueued[0].initiative_context
