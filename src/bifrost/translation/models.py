"""Pydantic models representing the Anthropic Messages API wire format.

These are the canonical inbound/outbound types for Bifröst.  All provider
adapters accept an ``AnthropicRequest`` and return an ``AnthropicResponse``.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Content blocks
# ---------------------------------------------------------------------------


class TextBlock(BaseModel):
    type: Literal["text"] = "text"
    text: str


class ThinkingBlock(BaseModel):
    type: Literal["thinking"] = "thinking"
    thinking: str


class ToolUseBlock(BaseModel):
    type: Literal["tool_use"] = "tool_use"
    id: str
    name: str
    input: dict[str, Any] = Field(default_factory=dict)


class ToolResultBlock(BaseModel):
    type: Literal["tool_result"] = "tool_result"
    tool_use_id: str
    content: str | list[TextBlock] = ""
    is_error: bool = False


ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock

# A message content value is either a plain string or a list of blocks.
MessageContent = str | list[ContentBlock]


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: MessageContent


# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------


class ToolDefinition(BaseModel):
    name: str
    description: str = ""
    input_schema: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Tool choice
# ---------------------------------------------------------------------------


class ToolChoiceAuto(BaseModel):
    type: Literal["auto"] = "auto"


class ToolChoiceAny(BaseModel):
    type: Literal["any"] = "any"


class ToolChoiceTool(BaseModel):
    type: Literal["tool"] = "tool"
    name: str


ToolChoice = ToolChoiceAuto | ToolChoiceAny | ToolChoiceTool


# ---------------------------------------------------------------------------
# Request
# ---------------------------------------------------------------------------


class AnthropicRequest(BaseModel):
    model: str
    max_tokens: int = 1024
    messages: list[Message]
    system: str | list[TextBlock] | None = None
    tools: list[ToolDefinition] | None = None
    tool_choice: ToolChoice | None = None
    temperature: float | None = None
    top_p: float | None = None
    top_k: int | None = None
    stop_sequences: list[str] | None = None
    stream: bool = False
    metadata: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Response
# ---------------------------------------------------------------------------


class UsageInfo(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0


class AnthropicResponse(BaseModel):
    id: str
    type: Literal["message"] = "message"
    role: Literal["assistant"] = "assistant"
    content: list[ContentBlock]
    model: str
    stop_reason: str | None = None
    stop_sequence: str | None = None
    usage: UsageInfo = Field(default_factory=UsageInfo)


# ---------------------------------------------------------------------------
# Streaming events
# ---------------------------------------------------------------------------


class MessageStartEvent(BaseModel):
    type: Literal["message_start"] = "message_start"
    message: dict[str, Any]


class ContentBlockStartEvent(BaseModel):
    type: Literal["content_block_start"] = "content_block_start"
    index: int
    content_block: dict[str, Any]


class ContentBlockDeltaEvent(BaseModel):
    type: Literal["content_block_delta"] = "content_block_delta"
    index: int
    delta: dict[str, Any]


class ContentBlockStopEvent(BaseModel):
    type: Literal["content_block_stop"] = "content_block_stop"
    index: int


class MessageDeltaEvent(BaseModel):
    type: Literal["message_delta"] = "message_delta"
    delta: dict[str, Any]
    usage: dict[str, Any] = Field(default_factory=dict)


class MessageStopEvent(BaseModel):
    type: Literal["message_stop"] = "message_stop"


class PingEvent(BaseModel):
    type: Literal["ping"] = "ping"
