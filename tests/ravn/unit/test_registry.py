"""Unit tests for ToolRegistry."""

from __future__ import annotations

import pytest

from ravn.domain.models import ToolResult
from ravn.ports.tool import ToolPort
from ravn.registry import ToolRegistrationError, ToolRegistry, _validate_schema

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _SimpleTool(ToolPort):
    def __init__(self, name: str = "simple", result: str = "ok") -> None:
        self._name = name
        self._result = result

    @property
    def name(self) -> str:
        return self._name

    @property
    def description(self) -> str:
        return "A simple test tool."

    @property
    def input_schema(self) -> dict:
        return {"type": "object", "properties": {"x": {"type": "string"}}}

    @property
    def required_permission(self) -> str:
        return "test:run"

    async def execute(self, input: dict) -> ToolResult:
        return ToolResult(tool_call_id="", content=self._result)


class _RaisingTool(ToolPort):
    @property
    def name(self) -> str:
        return "raiser"

    @property
    def description(self) -> str:
        return "Always raises."

    @property
    def input_schema(self) -> dict:
        return {"type": "object"}

    @property
    def required_permission(self) -> str:
        return "test:run"

    async def execute(self, input: dict) -> ToolResult:
        raise RuntimeError("intentional failure")


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


class TestRegistration:
    def test_register_and_get(self) -> None:
        reg = ToolRegistry()
        tool = _SimpleTool()
        reg.register(tool)
        assert reg.get("simple") is tool

    def test_register_returns_none(self) -> None:
        reg = ToolRegistry()
        result = reg.register(_SimpleTool())
        assert result is None

    def test_collision_raises(self) -> None:
        reg = ToolRegistry()
        reg.register(_SimpleTool())
        with pytest.raises(ToolRegistrationError, match="already registered"):
            reg.register(_SimpleTool())

    def test_len_tracks_count(self) -> None:
        reg = ToolRegistry()
        assert len(reg) == 0
        reg.register(_SimpleTool("a"))
        reg.register(_SimpleTool("b"))
        assert len(reg) == 2

    def test_list_returns_all(self) -> None:
        reg = ToolRegistry()
        t1 = _SimpleTool("t1")
        t2 = _SimpleTool("t2")
        reg.register(t1)
        reg.register(t2)
        listed = reg.list()
        assert t1 in listed
        assert t2 in listed

    def test_get_unknown_returns_none(self) -> None:
        reg = ToolRegistry()
        assert reg.get("nope") is None


# ---------------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------------


class TestSchemaValidation:
    def test_invalid_schema_not_dict_raises(self) -> None:
        with pytest.raises(ToolRegistrationError, match="must be a dict"):
            _validate_schema("bad", "not a dict")  # type: ignore[arg-type]

    def test_invalid_schema_type_raises(self) -> None:
        with pytest.raises(ToolRegistrationError, match="invalid type"):
            _validate_schema("bad", {"type": "bogus"})

    def test_invalid_properties_not_dict_raises(self) -> None:
        with pytest.raises(ToolRegistrationError, match="must be a dict"):
            _validate_schema("bad", {"type": "object", "properties": "wrong"})

    def test_valid_schema_no_type(self) -> None:
        _validate_schema("ok", {})  # no-op, should not raise

    def test_valid_schema_all_known_types(self) -> None:
        for t in ("object", "array", "string", "integer", "number", "boolean", "null"):
            _validate_schema("ok", {"type": t})

    def test_registration_rejects_bad_schema(self) -> None:
        class _BadSchemaTool(ToolPort):
            @property
            def name(self) -> str:
                return "bad"

            @property
            def description(self) -> str:
                return ""

            @property
            def input_schema(self) -> dict:
                return {"type": "nonsense"}

            @property
            def required_permission(self) -> str:
                return "x"

            async def execute(self, input: dict) -> ToolResult:
                return ToolResult(tool_call_id="", content="")

        reg = ToolRegistry()
        with pytest.raises(ToolRegistrationError):
            reg.register(_BadSchemaTool())


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------


class TestDispatch:
    @pytest.mark.asyncio
    async def test_dispatch_known_tool(self) -> None:
        reg = ToolRegistry()
        reg.register(_SimpleTool(result="hello"))
        result = await reg.dispatch("simple", {}, "call-1")
        assert result.content == "hello"
        assert not result.is_error
        assert result.tool_call_id == "call-1"

    @pytest.mark.asyncio
    async def test_dispatch_unknown_tool_returns_error(self) -> None:
        reg = ToolRegistry()
        result = await reg.dispatch("missing", {}, "call-2")
        assert result.is_error
        assert "Unknown tool" in result.content
        assert result.tool_call_id == "call-2"

    @pytest.mark.asyncio
    async def test_dispatch_exception_returns_error(self) -> None:
        reg = ToolRegistry()
        reg.register(_RaisingTool())
        result = await reg.dispatch("raiser", {}, "call-3")
        assert result.is_error
        assert "Tool error" in result.content
        assert "intentional failure" in result.content

    @pytest.mark.asyncio
    async def test_dispatch_passes_input(self) -> None:
        class _EchoTool(ToolPort):
            @property
            def name(self) -> str:
                return "echo"

            @property
            def description(self) -> str:
                return ""

            @property
            def input_schema(self) -> dict:
                return {"type": "object"}

            @property
            def required_permission(self) -> str:
                return "x"

            async def execute(self, input: dict) -> ToolResult:
                return ToolResult(tool_call_id="", content=input.get("msg", ""))

        reg = ToolRegistry()
        reg.register(_EchoTool())
        result = await reg.dispatch("echo", {"msg": "world"}, "c")
        assert result.content == "world"
