"""Unit tests for CheckpointSaveTool, CheckpointListTool, CheckpointRestoreTool."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from ravn.adapters.tools.checkpoint_tools import (
    CheckpointListTool,
    CheckpointRestoreTool,
    CheckpointSaveTool,
)
from ravn.domain.checkpoint import Checkpoint
from ravn.domain.models import Session, TodoItem, TodoStatus


def _make_checkpoint(
    task_id: str = "task-1",
    seq: int = 1,
    label: str = "",
    tags: list[str] | None = None,
) -> Checkpoint:
    return Checkpoint(
        task_id=task_id,
        user_input="",
        messages=[{"role": "user", "content": "hello"}],
        todos=[],
        iteration_budget_consumed=2,
        iteration_budget_total=10,
        last_tool_call=None,
        last_tool_result=None,
        partial_response="",
        interrupted_by=None,
        created_at=datetime(2024, 1, 1, 12, 0, 0, tzinfo=UTC),
        label=label,
        tags=tags or [],
        seq=seq,
    )


def _make_session() -> Session:
    return Session(created_at=datetime.now(UTC))


# ---------------------------------------------------------------------------
# CheckpointSaveTool
# ---------------------------------------------------------------------------


class TestCheckpointSaveTool:
    def _make_tool(
        self,
        port: object | None = None,
        session: Session | None = None,
        task_id: str = "task-1",
        consumed: int = 2,
        total: int = 10,
    ) -> CheckpointSaveTool:
        if port is None:
            port = AsyncMock()
            port.save_snapshot = AsyncMock(return_value="ckpt_task-1_1")
        if session is None:
            session = _make_session()
        return CheckpointSaveTool(port, session, task_id, consumed, total)

    def test_name(self) -> None:
        assert self._make_tool().name == "checkpoint_save"

    def test_description_is_string(self) -> None:
        assert isinstance(self._make_tool().description, str)

    def test_input_schema_is_dict(self) -> None:
        schema = self._make_tool().input_schema
        assert schema["type"] == "object"
        assert "label" in schema["properties"]
        assert "tags" in schema["properties"]

    def test_required_permission(self) -> None:
        assert self._make_tool().required_permission == "checkpoint:write"

    @pytest.mark.asyncio
    async def test_execute_returns_checkpoint_id(self) -> None:
        port = AsyncMock()
        port.save_snapshot = AsyncMock(return_value="ckpt_task-1_1")
        tool = self._make_tool(port=port)
        result = await tool.execute({"label": "after tests", "tags": ["ci"]})
        assert not result.is_error
        assert "ckpt_task-1_1" in result.content
        assert "after tests" in result.content

    @pytest.mark.asyncio
    async def test_execute_no_label(self) -> None:
        port = AsyncMock()
        port.save_snapshot = AsyncMock(return_value="ckpt_task-1_1")
        tool = self._make_tool(port=port)
        result = await tool.execute({})
        assert not result.is_error
        assert "ckpt_task-1_1" in result.content

    @pytest.mark.asyncio
    async def test_execute_captures_session_messages(self) -> None:
        port = AsyncMock()
        port.save_snapshot = AsyncMock(return_value="ckpt_x")
        session = _make_session()
        from ravn.domain.models import Message
        session.messages.append(Message(role="user", content="hi"))
        tool = self._make_tool(port=port, session=session)
        await tool.execute({})
        saved: Checkpoint = port.save_snapshot.call_args[0][0]
        assert any(m["role"] == "user" for m in saved.messages)

    @pytest.mark.asyncio
    async def test_execute_port_exception_returns_error(self) -> None:
        port = AsyncMock()
        port.save_snapshot = AsyncMock(side_effect=RuntimeError("db down"))
        tool = self._make_tool(port=port)
        result = await tool.execute({})
        assert result.is_error
        assert "db down" in result.content


# ---------------------------------------------------------------------------
# CheckpointListTool
# ---------------------------------------------------------------------------


class TestCheckpointListTool:
    def _make_tool(
        self, port: object | None = None, task_id: str = "task-1"
    ) -> CheckpointListTool:
        if port is None:
            port = AsyncMock()
            port.list_for_task = AsyncMock(return_value=[])
        return CheckpointListTool(port, task_id)

    def test_name(self) -> None:
        assert self._make_tool().name == "checkpoint_list"

    def test_required_permission(self) -> None:
        assert self._make_tool().required_permission == "checkpoint:read"

    @pytest.mark.asyncio
    async def test_execute_no_checkpoints(self) -> None:
        port = AsyncMock()
        port.list_for_task = AsyncMock(return_value=[])
        result = await self._make_tool(port=port).execute({})
        assert not result.is_error
        assert "No checkpoints" in result.content

    @pytest.mark.asyncio
    async def test_execute_lists_checkpoints(self) -> None:
        cp = _make_checkpoint(label="milestone", tags=["ci"])
        port = AsyncMock()
        port.list_for_task = AsyncMock(return_value=[cp])
        result = await self._make_tool(port=port).execute({})
        assert not result.is_error
        assert "milestone" in result.content
        assert "ci" in result.content

    @pytest.mark.asyncio
    async def test_execute_port_exception_returns_error(self) -> None:
        port = AsyncMock()
        port.list_for_task = AsyncMock(side_effect=RuntimeError("db down"))
        result = await self._make_tool(port=port).execute({})
        assert result.is_error
        assert "db down" in result.content


# ---------------------------------------------------------------------------
# CheckpointRestoreTool
# ---------------------------------------------------------------------------


class TestCheckpointRestoreTool:
    def _make_tool(
        self, port: object | None = None, session: Session | None = None
    ) -> CheckpointRestoreTool:
        if port is None:
            port = AsyncMock()
        if session is None:
            session = _make_session()
        return CheckpointRestoreTool(port, session)

    def test_name(self) -> None:
        assert self._make_tool().name == "checkpoint_restore"

    def test_required_permission(self) -> None:
        assert self._make_tool().required_permission == "checkpoint:write"

    def test_input_schema_requires_checkpoint_id(self) -> None:
        schema = self._make_tool().input_schema
        assert "checkpoint_id" in schema["required"]

    @pytest.mark.asyncio
    async def test_execute_missing_id_returns_error(self) -> None:
        result = await self._make_tool().execute({})
        assert result.is_error
        assert "checkpoint_id" in result.content

    @pytest.mark.asyncio
    async def test_execute_not_found_returns_error(self) -> None:
        port = AsyncMock()
        port.load_snapshot = AsyncMock(return_value=None)
        result = await self._make_tool(port=port).execute({"checkpoint_id": "ckpt_x"})
        assert result.is_error
        assert "not found" in result.content

    @pytest.mark.asyncio
    async def test_execute_restores_session(self) -> None:
        cp = _make_checkpoint()
        port = AsyncMock()
        port.load_snapshot = AsyncMock(return_value=cp)
        session = _make_session()
        tool = self._make_tool(port=port, session=session)
        result = await tool.execute({"checkpoint_id": "ckpt_task-1_1"})
        assert not result.is_error
        assert "Restored" in result.content
        assert len(session.messages) == 1

    @pytest.mark.asyncio
    async def test_execute_port_exception_returns_error(self) -> None:
        port = AsyncMock()
        port.load_snapshot = AsyncMock(side_effect=RuntimeError("db down"))
        result = await self._make_tool(port=port).execute({"checkpoint_id": "ckpt_x"})
        assert result.is_error
        assert "db down" in result.content

    @pytest.mark.asyncio
    async def test_execute_restores_todos(self) -> None:
        cp = _make_checkpoint()
        cp.todos = [{"id": "t1", "content": "do x", "status": "pending", "priority": 5}]
        port = AsyncMock()
        port.load_snapshot = AsyncMock(return_value=cp)
        session = _make_session()
        await self._make_tool(port=port, session=session).execute({"checkpoint_id": "ckpt_x"})
        assert len(session.todos) == 1
        assert session.todos[0].id == "t1"
