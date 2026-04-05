"""LLM port — interface for language model calls."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from ravn.domain.models import LLMResponse, StreamEvent


class LLMPort(ABC):
    """Abstract interface for LLM streaming and generation with tool support."""

    @abstractmethod
    def stream(
        self,
        messages: list[dict],
        *,
        tools: list[dict],
        system: str,
        model: str,
        max_tokens: int,
    ) -> AsyncIterator[StreamEvent]:
        """Stream a response from the LLM, yielding events as they arrive.

        Yields StreamEvent objects with TEXT_DELTA, TOOL_CALL, and MESSAGE_DONE types.
        """
        ...

    @abstractmethod
    async def generate(
        self,
        messages: list[dict],
        *,
        tools: list[dict],
        system: str,
        model: str,
        max_tokens: int,
    ) -> LLMResponse:
        """Generate a complete (non-streaming) response from the LLM."""
        ...
