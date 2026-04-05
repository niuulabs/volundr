"""Domain events for Ravn — emitted to output channels."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class RavnEventType(StrEnum):
    THOUGHT = "thought"
    TOOL_START = "tool_start"
    TOOL_RESULT = "tool_result"
    RESPONSE = "response"
    ERROR = "error"


@dataclass(frozen=True)
class RavnEvent:
    """An event emitted by the Ravn agent to its output channel."""

    type: RavnEventType
    data: str
    metadata: dict = field(default_factory=dict)

    @classmethod
    def thought(cls, text: str) -> RavnEvent:
        return cls(type=RavnEventType.THOUGHT, data=text)

    @classmethod
    def tool_start(
        cls,
        tool_name: str,
        tool_input: dict,
        *,
        diff: str | None = None,
    ) -> RavnEvent:
        metadata: dict = {"input": tool_input}
        if diff is not None:
            metadata["diff"] = diff
        return cls(type=RavnEventType.TOOL_START, data=tool_name, metadata=metadata)

    @classmethod
    def tool_result(cls, tool_name: str, result: str, *, is_error: bool = False) -> RavnEvent:
        return cls(
            type=RavnEventType.TOOL_RESULT,
            data=result,
            metadata={"tool_name": tool_name, "is_error": is_error},
        )

    @classmethod
    def response(cls, text: str) -> RavnEvent:
        return cls(type=RavnEventType.RESPONSE, data=text)

    @classmethod
    def error(cls, message: str) -> RavnEvent:
        return cls(type=RavnEventType.ERROR, data=message)
