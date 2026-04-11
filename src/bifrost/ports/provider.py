"""ProviderPort — abstract interface for LLM provider adapters."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from bifrost.translation.models import AnthropicRequest, AnthropicResponse


class ProviderError(Exception):
    """Raised when a provider call fails in a non-retryable way."""


class ProviderPort(ABC):
    """Abstract interface that every provider adapter must implement."""

    @abstractmethod
    async def complete(self, request: AnthropicRequest, model: str) -> AnthropicResponse:
        """Perform a non-streaming completion.

        Args:
            request: The inbound Anthropic-format request.
            model: The resolved model name for this provider.

        Returns:
            An ``AnthropicResponse`` ready to return to the caller.

        Raises:
            ProviderError: On non-retryable provider errors.
            httpx.HTTPStatusError: On HTTP-level errors (callers handle retries).
        """

    @abstractmethod
    async def stream(self, request: AnthropicRequest, model: str) -> AsyncIterator[str]:
        """Perform a streaming completion and yield Anthropic-format SSE lines.

        Args:
            request: The inbound Anthropic-format request.
            model: The resolved model name for this provider.

        Yields:
            Anthropic-format SSE event strings.

        Raises:
            ProviderError: On non-retryable provider errors.
        """

    async def close(self) -> None:
        """Release any held resources (e.g. HTTP client connections)."""
