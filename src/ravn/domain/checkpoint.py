"""Checkpoint domain model for Ravn task interruption and resume."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any


class InterruptReason(StrEnum):
    """Why the task was interrupted."""

    SIGINT = "sigint"
    SIGTERM = "sigterm"
    BUDGET_EXHAUSTED = "budget_exhausted"
    TYR_CANCEL = "tyr_cancel"


@dataclass
class Checkpoint:
    """Serialised task state persisted at every tool call boundary.

    Written after every tool call so that resume is safe across crashes —
    not just on explicit interruption.  Fields are kept intentionally flat
    (primitive types and plain dicts) so serialisation is trivial.

    Attributes:
        task_id:                Unique ID for this task / checkpoint.
        user_input:             The original prompt that started the task.
        messages:               Full conversation history, Anthropic API format.
        todos:                  Agent todo list (list of serialised TodoItem dicts).
        iteration_budget_consumed: Iterations consumed when checkpoint was written.
        iteration_budget_total:    Configured iteration budget ceiling.
        last_tool_call:         Serialised ToolCall dict from the last iteration,
                                or None if interrupted before any tool was called.
        last_tool_result:       Serialised ToolResult dict from the last iteration,
                                or None.
        partial_response:       LLM text accumulated so far (may be empty).
        interrupted_by:         The signal or condition that stopped the task, or
                                None when the checkpoint was written mid-run
                                (crash-safe checkpoint, not an explicit stop).
        created_at:             UTC timestamp when this checkpoint was written.
    """

    task_id: str
    user_input: str
    messages: list[dict[str, Any]]
    todos: list[dict[str, Any]]
    iteration_budget_consumed: int
    iteration_budget_total: int
    last_tool_call: dict[str, Any] | None
    last_tool_result: dict[str, Any] | None
    partial_response: str
    interrupted_by: InterruptReason | None
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
