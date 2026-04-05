"""Unit tests for ToolRegistry."""

from __future__ import annotations

import pytest

from ravn.domain.models import ToolResult
from ravn.ports.tool import ToolPort
from ravn.registry import ToolRegistrationError, ToolRegistry

# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------


class SimpleTool(ToolPort):
    """A minimal tool that echoes back a value."""

    def __init__(self, tool_name: str = "simple") -> None:
        self._tool_name = tool_name

    @property
    def name(self) -> str:
        return self._tool_name

    @property
    def description(self) -> str:
        return "A simple tool."

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {"x": {"type": "string"}},
        }

    @property
    def required_permission(self) -> str:
        return "tool:simple"

    async def execute(self, input: dict) -> ToolResult:
        return ToolResult(tool_call_id="", content=f"ok:{input.get('x', '')}")


class ErrorTool(ToolPort):
    """A tool that always raises an exception."""

    @property
    def name(self) -> str:
        return "error_tool"

    @property
    def description(self) -> str:
        return "Always raises."

    @property
    def input_schema(self) -> dict:
        return {"type": "object", "properties": {}}

    @property
    def required_permission(self) -> str:
        return "tool:error"

    async def execute(self, input: dict) -> ToolResult:
        raise RuntimeError("boom")


# ---------------------------------------------------------------------------
# Registration tests
# ---------------------------------------------------------------------------


def test_register_single_tool():
    reg = ToolRegistry()
    reg.register(SimpleTool())
    assert len(reg) == 1


def test_register_multiple_tools_increments_count():
    reg = ToolRegistry()
    reg.register(SimpleTool("a"))
    reg.register(SimpleTool("b"))
    assert len(reg) == 2


def test_list_returns_tools_in_order():
    reg = ToolRegistry()
    t1 = SimpleTool("first")
    t2 = SimpleTool("second")
    reg.register(t1)
    reg.register(t2)
    assert reg.list() == [t1, t2]


def test_list_returns_copy():
    reg = ToolRegistry()
    reg.register(SimpleTool())
    lst = reg.list()
    lst.clear()
    assert len(reg) == 1


def test_get_returns_registered_tool():
    reg = ToolRegistry()
    t = SimpleTool()
    reg.register(t)
    assert reg.get("simple") is t


def test_get_returns_none_for_unknown():
    reg = ToolRegistry()
    assert reg.get("nonexistent") is None


def test_collision_raises_registration_error():
    reg = ToolRegistry()
    reg.register(SimpleTool())
    with pytest.raises(ToolRegistrationError, match="already registered"):
        reg.register(SimpleTool())


# ---------------------------------------------------------------------------
# Schema validation tests
# ---------------------------------------------------------------------------


def test_invalid_schema_type_raises():
    class BadTypeTool(SimpleTool):
        @property
        def input_schema(self) -> dict:
            return {"type": "notavalidtype"}

    with pytest.raises(ToolRegistrationError, match="invalid type"):
        ToolRegistry().register(BadTypeTool())


def test_schema_not_dict_raises():
    class NotDictTool(SimpleTool):
        @property
        def input_schema(self) -> dict:
            return "not a dict"  # type: ignore[return-value]

    with pytest.raises(ToolRegistrationError, match="must be a dict"):
        ToolRegistry().register(NotDictTool())


def test_properties_not_dict_raises():
    class BadPropertiesTool(SimpleTool):
        @property
        def input_schema(self) -> dict:
            return {"type": "object", "properties": "wrong"}

    with pytest.raises(ToolRegistrationError, match="'properties' must be a dict"):
        ToolRegistry().register(BadPropertiesTool())


def test_schema_without_type_is_valid():
    class NoTypeTool(SimpleTool):
        @property
        def input_schema(self) -> dict:
            return {"properties": {"x": {"type": "string"}}}

    reg = ToolRegistry()
    reg.register(NoTypeTool())
    assert len(reg) == 1


def test_all_valid_schema_types_accepted():
    valid_types = ["object", "array", "string", "integer", "number", "boolean", "null"]
    for schema_type in valid_types:

        class TypedTool(SimpleTool):
            _t = schema_type

            @property
            def name(self) -> str:
                return f"tool_{self._t}"

            @property
            def input_schema(self) -> dict:
                return {"type": self._t}

        reg = ToolRegistry()
        reg.register(TypedTool())  # should not raise


# ---------------------------------------------------------------------------
# Dispatch tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_success_returns_result():
    reg = ToolRegistry()
    reg.register(SimpleTool())
    result = await reg.dispatch("simple", {"x": "hello"}, call_id="abc")
    assert not result.is_error
    assert result.content == "ok:hello"


@pytest.mark.asyncio
async def test_dispatch_sets_call_id():
    reg = ToolRegistry()
    reg.register(SimpleTool())
    result = await reg.dispatch("simple", {}, call_id="my-call-id")
    assert result.tool_call_id == "my-call-id"


@pytest.mark.asyncio
async def test_dispatch_unknown_tool_returns_error():
    reg = ToolRegistry()
    result = await reg.dispatch("missing", {}, call_id="x")
    assert result.is_error
    assert "Unknown tool" in result.content
    assert result.tool_call_id == "x"


@pytest.mark.asyncio
async def test_dispatch_exception_returns_error_not_raises():
    reg = ToolRegistry()
    reg.register(ErrorTool())
    result = await reg.dispatch("error_tool", {}, call_id="y")
    assert result.is_error
    assert "boom" in result.content
    assert result.tool_call_id == "y"


@pytest.mark.asyncio
async def test_dispatch_error_preserves_call_id():
    reg = ToolRegistry()
    reg.register(ErrorTool())
    result = await reg.dispatch("error_tool", {}, call_id="err-id-42")
    assert result.tool_call_id == "err-id-42"
