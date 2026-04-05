"""LLM port — interface for language model calls."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from ravn.domain.models import LLMResponse, StreamEvent

# The system prompt may be a plain string or a list of Anthropic-format text
# blocks ({"type": "text", "text": "...", "cache_control": {...}}).  Adapters
# that do not support structured system prompts should concatenate the text
# values from the blocks.
SystemPrompt = str | list[dict]


class LLMPort(ABC):
    """Abstract interface for LLM streaming and generation with tool support."""

    @abstractmethod
    def stream(
        self,
        messages: list[dict],
        *,
        tools: list[dict],
        system: SystemPrompt,
        model: str,
        max_tokens: int,
    ) -> AsyncIterator[StreamEvent]:
        """Stream a response from the LLM, yielding events as they arrive.

        Yields StreamEvent objects with TEXT_DELTA, TOOL_CALL, and MESSAGE_DONE types.
        ``system`` may be a plain string or a list of Anthropic-format text blocks
        with optional ``cache_control`` entries for prompt caching.
        """
        ...

    @abstractmethod
    async def generate(
        self,
        messages: list[dict],
        *,
        tools: list[dict],
        system: SystemPrompt,
        model: str,
        max_tokens: int,
    ) -> LLMResponse:
        """Generate a complete (non-streaming) response from the LLM."""
        ...
