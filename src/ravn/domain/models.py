"""Domain models for Ravn."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID, uuid4

# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class StopReason(StrEnum):
    END_TURN = "end_turn"
    TOOL_USE = "tool_use"
    MAX_TOKENS = "max_tokens"
    STOP_SEQUENCE = "stop_sequence"


class StreamEventType(StrEnum):
    TEXT_DELTA = "text_delta"
    TOOL_CALL = "tool_call"
    MESSAGE_DONE = "message_done"


# ---------------------------------------------------------------------------
# Value objects
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TokenUsage:
    """Token usage for a single LLM call or cumulative across a session."""

    input_tokens: int
    output_tokens: int
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    def __add__(self, other: TokenUsage) -> TokenUsage:
        return TokenUsage(
            input_tokens=self.input_tokens + other.input_tokens,
            output_tokens=self.output_tokens + other.output_tokens,
            cache_read_tokens=self.cache_read_tokens + other.cache_read_tokens,
            cache_write_tokens=self.cache_write_tokens + other.cache_write_tokens,
        )


@dataclass(frozen=True)
class ToolCall:
    """A tool invocation requested by the LLM."""

    id: str
    name: str
    input: dict


@dataclass(frozen=True)
class ToolResult:
    """The result of executing a tool."""

    tool_call_id: str
    content: str
    is_error: bool = False


@dataclass(frozen=True)
class Message:
    """A single message in a conversation."""

    role: str  # "user" or "assistant"
    content: str | list[dict]


@dataclass(frozen=True)
class LLMResponse:
    """A complete (non-streaming) response from the LLM."""

    content: str
    tool_calls: list[ToolCall]
    stop_reason: StopReason
    usage: TokenUsage


@dataclass(frozen=True)
class StreamEvent:
    """A single event from the LLM streaming API."""

    type: StreamEventType
    text: str | None = None
    tool_call: ToolCall | None = None
    usage: TokenUsage | None = None


@dataclass(frozen=True)
class TurnResult:
    """The result of a single agent turn."""

    response: str
    tool_calls: list[ToolCall]
    tool_results: list[ToolResult]
    usage: TokenUsage


# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------


@dataclass
class Session:
    """A Ravn conversation session."""

    id: UUID = field(default_factory=uuid4)
    messages: list[Message] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    turn_count: int = 0
    total_usage: TokenUsage = field(
        default_factory=lambda: TokenUsage(input_tokens=0, output_tokens=0)
    )

    def add_message(self, message: Message) -> None:
        self.messages.append(message)

    def record_turn(self, usage: TokenUsage) -> None:
        self.turn_count += 1
        self.total_usage = self.total_usage + usage
