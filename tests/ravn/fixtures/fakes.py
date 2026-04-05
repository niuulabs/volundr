"""Shared test fakes for the Ravn test suite.

Imported by both tests/ravn/conftest.py and tests/test_ravn/conftest.py
so there is a single authoritative definition of each fake.
"""

from __future__ import annotations

from ravn.domain.events import RavnEvent
from ravn.domain.models import ToolResult
from ravn.ports.channel import ChannelPort
from ravn.ports.tool import ToolPort


class InMemoryChannel(ChannelPort):
    """Records every event emitted by the agent for inspection in tests."""

    def __init__(self) -> None:
        self.events: list[RavnEvent] = []

    async def emit(self, event: RavnEvent) -> None:
        self.events.append(event)


class EchoTool(ToolPort):
    """Returns the ``message`` input as its result."""

    @property
    def name(self) -> str:
        return "echo"

    @property
    def description(self) -> str:
        return "Echoes the message back."

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {"message": {"type": "string"}},
            "required": ["message"],
        }

    @property
    def required_permission(self) -> str:
        return "tool:echo"

    async def execute(self, input: dict) -> ToolResult:
        return ToolResult(tool_call_id="", content=input.get("message", ""))


class FailingTool(ToolPort):
    """Always raises a RuntimeError when executed."""

    @property
    def name(self) -> str:
        return "fail"

    @property
    def description(self) -> str:
        return "Always fails."

    @property
    def input_schema(self) -> dict:
        return {"type": "object", "properties": {}}

    @property
    def required_permission(self) -> str:
        return "tool:fail"

    async def execute(self, input: dict) -> ToolResult:
        raise RuntimeError("intentional failure")
