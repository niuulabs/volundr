"""Unit tests for the todo_write and todo_read tools."""

from __future__ import annotations

from ravn.adapters.tools.todo import TodoReadTool, TodoWriteTool
from ravn.domain.models import Session, TodoItem, TodoStatus

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_session(*items: TodoItem) -> Session:
    s = Session()
    for item in items:
        s.upsert_todo(item)
    return s


def todo(
    id: str,
    content: str,
    status: TodoStatus = TodoStatus.PENDING,
    priority: int = 0,
) -> TodoItem:
    return TodoItem(id=id, content=content, status=status, priority=priority)


# ---------------------------------------------------------------------------
# Session model tests
# ---------------------------------------------------------------------------


class TestSessionTodoMethods:
    def test_upsert_new_item(self) -> None:
        s = Session()
        item = todo("a", "do something")
        s.upsert_todo(item)
        assert len(s.todos) == 1
        assert s.todos[0].id == "a"

    def test_upsert_replaces_existing(self) -> None:
        s = make_session(todo("a", "old content"))
        updated = todo("a", "new content", TodoStatus.DONE)
        s.upsert_todo(updated)
        assert len(s.todos) == 1
        assert s.todos[0].content == "new content"
        assert s.todos[0].status == TodoStatus.DONE

    def test_remove_existing_returns_true(self) -> None:
        s = make_session(todo("a", "item"))
        result = s.remove_todo("a")
        assert result is True
        assert s.todos == []

    def test_remove_missing_returns_false(self) -> None:
        s = Session()
        result = s.remove_todo("nonexistent")
        assert result is False

    def test_clear_todos(self) -> None:
        s = make_session(todo("a", "x"), todo("b", "y"))
        s.clear_todos()
        assert s.todos == []

    def test_upsert_multiple_items(self) -> None:
        s = Session()
        s.upsert_todo(todo("a", "first"))
        s.upsert_todo(todo("b", "second"))
        assert len(s.todos) == 2


# ---------------------------------------------------------------------------
# TodoWriteTool — create
# ---------------------------------------------------------------------------


class TestTodoWriteCreate:
    async def test_create_basic(self) -> None:
        s = Session()
        tool = TodoWriteTool(s)
        result = await tool.execute({"operation": "create", "content": "buy milk"})
        assert not result.is_error
        assert len(s.todos) == 1
        assert s.todos[0].content == "buy milk"
        assert s.todos[0].status == TodoStatus.PENDING

    async def test_create_with_explicit_id(self) -> None:
        s = Session()
        tool = TodoWriteTool(s)
        result = await tool.execute(
            {"operation": "create", "id": "task-1", "content": "write tests"}
        )
        assert not result.is_error
        assert s.todos[0].id == "task-1"

    async def test_create_with_status(self) -> None:
        s = Session()
        tool = TodoWriteTool(s)
        await tool.execute({"operation": "create", "content": "already done", "status": "done"})
        assert s.todos[0].status == TodoStatus.DONE

    async def test_create_with_priority(self) -> None:
        s = Session()
        tool = TodoWriteTool(s)
        await tool.execute({"operation": "create", "content": "urgent", "priority": 5})
        assert s.todos[0].priority == 5

    async def test_create_autogenerates_id(self) -> None:
        s = Session()
        tool = TodoWriteTool(s)
        await tool.execute({"operation": "create", "content": "item one"})
        await tool.execute({"operation": "create", "content": "item two"})
        assert len(s.todos) == 2
        assert s.todos[0].id != s.todos[1].id

    async def test_create_missing_content_returns_error(self) -> None:
        s = Session()
        tool = TodoWriteTool(s)
        result = await tool.execute({"operation": "create"})
        assert result.is_error
        assert "content" in result.content

    async def test_create_empty_content_returns_error(self) -> None:
        s = Session()
        tool = TodoWriteTool(s)
        result = await tool.execute({"operation": "create", "content": "   "})
        assert result.is_error

    async def test_create_invalid_status_returns_error(self) -> None:
        s = Session()
        tool = TodoWriteTool(s)
        result = await tool.execute({"operation": "create", "content": "x", "status": "flying"})
        assert result.is_error
        assert "flying" in result.content

    async def test_create_result_includes_todo_list(self) -> None:
        s = Session()
        tool = TodoWriteTool(s)
        result = await tool.execute({"operation": "create", "content": "do work"})
        assert "do work" in result.content


# ---------------------------------------------------------------------------
# TodoWriteTool — update
# ---------------------------------------------------------------------------


class TestTodoWriteUpdate:
    async def test_update_status(self) -> None:
        s = make_session(todo("t1", "some task"))
        tool = TodoWriteTool(s)
        result = await tool.execute({"operation": "update", "id": "t1", "status": "in_progress"})
        assert not result.is_error
        assert s.todos[0].status == TodoStatus.IN_PROGRESS

    async def test_update_content(self) -> None:
        s = make_session(todo("t1", "old"))
        tool = TodoWriteTool(s)
        await tool.execute({"operation": "update", "id": "t1", "content": "new content"})
        assert s.todos[0].content == "new content"

    async def test_update_priority(self) -> None:
        s = make_session(todo("t1", "task", priority=0))
        tool = TodoWriteTool(s)
        await tool.execute({"operation": "update", "id": "t1", "priority": 10})
        assert s.todos[0].priority == 10

    async def test_update_preserves_unchanged_fields(self) -> None:
        s = make_session(todo("t1", "original", TodoStatus.IN_PROGRESS, priority=3))
        tool = TodoWriteTool(s)
        await tool.execute({"operation": "update", "id": "t1", "status": "done"})
        updated = s.todos[0]
        assert updated.content == "original"
        assert updated.priority == 3
        assert updated.status == TodoStatus.DONE

    async def test_update_missing_id_returns_error(self) -> None:
        s = Session()
        tool = TodoWriteTool(s)
        result = await tool.execute({"operation": "update", "status": "done"})
        assert result.is_error
        assert "'id' is required" in result.content

    async def test_update_unknown_id_returns_error(self) -> None:
        s = Session()
        tool = TodoWriteTool(s)
        result = await tool.execute({"operation": "update", "id": "ghost"})
        assert result.is_error
        assert "not found" in result.content

    async def test_update_invalid_status_returns_error(self) -> None:
        s = make_session(todo("t1", "task"))
        tool = TodoWriteTool(s)
        result = await tool.execute({"operation": "update", "id": "t1", "status": "bad"})
        assert result.is_error

    async def test_update_result_includes_todo_list(self) -> None:
        s = make_session(todo("t1", "my task"))
        tool = TodoWriteTool(s)
        result = await tool.execute({"operation": "update", "id": "t1", "status": "done"})
        assert "my task" in result.content


# ---------------------------------------------------------------------------
# TodoWriteTool — delete
# ---------------------------------------------------------------------------


class TestTodoWriteDelete:
    async def test_delete_existing(self) -> None:
        s = make_session(todo("t1", "to remove"))
        tool = TodoWriteTool(s)
        result = await tool.execute({"operation": "delete", "id": "t1"})
        assert not result.is_error
        assert s.todos == []

    async def test_delete_missing_id_returns_error(self) -> None:
        s = Session()
        tool = TodoWriteTool(s)
        result = await tool.execute({"operation": "delete"})
        assert result.is_error
        assert "'id' is required" in result.content

    async def test_delete_unknown_id_returns_error(self) -> None:
        s = Session()
        tool = TodoWriteTool(s)
        result = await tool.execute({"operation": "delete", "id": "ghost"})
        assert result.is_error
        assert "not found" in result.content

    async def test_delete_result_shows_remaining_todos(self) -> None:
        s = make_session(todo("t1", "first"), todo("t2", "second"))
        tool = TodoWriteTool(s)
        result = await tool.execute({"operation": "delete", "id": "t1"})
        assert not result.is_error
        assert "second" in result.content
        assert "first" not in result.content

    async def test_delete_last_item_shows_empty(self) -> None:
        s = make_session(todo("t1", "only item"))
        tool = TodoWriteTool(s)
        result = await tool.execute({"operation": "delete", "id": "t1"})
        assert "(no todos)" in result.content


# ---------------------------------------------------------------------------
# TodoWriteTool — unknown operation
# ---------------------------------------------------------------------------


class TestTodoWriteUnknownOperation:
    async def test_unknown_operation_returns_error(self) -> None:
        s = Session()
        tool = TodoWriteTool(s)
        result = await tool.execute({"operation": "explode"})
        assert result.is_error
        assert "explode" in result.content


# ---------------------------------------------------------------------------
# TodoReadTool
# ---------------------------------------------------------------------------


class TestTodoReadTool:
    async def test_read_empty_session(self) -> None:
        s = Session()
        tool = TodoReadTool(s)
        result = await tool.execute({})
        assert not result.is_error
        assert "(no todos)" in result.content

    async def test_read_shows_all_items(self) -> None:
        s = make_session(
            todo("t1", "first task"),
            todo("t2", "second task", TodoStatus.DONE),
        )
        tool = TodoReadTool(s)
        result = await tool.execute({})
        assert "first task" in result.content
        assert "second task" in result.content

    async def test_read_filter_by_status(self) -> None:
        s = make_session(
            todo("t1", "pending item"),
            todo("t2", "done item", TodoStatus.DONE),
        )
        tool = TodoReadTool(s)
        result = await tool.execute({"status": "pending"})
        assert "pending item" in result.content
        assert "done item" not in result.content

    async def test_read_filter_no_matches(self) -> None:
        s = make_session(todo("t1", "pending item"))
        tool = TodoReadTool(s)
        result = await tool.execute({"status": "done"})
        assert "(no todos)" in result.content

    async def test_read_invalid_status_filter_returns_error(self) -> None:
        s = Session()
        tool = TodoReadTool(s)
        result = await tool.execute({"status": "invalid"})
        assert result.is_error
        assert "invalid" in result.content

    async def test_read_items_sorted_by_priority(self) -> None:
        s = make_session(
            todo("t1", "low priority", priority=1),
            todo("t2", "high priority", priority=10),
        )
        tool = TodoReadTool(s)
        result = await tool.execute({})
        high_pos = result.content.index("high priority")
        low_pos = result.content.index("low priority")
        assert high_pos < low_pos

    async def test_read_shows_status_symbols(self) -> None:
        s = make_session(todo("t1", "task", TodoStatus.DONE))
        tool = TodoReadTool(s)
        result = await tool.execute({})
        assert "✓" in result.content

    async def test_read_all_statuses_filter(self) -> None:
        for status in TodoStatus:
            s = make_session(todo("t1", "item", status))
            tool = TodoReadTool(s)
            result = await tool.execute({"status": status.value})
            assert not result.is_error
            assert "item" in result.content


# ---------------------------------------------------------------------------
# Tool metadata
# ---------------------------------------------------------------------------


class TestToolMetadata:
    def test_write_tool_name(self) -> None:
        assert TodoWriteTool(Session()).name == "todo_write"

    def test_read_tool_name(self) -> None:
        assert TodoReadTool(Session()).name == "todo_read"

    def test_write_tool_permission(self) -> None:
        assert TodoWriteTool(Session()).required_permission == "todo:write"

    def test_read_tool_permission(self) -> None:
        assert TodoReadTool(Session()).required_permission == "todo:read"

    def test_write_tool_has_input_schema(self) -> None:
        schema = TodoWriteTool(Session()).input_schema
        assert schema["type"] == "object"
        assert "operation" in schema["properties"]

    def test_read_tool_has_input_schema(self) -> None:
        schema = TodoReadTool(Session()).input_schema
        assert schema["type"] == "object"

    def test_write_tool_to_api_dict(self) -> None:
        d = TodoWriteTool(Session()).to_api_dict()
        assert d["name"] == "todo_write"
        assert "description" in d
        assert "input_schema" in d

    def test_read_tool_to_api_dict(self) -> None:
        d = TodoReadTool(Session()).to_api_dict()
        assert d["name"] == "todo_read"
